//! r2modman-compatible sharing: export.r2x (YAML) + BepInEx/config in a zip
//! (.r2z), as a file or as a code via the Thunderstore legacy profile API.
use crate::config::list_files_with_ext;
use crate::error::{AppError, Result};
use crate::install::zip_entry_parts;
use crate::models::{Pkg, Profile, ProfileMod, Source, Store};
use crate::paths::Paths;
use crate::profiles;
use crate::util::safe_join;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;

const CODE_PREFIX: &str = "#r2modman";
pub(crate) const CONFIG_EXTS: [&str; 6] = ["cfg", "txt", "json", "yml", "yaml", "ini"];
const API: &str = "https://thunderstore.io/api/experimental/legacyprofile";

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct R2x {
    profile_name: String,
    #[serde(default)]
    mods: Vec<R2xMod>,
}

fn is_thunderstore(s: &Store) -> bool {
    *s == Store::Thunderstore
}

#[derive(Serialize, Deserialize)]
struct R2xMod {
    name: String,
    #[serde(default)]
    version: R2xVersion,
    #[serde(default = "yes")]
    enabled: bool,
    /// Gale's field: the store a release comes from. Written for Hexium-only releases, read for nothing
    /// (the import resolves by id against the merged index); r2modman ignores it.
    #[serde(default, skip_serializing_if = "is_thunderstore")]
    source: Store,
}

#[derive(Serialize, Deserialize, Default)]
struct R2xVersion {
    #[serde(default)]
    major: u32,
    #[serde(default)]
    minor: u32,
    #[serde(default)]
    patch: u32,
}

/// `by_id`: the index, to mark releases only Hexium has; None writes every entry as Thunderstore's.
pub fn to_r2x(profile: &Profile, by_id: Option<&HashMap<String, Pkg>>) -> Result<(String, Vec<String>)> {
    let mut skipped = vec![];
    let mut mods = vec![];
    for m in &profile.mods {
        if m.source == Source::Local {
            skipped.push(m.id());
            continue;
        }
        let n: Vec<u32> = m.version.split('.').map(|x| x.parse().unwrap_or(0)).collect();
        let source = by_id.and_then(|i| i.get(&m.id())).and_then(|p| p.versions.iter().find(|v| v.v == m.version)).map(|v| v.src).unwrap_or_default();
        mods.push(R2xMod {
            name: m.id(),
            version: R2xVersion { major: n.first().copied().unwrap_or(0), minor: n.get(1).copied().unwrap_or(0), patch: n.get(2).copied().unwrap_or(0) },
            enabled: m.enabled,
            source,
        });
    }
    let yaml = serde_yaml_ng::to_string(&R2x { profile_name: profile.name.clone(), mods }).map_err(|e| AppError::Invalid(format!("Export failed: {e}")))?;
    Ok((yaml, skipped))
}

/// → (profile name, mods, unreadable entries)
pub fn parse_r2x(text: &str) -> Result<(String, Vec<ProfileMod>, Vec<String>)> {
    let r: R2x = serde_yaml_ng::from_str(text).map_err(|e| AppError::Invalid(format!("export.r2x is invalid: {e}")))?;
    let mut skipped = vec![];
    let mods = r
        .mods
        .into_iter()
        .filter_map(|m| match m.name.split_once('-') {
            Some((ns, name)) if !ns.is_empty() && !name.is_empty() => Some(ProfileMod {
                enabled: m.enabled,
                ..ProfileMod::thunderstore(ns, name, &format!("{}.{}.{}", m.version.major, m.version.minor, m.version.patch))
            }),
            _ => {
                skipped.push(m.name);
                None
            }
        })
        .collect();
    Ok((r.profile_name, mods, skipped))
}

pub fn build_r2z(profile: &Profile, config_dir: &Path, by_id: Option<&HashMap<String, Pkg>>) -> Result<(Vec<u8>, Vec<String>)> {
    let (yaml, skipped) = to_r2x(profile, by_id)?;
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    w.start_file("export.r2x", opts)?;
    w.write_all(yaml.as_bytes())?;
    for rel in list_files_with_ext(config_dir, &CONFIG_EXTS) {
        w.start_file(format!("BepInEx/config/{rel}"), opts)?;
        w.write_all(&std::fs::read(safe_join(config_dir, &rel)?)?)?;
    }
    Ok((w.finish()?.into_inner(), skipped))
}

pub struct R2zContents {
    pub profile_name: String,
    pub mods: Vec<ProfileMod>,
    pub configs: Vec<(String, Vec<u8>)>,
    pub skipped: Vec<String>,
}

pub fn read_r2z(bytes: &[u8]) -> Result<R2zContents> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    let mut r2x = None;
    let mut configs = vec![];
    for i in 0..archive.len() {
        let mut e = archive.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let Some(parts) = zip_entry_parts(e.name()) else { continue };
        let mut buf = vec![];
        if parts.len() == 1 && parts[0].eq_ignore_ascii_case("export.r2x") {
            e.read_to_end(&mut buf)?;
            r2x = Some(String::from_utf8_lossy(&buf).to_string());
        } else if parts.len() > 2 && parts[0].eq_ignore_ascii_case("BepInEx") && parts[1].eq_ignore_ascii_case("config") {
            e.read_to_end(&mut buf)?;
            configs.push((parts[2..].join("/"), buf));
        }
    }
    let r2x = r2x.ok_or_else(|| AppError::Invalid("export.r2x is missing from the profile.".into()))?;
    let (profile_name, mods, skipped) = parse_r2x(&r2x)?;
    Ok(R2zContents { profile_name, mods, configs, skipped })
}

pub fn encode_code_payload(bytes: &[u8]) -> String {
    format!("{CODE_PREFIX}\n{}", STANDARD.encode(bytes))
}

pub fn decode_code_payload(text: &str) -> Result<Vec<u8>> {
    let t = text.trim();
    let b64 = if t.starts_with('#') { t.split_once('\n').map(|x| x.1).unwrap_or("") } else { t };
    let clean: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD.decode(clean).map_err(|_| AppError::Invalid("The profile data is corrupted.".into()))
}

pub fn sanitize_profile_name(name: &str) -> String {
    let replaced: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let trimmed = replaced.trim().trim_end_matches('.').to_string();
    profiles::validate_name(&trimmed).unwrap_or_else(|_| "import".to_string())
}

#[derive(Serialize, Debug)]
pub struct ImportSummary {
    pub name: String,
    pub mods: usize,
    pub configs: usize,
    pub skipped: Vec<String>,
}

/// Creates a new profile from an export. `enable_all` turns on mods the export had disabled; the caller
/// decides whether a sync follows (the "install everything now" question on import).
pub fn apply_import(paths: &Paths, requested_name: &str, c: R2zContents, with_configs: bool, enable_all: bool) -> Result<ImportSummary> {
    let base = if requested_name.trim().is_empty() { &c.profile_name } else { requested_name };
    let name = profiles::unique_name(paths, &sanitize_profile_name(base));
    let name = profiles::create(paths, &name)?;
    let mods = c.mods.len();
    let mut list = c.mods;
    if enable_all {
        list.iter_mut().for_each(|m| m.enabled = true);
    }
    profiles::save(paths, &Profile { name: name.clone(), mods: list, server: None, override_locks: false })?;
    let mut configs = 0;
    if with_configs {
        let dir = paths.config_dir(&name);
        for (rel, bytes) in c.configs {
            let Ok(dest) = safe_join(&dir, &rel) else { continue };
            std::fs::create_dir_all(dest.parent().unwrap())?;
            std::fs::write(dest, bytes)?;
            configs += 1;
        }
    }
    Ok(ImportSummary { name, mods, configs, skipped: c.skipped })
}

pub async fn fetch_code(client: &reqwest::Client, code: &str) -> Result<Vec<u8>> {
    let code = code.trim();
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::Invalid("Invalid profile code.".into()));
    }
    let res = client.get(format!("{API}/get/{code}/")).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Invalid(format!("Profile code is invalid or expired ({}).", res.status())));
    }
    decode_code_payload(&res.text().await?)
}

pub async fn upload_code(client: &reqwest::Client, r2z: Vec<u8>) -> Result<String> {
    #[derive(Deserialize)]
    struct Created {
        key: String,
    }
    let res =
        client.post(format!("{API}/create/")).header(reqwest::header::CONTENT_TYPE, "application/octet-stream").body(encode_code_payload(&r2z)).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Upload failed ({}).", res.status())));
    }
    Ok(res.json::<Created>().await?.key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Source;

    const R2MODMAN_YAML: &str = "profileName: Friends\nmods:\n  - name: denikson-BepInExPack_Valheim\n    version:\n      major: 5\n      minor: 4\n      patch: 2351\n    enabled: true\n  - name: ValheimModding-Jotunn\n    version: {major: 2, minor: 20, patch: 1}\n    enabled: false\n    icon: whatever\n";

    fn local() -> ProfileMod {
        ProfileMod {
            namespace: "local".into(),
            name: "Mine".into(),
            version: "0.0.0".into(),
            enabled: true,
            source: Source::Local,
            pinned: false,
            implicit: false,
            managed: false,
            optional: false,
            deps: vec![],
        }
    }

    #[test]
    fn parses_r2modman_export() {
        let (name, mods, skipped) = parse_r2x(R2MODMAN_YAML).unwrap();
        assert_eq!(name, "Friends");
        assert!(skipped.is_empty());
        assert_eq!(mods[1].id(), "ValheimModding-Jotunn");
        assert_eq!(mods[1].version, "2.20.1");
        assert!(!mods[1].enabled);
    }

    #[test]
    fn r2x_roundtrip_skips_local_mods() {
        let mut off = ProfileMod::thunderstore("a", "B-C", "1.2.3");
        off.enabled = false;
        let p = Profile { name: "X".into(), mods: vec![off.clone(), local()], server: None, override_locks: false };
        let (yaml, skipped) = to_r2x(&p, None).unwrap();
        assert_eq!(skipped, vec!["local-Mine"]);
        assert!(!yaml.contains("source"), "Thunderstore releases carry no source line");
        let (name, mods, _) = parse_r2x(&yaml).unwrap();
        assert_eq!((name.as_str(), mods), ("X", vec![off.clone()]));
        // A release only Hexium has is marked (Gale's field); the import still resolves it by id.
        let mut pkg = crate::models::test_pkg("a-B-C", &[("1.2.3", &[])]);
        pkg.versions[0].src = Store::Hexium;
        let by_id = HashMap::from([("a-B-C".to_string(), pkg)]);
        let (yaml, _) = to_r2x(&p, Some(&by_id)).unwrap();
        assert!(yaml.contains("source: hexium"), "{yaml}");
        assert_eq!(parse_r2x(&yaml).unwrap().1, vec![off]);
    }

    #[test]
    fn r2z_roundtrip_with_configs() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("a.cfg"), "k = v").unwrap();
        std::fs::write(d.path().join("sub/b.json"), "{}").unwrap();
        std::fs::write(d.path().join("skip.dll"), "x").unwrap();
        let p = Profile { name: "X".into(), mods: vec![ProfileMod::thunderstore("a", "B", "1.0.0")], server: None, override_locks: false };
        let (bytes, _) = build_r2z(&p, d.path(), None).unwrap();
        let c = read_r2z(&bytes).unwrap();
        assert_eq!(c.profile_name, "X");
        assert_eq!(c.mods.len(), 1);
        let names: Vec<&str> = c.configs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["a.cfg", "sub/b.json"]);
    }

    #[test]
    fn code_payload_roundtrip() {
        let encoded = encode_code_payload(b"PK-data");
        assert!(encoded.starts_with("#r2modman\n"));
        assert_eq!(decode_code_payload(&encoded).unwrap(), b"PK-data");
        let wrapped = encoded.replace('\n', "\r\n") + "\n";
        assert_eq!(decode_code_payload(&wrapped).unwrap(), b"PK-data");
        assert!(decode_code_payload("#r2modman\n!!!").is_err());
    }

    #[test]
    fn import_sanitizes_name_writes_configs_and_dedupes() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().to_path_buf());
        paths.ensure().unwrap();
        assert_eq!(sanitize_profile_name("A:B?"), "A_B_");
        assert_eq!(sanitize_profile_name("..."), "import");
        let contents = || R2zContents {
            profile_name: "A:B?".into(),
            mods: vec![ProfileMod::thunderstore("a", "B", "1.0.0")],
            configs: vec![("sub/x.cfg".into(), b"k = v".to_vec())],
            skipped: vec![],
        };
        let s = apply_import(&paths, "", contents(), true, false).unwrap();
        assert_eq!((s.name.as_str(), s.mods, s.configs), ("A_B_", 1, 1));
        assert_eq!(std::fs::read_to_string(paths.config_dir("A_B_").join("sub/x.cfg")).unwrap(), "k = v");
        let s2 = apply_import(&paths, "", contents(), false, false).unwrap();
        assert_eq!((s2.name.as_str(), s2.configs), ("A_B_ (2)", 0));
    }

    #[test]
    fn import_can_enable_everything_or_keep_the_export_flags() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().to_path_buf());
        paths.ensure().unwrap();
        let contents = || {
            let mut off = ProfileMod::thunderstore("a", "Off", "1.0.0");
            off.enabled = false;
            R2zContents { profile_name: "p".into(), mods: vec![ProfileMod::thunderstore("a", "On", "1.0.0"), off], configs: vec![], skipped: vec![] }
        };
        let kept = apply_import(&paths, "kept", contents(), false, false).unwrap();
        let flags = |n: &str| profiles::load(&paths, n).unwrap().mods.iter().map(|m| m.enabled).collect::<Vec<_>>();
        assert_eq!(flags(&kept.name), vec![true, false]);
        let all = apply_import(&paths, "all", contents(), false, true).unwrap();
        assert_eq!(flags(&all.name), vec![true, true]);
    }
}
