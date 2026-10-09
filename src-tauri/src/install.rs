//! Extracts Thunderstore zips into a profile folder following the usual conventions
//! and manages the installed files (remove, enable/disable).
use crate::error::{AppError, Result};
use crate::util::{safe_join, with_old};
use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

const EXCLUDED_ROOT_FILES: [&str; 4] = ["icon.png", "manifest.json", "readme.md", "changelog.md"];
const BEPINEX_SUBFOLDERS: [&str; 5] = ["plugins", "patchers", "config", "core", "monomod"];
const CONFIG_PREFIX: &str = "BepInEx/config/";

enum Layout {
    /// Zip contains `BepInExPack_*/` (the BepInEx pack itself).
    Pack(String),
    /// Zip contains `BepInEx/` at the root.
    BepInExRoot(String),
    /// Zip contains `plugins/`, `config/` … at the root.
    Subfolders,
    /// Everything else.
    Bare,
}

/// Splits a zip entry name; `None` for unsafe paths.
pub fn zip_entry_parts(name: &str) -> Option<Vec<String>> {
    let n = name.replace('\\', "/");
    if n.starts_with('/') {
        return None;
    }
    let mut parts = vec![];
    for p in n.split('/') {
        match p {
            "" | "." => {}
            ".." => return None,
            p if p.contains(':') => return None,
            p => parts.push(p.to_string()),
        }
    }
    Some(parts)
}

fn detect_layout(entries: &[(usize, Vec<String>, bool)]) -> Layout {
    let dirs: BTreeSet<&str> = entries.iter().filter(|(_, parts, is_dir)| parts.len() > 1 || *is_dir).map(|(_, parts, _)| parts[0].as_str()).collect();
    if let Some(d) = dirs.iter().find(|d| d.to_ascii_lowercase().starts_with("bepinexpack")) {
        return Layout::Pack(d.to_string());
    }
    if let Some(d) = dirs.iter().find(|d| d.eq_ignore_ascii_case("bepinex")) {
        return Layout::BepInExRoot(d.to_string());
    }
    if dirs.iter().any(|d| BEPINEX_SUBFOLDERS.contains(&d.to_ascii_lowercase().as_str())) {
        return Layout::Subfolders;
    }
    Layout::Bare
}

fn join(head: &[&str], rest: &[String]) -> Vec<String> {
    head.iter().map(|s| s.to_string()).chain(rest.iter().cloned()).collect()
}

/// Target path (relative to the profile folder) for a zip entry, `None` = skip.
fn map_target(layout: &Layout, parts: &[String], id: &str) -> Option<Vec<String>> {
    let first = parts[0].to_ascii_lowercase();
    let root_file_excluded = parts.len() == 1 && EXCLUDED_ROOT_FILES.contains(&first.as_str());
    match layout {
        Layout::Pack(root) => {
            if parts[0] != *root || parts.len() < 2 {
                return None;
            }
            let rest = &parts[1..];
            match rest[0].to_ascii_lowercase().as_str() {
                "bepinex" if rest.len() > 1 => Some(join(&["BepInEx"], &rest[1..])),
                "winhttp.dll" | "doorstop_config.ini" | ".doorstop_version" if rest.len() == 1 => Some(join(&["doorstop"], rest)),
                "doorstop_libs" => Some(join(&["doorstop"], rest)),
                "unstripped_corlib" => Some(rest.to_vec()),
                _ => None,
            }
        }
        Layout::BepInExRoot(root) => (parts[0] == *root && parts.len() > 1).then(|| join(&["BepInEx"], &parts[1..])),
        Layout::Subfolders => {
            if parts.len() > 1 && BEPINEX_SUBFOLDERS.contains(&first.as_str()) {
                Some(join(&["BepInEx", &first], &parts[1..]))
            } else if root_file_excluded {
                None
            } else {
                Some(join(&["BepInEx", "plugins", id], parts))
            }
        }
        Layout::Bare => (!root_file_excluded).then(|| join(&["BepInEx", "plugins", id], parts)),
    }
}

pub fn extract_zip(zip_path: &Path, profile_dir: &Path, id: &str) -> Result<Vec<String>> {
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip_path)?))?;
    let mut entries = vec![];
    for i in 0..archive.len() {
        let e = archive.by_index(i)?;
        let parts = zip_entry_parts(e.name()).ok_or_else(|| AppError::Invalid(format!("Unsafe path in {id}: {}", e.name())))?;
        if !parts.is_empty() {
            entries.push((i, parts, e.is_dir()));
        }
    }
    let layout = detect_layout(&entries);
    let mut written = vec![];
    for (i, parts, is_dir) in &entries {
        if *is_dir {
            continue;
        }
        let Some(target) = map_target(&layout, parts, id) else { continue };
        let rel = target.join("/");
        let dest = safe_join(profile_dir, &rel)?;
        let is_config = rel.starts_with(CONFIG_PREFIX);
        if is_config && dest.exists() {
            continue; // never overwrite user configs
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut entry = archive.by_index(*i)?;
        let mut out = File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
        if !is_config {
            written.push(rel);
        }
    }
    written.sort();
    written.dedup();
    Ok(written)
}

/// Local mod: if `src_dir` contains a zip it is extracted, otherwise all files are
/// copied to `BepInEx/plugins/<id>/`.
pub fn install_local(src_dir: &Path, profile_dir: &Path, id: &str) -> Result<Vec<String>> {
    let files: Vec<PathBuf> = std::fs::read_dir(src_dir)?.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()).collect();
    if let Some(zip) = files.iter().find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip"))) {
        return extract_zip(zip, profile_dir, id);
    }
    let mut written = vec![];
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let rel = format!("BepInEx/plugins/{id}/{name}");
        let dest = safe_join(profile_dir, &rel)?;
        std::fs::create_dir_all(dest.parent().unwrap())?;
        std::fs::copy(&f, &dest)?;
        written.push(rel);
    }
    written.sort();
    Ok(written)
}

fn remove_if_exists(p: &Path) -> Result<()> {
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

pub fn remove_files(profile_dir: &Path, files: &[String]) -> Result<()> {
    let mut dirs = BTreeSet::new();
    for f in files {
        let p = safe_join(profile_dir, f)?;
        remove_if_exists(&p)?;
        remove_if_exists(&with_old(&p))?;
        if let Some(parent) = p.parent() {
            dirs.insert(parent.to_path_buf());
        }
    }
    let mut dirs: Vec<PathBuf> = dirs.into_iter().collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for d in dirs {
        let mut cur = d;
        while cur.starts_with(profile_dir) && cur != profile_dir {
            let empty = std::fs::read_dir(&cur).map(|mut rd| rd.next().is_none()).unwrap_or(false);
            if !empty || std::fs::remove_dir(&cur).is_err() {
                break;
            }
            match cur.parent() {
                Some(p) => cur = p.to_path_buf(),
                None => break,
            }
        }
    }
    Ok(())
}

/// Disable = `x` → `x.old`, enable = back. Configs and doorstop files are left alone.
pub fn set_enabled(profile_dir: &Path, files: &[String], enabled: bool) -> Result<()> {
    for f in files.iter().filter(|f| !f.starts_with(CONFIG_PREFIX) && !f.starts_with("doorstop/")) {
        let p = safe_join(profile_dir, f)?;
        let old = with_old(&p);
        if enabled {
            if old.exists() && !p.exists() {
                std::fs::rename(&old, &p)?;
            }
        } else if p.exists() {
            remove_if_exists(&old)?;
            std::fs::rename(&p, &old)?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    pub(crate) fn make_zip(dir: &Path, name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        let mut w = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        for (n, content) in files {
            w.start_file(*n, opts).unwrap();
            w.write_all(content.as_bytes()).unwrap();
        }
        w.finish().unwrap();
        path
    }

    fn read(p: &Path, rel: &str) -> String {
        std::fs::read_to_string(p.join(rel)).unwrap()
    }

    #[test]
    fn bare_layout_goes_to_plugins_folder() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("manifest.json", "{}"), ("icon.png", "x"), ("README.md", "r"), ("Mod.dll", "dll"), ("sub/a.txt", "a")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-Mod").unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/ns-Mod/Mod.dll", "BepInEx/plugins/ns-Mod/sub/a.txt"]);
        assert_eq!(read(&prof, "BepInEx/plugins/ns-Mod/Mod.dll"), "dll");
    }

    #[test]
    fn subfolder_layout_merges_and_protects_configs() {
        let d = tempfile::tempdir().unwrap();
        let prof = d.path().join("p");
        std::fs::create_dir_all(prof.join("BepInEx/config")).unwrap();
        std::fs::write(prof.join("BepInEx/config/mod.cfg"), "user").unwrap();
        let zip = make_zip(
            d.path(),
            "m.zip",
            &[("Plugins/Mod.dll", "dll"), ("config/mod.cfg", "shipped"), ("config/new.cfg", "new"), ("extra.txt", "e"), ("icon.png", "i")],
        );
        let files = extract_zip(&zip, &prof, "ns-Mod").unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/Mod.dll", "BepInEx/plugins/ns-Mod/extra.txt"]);
        assert_eq!(read(&prof, "BepInEx/config/mod.cfg"), "user");
        assert_eq!(read(&prof, "BepInEx/config/new.cfg"), "new");
    }

    #[test]
    fn bepinex_root_layout_merges_directly() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("BepInEx/plugins/X/x.dll", "x"), ("BepInEx/patchers/p.dll", "p"), ("manifest.json", "{}")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-X").unwrap();
        assert_eq!(files, vec!["BepInEx/patchers/p.dll", "BepInEx/plugins/X/x.dll"]);
    }

    #[test]
    fn bepinex_pack_layout_splits_doorstop_files() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(
            d.path(),
            "m.zip",
            &[
                ("manifest.json", "{}"),
                ("BepInExPack_Valheim/winhttp.dll", "w"),
                ("BepInExPack_Valheim/doorstop_config.ini", "[General]"),
                ("BepInExPack_Valheim/.doorstop_version", "4.4.0"),
                ("BepInExPack_Valheim/doorstop_libs/libdoorstop_x64.so", "so"),
                ("BepInExPack_Valheim/start_game_bepinex.sh", "sh"),
                ("BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll", "pre"),
                ("BepInExPack_Valheim/BepInEx/config/BepInEx.cfg", "cfg"),
            ],
        );
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "denikson-BepInExPack_Valheim").unwrap();
        assert_eq!(
            files,
            vec![
                "BepInEx/core/BepInEx.Preloader.dll",
                "doorstop/.doorstop_version",
                "doorstop/doorstop_config.ini",
                "doorstop/doorstop_libs/libdoorstop_x64.so",
                "doorstop/winhttp.dll",
            ]
        );
        assert_eq!(read(&prof, "BepInEx/config/BepInEx.cfg"), "cfg");
        assert!(!prof.join("start_game_bepinex.sh").exists());
    }

    #[test]
    fn rejects_zip_slip() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("../evil.dll", "x")]);
        assert!(extract_zip(&zip, &d.path().join("p"), "ns-X").is_err());
        assert!(!d.path().join("evil.dll").exists());
    }

    #[test]
    fn remove_prunes_empty_dirs_and_old_files() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("a.dll", "a"), ("b.dll", "b")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-M").unwrap();
        set_enabled(&prof, &files[..1], false).unwrap();
        remove_files(&prof, &files).unwrap();
        assert!(!prof.join("BepInEx/plugins/ns-M").exists());
        assert!(prof.exists());
    }

    #[test]
    fn toggling_renames_to_old_and_back() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("a.dll", "a")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-M").unwrap();
        set_enabled(&prof, &files, false).unwrap();
        assert!(prof.join("BepInEx/plugins/ns-M/a.dll.old").exists());
        assert!(!prof.join("BepInEx/plugins/ns-M/a.dll").exists());
        set_enabled(&prof, &files, false).unwrap();
        set_enabled(&prof, &files, true).unwrap();
        assert_eq!(read(&prof, "BepInEx/plugins/ns-M/a.dll"), "a");
    }

    #[test]
    fn installs_local_dll_and_local_zip() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("local/local-Mine");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("Mine.dll"), "m").unwrap();
        let prof = d.path().join("p");
        assert_eq!(install_local(&src, &prof, "local-Mine").unwrap(), vec!["BepInEx/plugins/local-Mine/Mine.dll"]);

        let src2 = d.path().join("local/local-Z");
        std::fs::create_dir_all(&src2).unwrap();
        make_zip(&src2, "z.zip", &[("manifest.json", "{}"), ("z.dll", "z")]);
        assert_eq!(install_local(&src2, &prof, "local-Z").unwrap(), vec!["BepInEx/plugins/local-Z/z.dll"]);
    }
}
