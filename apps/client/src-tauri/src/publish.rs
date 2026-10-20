//! Publish a profile as a Thunderstore modpack: build the package zip (manifest.json, README.md,
//! icon.png, CHANGELOG.md, config files), let Thunderstore validate the parts, upload the zip in
//! parts and submit it. Needs a team service-account token (`tss_…`) from the settings.
use crate::error::{AppError, Result};
use crate::models::Plan;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};

const API: &str = "https://thunderstore.io/api/experimental";
pub const COMMUNITY: &str = "valheim";
/// 256×256 PNG (the app icon) for authors who do not pick their own.
pub const DEFAULT_ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishMeta {
    /// Thunderstore team = namespace = `author_name`.
    pub team: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub website_url: String,
    pub readme: String,
    #[serde(default)]
    pub changelog: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub nsfw: bool,
    #[serde(default)]
    pub icon_path: Option<String>,
    #[serde(default)]
    pub include_configs: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub full_name: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Category {
    pub name: String,
    pub slug: String,
}

pub fn validate_meta(m: &PublishMeta) -> Result<()> {
    let name_ok = !m.name.is_empty() && m.name.len() <= 128 && m.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !name_ok {
        return Err(AppError::Invalid("The package name may only contain letters, digits and underscores.".into()));
    }
    let v: Vec<&str> = m.version.split('.').collect();
    if v.len() != 3 || v.iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit())) {
        return Err(AppError::Invalid("The version must look like 1.0.0.".into()));
    }
    if m.description.trim().is_empty() || m.description.len() > 256 {
        return Err(AppError::Invalid("The description must have 1 to 256 characters.".into()));
    }
    if m.team.trim().is_empty() {
        return Err(AppError::Invalid("Enter the Thunderstore team the package belongs to.".into()));
    }
    if m.readme.trim().is_empty() {
        return Err(AppError::Invalid("The README must not be empty.".into()));
    }
    Ok(())
}

/// Every resolved package of the plan as `Namespace-Name-1.2.3`, the format manifests use.
pub fn dependency_strings(plan: &Plan) -> Vec<String> {
    plan.resolved.iter().map(|(id, r)| format!("{id}-{}", r.version)).collect()
}

pub fn manifest_json(m: &PublishMeta, dependencies: &[String]) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": m.name,
        "version_number": m.version,
        "website_url": m.website_url,
        "description": m.description,
        "dependencies": dependencies,
    }))
    .expect("manifest is serializable")
}

/// README generated from the profile; the author edits it in the dialog before publishing.
pub fn default_readme(name: &str, description: &str, mods: &[(String, String, String)]) -> String {
    let mut s = format!("# {name}\n\n{description}\n\n## Mods\n\n| Mod | Author | Version |\n| --- | --- | --- |\n");
    for (ns, mod_name, version) in mods {
        s.push_str(&format!("| {mod_name} | {ns} | {version} |\n"));
    }
    s.push_str("\n## Installation\n\nInstall with a mod manager; the dependencies above are pulled in automatically.\n");
    s
}

pub fn build_zip(m: &PublishMeta, dependencies: &[String], icon: &[u8], configs: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    w.start_file("manifest.json", opts)?;
    w.write_all(manifest_json(m, dependencies).as_bytes())?;
    w.start_file("README.md", opts)?;
    w.write_all(m.readme.as_bytes())?;
    w.start_file("icon.png", opts)?;
    w.write_all(icon)?;
    if !m.changelog.trim().is_empty() {
        w.start_file("CHANGELOG.md", opts)?;
        w.write_all(m.changelog.as_bytes())?;
    }
    for (rel, bytes) in configs {
        w.start_file(format!("config/{rel}"), opts)?;
        w.write_all(bytes)?;
    }
    Ok(w.finish()?.into_inner())
}

/// Thunderstore answers validation errors as JSON objects of field → messages; flatten them.
fn error_text(status: reqwest::StatusCode, body: &str) -> String {
    let flat = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .map(|v| match v {
            serde_json::Value::Object(map) => map
                .iter()
                .map(|(k, v)| match v {
                    serde_json::Value::Array(a) => format!("{k}: {}", a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" ")),
                    other => format!("{k}: {other}"),
                })
                .collect::<Vec<_>>()
                .join("; "),
            other => other.to_string(),
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    format!("Thunderstore responded with {status}: {flat}")
}

async fn post_json<T: DeserializeOwned>(client: &reqwest::Client, token: &str, path: &str, body: &serde_json::Value) -> Result<T> {
    let res = client.post(format!("{API}/{path}")).bearer_auth(token).json(body).send().await?;
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        return Err(AppError::Invalid(error_text(status, &text)));
    }
    serde_json::from_str(&text).map_err(|e| AppError::Invalid(format!("Unexpected answer from Thunderstore: {e}")))
}

pub async fn fetch_categories(client: &reqwest::Client) -> Result<Vec<Category>> {
    #[derive(Deserialize)]
    struct Page {
        pagination: Pagination,
        results: Vec<Category>,
    }
    #[derive(Deserialize)]
    struct Pagination {
        next_link: Option<String>,
    }
    let mut url = format!("{API}/community/{COMMUNITY}/category/");
    let mut out = Vec::new();
    for _ in 0..10 {
        let page: Page = client.get(&url).send().await?.error_for_status()?.json().await?;
        out.extend(page.results);
        match page.pagination.next_link {
            Some(next) => url = next,
            None => break,
        }
    }
    out.sort_by_key(|c| c.name.to_lowercase());
    Ok(out)
}

/// The three validators Thunderstore offers before an upload; errors carry the server's reasons.
pub async fn validate_remote(client: &reqwest::Client, token: &str, m: &PublishMeta, manifest: &str, icon: &[u8]) -> Result<()> {
    #[derive(Deserialize)]
    struct Ok_ {
        #[allow(dead_code)]
        success: bool,
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let _: Ok_ = post_json(client, token, "submission/validate/manifest-v1/", &serde_json::json!({ "namespace": m.team, "manifest_data": manifest })).await?;
    let _: Ok_ = post_json(client, token, "submission/validate/readme/", &serde_json::json!({ "readme_data": m.readme })).await?;
    let _: Ok_ = post_json(client, token, "submission/validate/icon/", &serde_json::json!({ "icon_data": b64.encode(icon) })).await?;
    Ok(())
}

#[derive(Deserialize)]
struct UploadPart {
    part_number: u32,
    url: String,
    offset: usize,
    length: usize,
}

#[derive(Deserialize)]
struct Initiated {
    user_media: UserMedia,
    upload_urls: Vec<UploadPart>,
}

#[derive(Deserialize)]
struct UserMedia {
    uuid: String,
}

/// Multipart upload to the presigned URLs Thunderstore hands out; returns the media UUID.
pub async fn upload(client: &reqwest::Client, token: &str, filename: &str, bytes: &[u8]) -> Result<String> {
    let init: Initiated =
        post_json(client, token, "usermedia/initiate-upload/", &serde_json::json!({ "filename": filename, "file_size_bytes": bytes.len() })).await?;
    let uuid = init.user_media.uuid;
    let mut parts = Vec::with_capacity(init.upload_urls.len());
    for p in &init.upload_urls {
        let end = (p.offset + p.length).min(bytes.len());
        let chunk = bytes[p.offset..end].to_vec();
        let res = match client.put(&p.url).body(chunk).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let _ = post_json::<serde_json::Value>(client, token, &format!("usermedia/{uuid}/abort-upload/"), &serde_json::json!({})).await;
                return Err(AppError::Network(format!("Upload part {} failed: HTTP {}", p.part_number, r.status())));
            }
            Err(e) => {
                let _ = post_json::<serde_json::Value>(client, token, &format!("usermedia/{uuid}/abort-upload/"), &serde_json::json!({})).await;
                return Err(AppError::Network(format!("Upload part {} failed: {e}", p.part_number)));
            }
        };
        let etag = res.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        parts.push(serde_json::json!({ "ETag": etag, "PartNumber": p.part_number }));
    }
    let _: serde_json::Value = post_json(client, token, &format!("usermedia/{uuid}/finish-upload/"), &serde_json::json!({ "parts": parts })).await?;
    Ok(uuid)
}

pub async fn submit(client: &reqwest::Client, token: &str, m: &PublishMeta, upload_uuid: &str) -> Result<PublishResult> {
    #[derive(Deserialize)]
    struct Submitted {
        package_version: PackageVersion,
        #[serde(default)]
        available_communities: Vec<Available>,
    }
    #[derive(Deserialize)]
    struct PackageVersion {
        full_name: String,
        #[serde(default)]
        namespace: String,
        name: String,
    }
    #[derive(Deserialize)]
    struct Available {
        url: String,
    }
    let body = serde_json::json!({
        "author_name": m.team,
        "communities": [COMMUNITY],
        "community_categories": { COMMUNITY: m.categories },
        "has_nsfw_content": m.nsfw,
        "upload_uuid": upload_uuid,
    });
    let s: Submitted = post_json(client, token, "submission/submit/", &body).await?;
    let ns = if s.package_version.namespace.is_empty() { m.team.clone() } else { s.package_version.namespace.clone() };
    let url = s
        .available_communities
        .first()
        .map(|a| a.url.clone())
        .unwrap_or_else(|| format!("https://thunderstore.io/c/{COMMUNITY}/p/{ns}/{}/", s.package_version.name));
    Ok(PublishResult { full_name: s.package_version.full_name, url })
}

/// The whole flow: local checks, zip, remote validation, upload, submit.
pub async fn publish(
    client: &reqwest::Client,
    token: &str,
    m: &PublishMeta,
    plan: &Plan,
    icon: Vec<u8>,
    configs: Vec<(String, Vec<u8>)>,
) -> Result<PublishResult> {
    validate_meta(m)?;
    let deps = dependency_strings(plan);
    if deps.is_empty() {
        return Err(AppError::Invalid("The profile has no mods to publish.".into()));
    }
    let manifest = manifest_json(m, &deps);
    validate_remote(client, token, m, &manifest, &icon).await?;
    let zip = build_zip(m, &deps, &icon, &configs)?;
    let uuid = upload(client, token, &format!("{}-{}-{}.zip", m.team, m.name, m.version), &zip).await?;
    submit(client, token, m, &uuid).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Resolved;
    use std::collections::BTreeMap;

    fn meta() -> PublishMeta {
        PublishMeta {
            team: "MyTeam".into(),
            name: "My_Pack".into(),
            version: "1.0.0".into(),
            description: "A pack".into(),
            website_url: String::new(),
            readme: "# hi".into(),
            changelog: String::new(),
            categories: vec!["modpacks".into()],
            nsfw: false,
            icon_path: None,
            include_configs: true,
        }
    }

    #[test]
    fn meta_validation_catches_the_usual_mistakes() {
        assert!(validate_meta(&meta()).is_ok());
        assert!(validate_meta(&PublishMeta { name: "My Pack".into(), ..meta() }).is_err());
        assert!(validate_meta(&PublishMeta { version: "1.0".into(), ..meta() }).is_err());
        assert!(validate_meta(&PublishMeta { description: "x".repeat(257), ..meta() }).is_err());
        assert!(validate_meta(&PublishMeta { readme: " ".into(), ..meta() }).is_err());
    }

    #[test]
    fn zip_holds_manifest_readme_icon_and_configs() {
        let mut resolved = BTreeMap::new();
        resolved.insert("a-Lib".to_string(), Resolved { version: "1.2.3".into(), required_by: vec![], store: Default::default() });
        resolved.insert("denikson-BepInExPack_Valheim".to_string(), Resolved { version: "5.4.2351".into(), required_by: vec![], store: Default::default() });
        let plan = Plan { resolved, to_install: vec![], to_remove: vec![], errors: vec![] };
        let deps = dependency_strings(&plan);
        assert_eq!(deps, vec!["a-Lib-1.2.3", "denikson-BepInExPack_Valheim-5.4.2351"]);
        let m = PublishMeta { changelog: "## 1.0.0\n- first".into(), ..meta() };
        let bytes = build_zip(&m, &deps, DEFAULT_ICON, &[("x.cfg".into(), b"k=v".to_vec())]).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        assert_eq!(names, vec!["manifest.json", "README.md", "icon.png", "CHANGELOG.md", "config/x.cfg"]);
        let mut manifest = String::new();
        std::io::Read::read_to_string(&mut z.by_name("manifest.json").unwrap(), &mut manifest).unwrap();
        let v: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(v["name"], "My_Pack");
        assert_eq!(v["dependencies"][0], "a-Lib-1.2.3");
        assert!(DEFAULT_ICON.starts_with(b"\x89PNG"));
    }

    #[test]
    fn error_bodies_become_readable() {
        let s = error_text(reqwest::StatusCode::BAD_REQUEST, r#"{"manifest_data":["Package name too long"],"non_field_errors":["x"]}"#);
        assert!(s.contains("manifest_data: Package name too long"));
        assert!(error_text(reqwest::StatusCode::INTERNAL_SERVER_ERROR, "<html>").contains("<html>"));
    }

    #[test]
    fn default_readme_lists_mods() {
        let r = default_readme("Pack", "Desc", &[("ValheimModding".into(), "Jotunn".into(), "2.26.0".into())]);
        assert!(r.starts_with("# Pack\n\nDesc"));
        assert!(r.contains("| Jotunn | ValheimModding | 2.26.0 |"));
    }
}
