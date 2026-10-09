//! Adds your own mods (zip/DLL) to a profile without Thunderstore.
use crate::error::{AppError, Result};
use crate::install::zip_entry_parts;
use crate::models::{ProfileMod, Source};
use crate::paths::Paths;
use serde::Deserialize;
use std::io::Read;
use std::path::Path;

#[derive(Deserialize)]
struct Manifest {
    name: String,
    #[serde(default)]
    version_number: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
}

fn clean_name(s: &str) -> String {
    let n: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if n.is_empty() {
        "Mod".into()
    } else {
        n
    }
}

fn read_manifest(zip: &Path) -> Result<Option<Manifest>> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip)?)?;
    for i in 0..archive.len() {
        let mut e = archive.by_index(i)?;
        let is_manifest = zip_entry_parts(e.name()).is_some_and(|p| p.len() == 1 && p[0].eq_ignore_ascii_case("manifest.json"));
        if is_manifest {
            let mut s = String::new();
            e.read_to_string(&mut s)?;
            return Ok(serde_json::from_str(s.trim_start_matches('\u{feff}')).ok());
        }
    }
    Ok(None)
}

pub fn import_local(paths: &Paths, profile: &str, src: &Path) -> Result<ProfileMod> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let (name, version, deps) = match ext.as_str() {
        "zip" => match read_manifest(src)? {
            Some(m) => (clean_name(&m.name), m.version_number.unwrap_or_else(|| "0.0.0".into()), m.dependencies),
            None => (clean_name(&stem), "0.0.0".into(), vec![]),
        },
        "dll" => (clean_name(&stem), "0.0.0".into(), vec![]),
        _ => return Err(AppError::Invalid("Only .zip or .dll files are supported.".into())),
    };
    let m = ProfileMod { namespace: "local".into(), name, version, enabled: true, source: Source::Local, deps };
    let dest_dir = paths.local_dir(profile).join(m.id());
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)?;
    }
    std::fs::create_dir_all(&dest_dir)?;
    std::fs::copy(src, dest_dir.join(src.file_name().unwrap()))?;
    Ok(m)
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

        let dll = d.path().join("My Plugin.dll");
        std::fs::write(&dll, "x").unwrap();
        let m = import_local(&paths, "p", &dll).unwrap();
        assert_eq!((m.id().as_str(), m.version.as_str()), ("local-My_Plugin", "0.0.0"));
        let dll2 = d.path().join("My_Plugin.dll");
        std::fs::write(&dll2, "y").unwrap();
        import_local(&paths, "p", &dll2).unwrap();
        let files: Vec<_> = std::fs::read_dir(paths.local_dir("p").join("local-My_Plugin")).unwrap().collect();
        assert_eq!(files.len(), 1);

        let txt = d.path().join("x.txt");
        std::fs::write(&txt, "").unwrap();
        assert!(import_local(&paths, "p", &txt).is_err());
    }
}
