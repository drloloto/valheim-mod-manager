//! Adds your own mods (zip/DLL) to a profile without Thunderstore. A zip's `manifest.json`, `icon.png`,
//! `README.md` and `CHANGELOG.md` are read so a local mod looks like any other package in the UI.
use crate::error::{AppError, Result};
use crate::install::zip_entry_parts;
use crate::models::{Pkg, ProfileMod, Source, Store, Version};
use crate::paths::Paths;
use crate::thunderstore::DocKind;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Manifest {
    name: String,
    #[serde(default)]
    version_number: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    website_url: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
}

/// What the UI knows about a local mod beyond the profile entry; written to `meta.json` next to the file.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct LocalMeta {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub web: String,
    /// `icon.png` of the zip as a `data:` URL; empty when there is none.
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub deps: Vec<String>,
    /// The imported file's name (zip or DLL).
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub imported_at: i64,
}

const META_FILE: &str = "meta.json";
const MAX_ICON: u64 = 256 * 1024;

fn clean_name(s: &str) -> String {
    let n: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if n.is_empty() {
        "Mod".into()
    } else {
        n
    }
}

/// A root-level entry of the zip by name (case-insensitive), read in full; `max` caps binary reads.
fn read_root_entry(zip: &Path, file: &str, max: u64) -> Result<Option<Vec<u8>>> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip)?)?;
    for i in 0..archive.len() {
        let mut e = archive.by_index(i)?;
        let hit = zip_entry_parts(e.name()).is_some_and(|p| p.len() == 1 && p[0].eq_ignore_ascii_case(file));
        if hit {
            if e.size() > max {
                return Ok(None);
            }
            let mut buf = Vec::with_capacity(e.size() as usize);
            e.read_to_end(&mut buf)?;
            return Ok(Some(buf));
        }
    }
    Ok(None)
}

fn read_manifest(zip: &Path) -> Result<Option<Manifest>> {
    Ok(read_root_entry(zip, "manifest.json", 1024 * 1024)?
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()))
}

fn read_icon(zip: &Path) -> String {
    match read_root_entry(zip, "icon.png", MAX_ICON) {
        Ok(Some(bytes)) => format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        _ => String::new(),
    }
}

/// Everything the file tells about itself; a DLL only has its name.
fn describe(src: &Path) -> Result<LocalMeta> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let file = src.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let size = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    let mut meta = LocalMeta { name: clean_name(&stem), version: "0.0.0".into(), file, size, imported_at: crate::util::now_ms(), ..Default::default() };
    match ext.as_str() {
        "zip" => {
            if let Some(m) = read_manifest(src)? {
                meta.name = clean_name(&m.name);
                meta.version = m.version_number.unwrap_or_else(|| "0.0.0".into());
                meta.desc = m.description.unwrap_or_default().trim().to_string();
                meta.web = m.website_url.unwrap_or_default().trim().to_string();
                meta.deps = m.dependencies;
            }
            meta.icon = read_icon(src);
        }
        "dll" => {}
        _ => return Err(AppError::Invalid("Only .zip or .dll files are supported.".into())),
    }
    Ok(meta)
}

fn entry(meta: &LocalMeta) -> ProfileMod {
    ProfileMod {
        namespace: "local".into(),
        name: meta.name.clone(),
        version: meta.version.clone(),
        enabled: true,
        source: Source::Local,
        pinned: false,
        deps: meta.deps.clone(),
        implicit: false,
        managed: false,
        optional: false,
    }
}

pub fn import_local(paths: &Paths, profile: &str, src: &Path) -> Result<ProfileMod> {
    let meta = describe(src)?;
    let m = entry(&meta);
    let dest_dir = paths.local_dir(profile).join(m.id());
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)?;
    }
    std::fs::create_dir_all(&dest_dir)?;
    std::fs::copy(src, dest_dir.join(src.file_name().unwrap()))?;
    let _ = crate::util::write_atomic(&dest_dir.join(META_FILE), &serde_json::to_vec_pretty(&meta)?);
    Ok(m)
}

/// The mod's file in its local folder (the one that is not `meta.json`).
fn payload(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.is_file() && p.file_name().is_some_and(|n| n != META_FILE))
}

/// `meta.json` of a local mod, rebuilt from the file for mods imported before it existed.
pub fn meta(paths: &Paths, profile: &str, id: &str) -> Option<LocalMeta> {
    let dir = paths.local_dir(profile).join(id);
    if let Ok(Some(m)) = crate::util::read_json::<LocalMeta>(&dir.join(META_FILE)) {
        return Some(m);
    }
    let m = describe(&payload(&dir)?).ok()?;
    let _ = crate::util::write_atomic(&dir.join(META_FILE), &serde_json::to_vec_pretty(&m).ok()?);
    Some(m)
}

/// The local mod as a package, so the table and the detail pane treat it like one from a store.
pub fn pkg(paths: &Paths, profile: &str, id: &str) -> Option<Pkg> {
    let m = meta(paths, profile, id)?;
    Some(Pkg {
        id: id.to_string(),
        ns: "local".into(),
        name: m.name.clone(),
        desc: m.desc.clone(),
        icon: m.icon.clone(),
        cats: vec![],
        rating: 0,
        dl: 0,
        upd: m.imported_at,
        created: m.imported_at,
        dep: false,
        nsfw: false,
        pinned: false,
        url: String::new(),
        web: m.web.clone(),
        hx_url: String::new(),
        stores: vec![],
        versions: vec![Version { v: m.version.clone(), deps: m.deps.clone(), size: m.size, date: m.imported_at, src: Store::Thunderstore, dl: String::new() }],
    })
}

/// README or CHANGELOG of the zip; a DLL or a zip without one yields an empty document.
pub fn doc(paths: &Paths, profile: &str, id: &str, kind: DocKind) -> Result<String> {
    let dir = paths.local_dir(profile).join(id);
    let Some(file) = payload(&dir).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip"))) else {
        return Ok(String::new());
    };
    let name = match kind {
        DocKind::Readme => "README.md",
        DocKind::Changelog => "CHANGELOG.md",
    };
    Ok(read_root_entry(&file, name, 2 * 1024 * 1024)?.map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').to_string()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::tests::make_zip;
    use crate::models::Source;

    #[test]
    fn imports_zip_with_manifest_dll_and_replaces_copies() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().join("data"));
        paths.ensure().unwrap();
        crate::profiles::create(&paths, "p").unwrap();
        let zip = make_zip(
            d.path(),
            "cool.zip",
            &[("manifest.json", r#"{"name":"Cool_Mod","version_number":"1.2.3","dependencies":["a-B-1.0.0"]}"#), ("Cool.dll", "c")],
        );
        let m = import_local(&paths, "p", &zip).unwrap();
        assert_eq!((m.id().as_str(), m.version.as_str(), m.source), ("local-Cool_Mod", "1.2.3", Source::Local));
        assert_eq!(m.deps, vec!["a-B-1.0.0"]);
        assert!(paths.local_dir("p").join("local-Cool_Mod/cool.zip").is_file());
        assert!(paths.local_dir("p").join("local-Cool_Mod/meta.json").is_file());

        let dll = d.path().join("My Plugin.dll");
        std::fs::write(&dll, "x").unwrap();
        let m = import_local(&paths, "p", &dll).unwrap();
        assert_eq!((m.id().as_str(), m.version.as_str()), ("local-My_Plugin", "0.0.0"));
        let dll2 = d.path().join("My_Plugin.dll");
        std::fs::write(&dll2, "y").unwrap();
        import_local(&paths, "p", &dll2).unwrap();
        let files: Vec<_> =
            std::fs::read_dir(paths.local_dir("p").join("local-My_Plugin")).unwrap().filter(|e| e.as_ref().unwrap().file_name() != META_FILE).collect();
        assert_eq!(files.len(), 1);

        let txt = d.path().join("x.txt");
        std::fs::write(&txt, "").unwrap();
        assert!(import_local(&paths, "p", &txt).is_err());
    }

    #[test]
    fn meta_icon_and_docs_come_from_the_zip_and_meta_heals_itself() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().join("data"));
        paths.ensure().unwrap();
        crate::profiles::create(&paths, "p").unwrap();
        let zip = make_zip(
            d.path(),
            "BetterMouseTweaks-1.0.0.zip",
            &[
                (
                    "manifest.json",
                    r#"{"name":"BetterMouseTweaks","description":"Minecraft-style inventory mouse handling.","version_number":"1.0.0","website_url":"https://example.org/bmt","dependencies":["denikson-BepInExPack_Valheim-5.4.2351"]}"#,
                ),
                ("icon.png", "PNG"),
                ("README.md", "# Better Mouse Tweaks\n\nHello."),
                ("CHANGELOG.md", "## 1.0.0\n- first"),
                ("BetterMouseTweaks.dll", "dll"),
            ],
        );
        let m = import_local(&paths, "p", &zip).unwrap();
        let id = m.id();
        let p = pkg(&paths, "p", &id).unwrap();
        assert_eq!(
            (p.name.as_str(), p.desc.as_str(), p.web.as_str()),
            ("BetterMouseTweaks", "Minecraft-style inventory mouse handling.", "https://example.org/bmt")
        );
        assert_eq!(p.icon, "data:image/png;base64,UE5H");
        assert_eq!(p.versions[0].v, "1.0.0");
        assert_eq!(p.versions[0].deps, vec!["denikson-BepInExPack_Valheim-5.4.2351"]);
        assert!(doc(&paths, "p", &id, DocKind::Readme).unwrap().starts_with("# Better Mouse Tweaks"));
        assert!(doc(&paths, "p", &id, DocKind::Changelog).unwrap().contains("first"));

        // A mod imported before meta.json existed: the metadata is rebuilt from the zip and written back.
        std::fs::remove_file(paths.local_dir("p").join(&id).join(META_FILE)).unwrap();
        assert_eq!(meta(&paths, "p", &id).unwrap().desc, "Minecraft-style inventory mouse handling.");
        assert!(paths.local_dir("p").join(&id).join(META_FILE).is_file());

        // A bare DLL has no icon, no docs, no description.
        let dll = d.path().join("Plain.dll");
        std::fs::write(&dll, "x").unwrap();
        let m = import_local(&paths, "p", &dll).unwrap();
        let p = pkg(&paths, "p", &m.id()).unwrap();
        assert!(p.icon.is_empty() && p.desc.is_empty());
        assert_eq!(doc(&paths, "p", &m.id(), DocKind::Readme).unwrap(), "");
    }
}
