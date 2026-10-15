//! Imports profiles from r2modman and the Thunderstore Mod Manager (both keep a `mods.yml` per profile).
use crate::config::list_files_with_ext;
use crate::error::{AppError, Result};
use crate::models::ProfileMod;
use crate::share::{R2zContents, CONFIG_EXTS};
use crate::util::safe_join;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForeignProfile {
    /// "r2modman" or "tmm"
    pub manager: String,
    pub name: String,
    pub path: String,
    pub mods: usize,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct YmlVersion {
    #[serde(default)]
    major: u32,
    #[serde(default)]
    minor: u32,
    #[serde(default)]
    patch: u32,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct YmlMod {
    name: String,
    #[serde(default)]
    version_number: YmlVersion,
    #[serde(default = "yes")]
    enabled: bool,
    /// false for mods the user installed from a local file
    #[serde(default = "yes")]
    online_source: bool,
}

/// Profile folders of both managers below the roaming app data folder.
pub fn candidates(roaming: &Path) -> Vec<ForeignProfile> {
    let roots = [
        ("r2modman", roaming.join("r2modmanPlus-local").join("Valheim").join("profiles")),
        ("tmm", roaming.join("Thunderstore Mod Manager").join("DataFolder").join("Valheim").join("profiles")),
    ];
    let mut out = vec![];
    for (manager, dir) in roots {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            let yml = path.join("mods.yml");
            if !yml.is_file() {
                continue;
            }
            let mods = std::fs::read_to_string(&yml).ok().map(|t| parse_mods_yml(&t).0.len()).unwrap_or(0);
            out.push(ForeignProfile {
                manager: manager.into(),
                name: e.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                mods,
            });
        }
    }
    out.sort_by(|a, b| a.manager.cmp(&b.manager).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// → (mods, skipped entries). Local mods and entries without a namespace are skipped.
pub fn parse_mods_yml(text: &str) -> (Vec<ProfileMod>, Vec<String>) {
    let entries: Vec<YmlMod> = serde_yaml_ng::from_str(text).unwrap_or_default();
    let mut mods = vec![];
    let mut skipped = vec![];
    for m in entries {
        match m.name.split_once('-') {
            Some((ns, name)) if m.online_source && !ns.is_empty() && !name.is_empty() => {
                let v = format!("{}.{}.{}", m.version_number.major, m.version_number.minor, m.version_number.patch);
                mods.push(ProfileMod { enabled: m.enabled, ..ProfileMod::thunderstore(ns, name, &v) });
            }
            _ => skipped.push(m.name),
        }
    }
    (mods, skipped)
}

/// Reads a foreign profile folder into the same shape an `.r2z` import produces.
pub fn read_profile(dir: &Path) -> Result<R2zContents> {
    let dir = PathBuf::from(dir);
    let text = std::fs::read_to_string(dir.join("mods.yml")).map_err(|_| AppError::Invalid(format!("No mods.yml in {}", dir.display())))?;
    let (mods, skipped) = parse_mods_yml(&text);
    let config_dir = dir.join("BepInEx").join("config");
    let mut configs = vec![];
    for rel in list_files_with_ext(&config_dir, &CONFIG_EXTS) {
        if let Ok(bytes) = std::fs::read(safe_join(&config_dir, &rel)?) {
            configs.push((rel, bytes));
        }
    }
    let profile_name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "import".into());
    Ok(R2zContents { profile_name, mods, configs, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    const YML: &str = "- manifestVersion: 1\n  name: denikson-BepInExPack_Valheim\n  authorName: denikson\n  versionNumber:\n    major: 5\n    minor: 4\n    patch: 2351\n  enabled: true\n  onlineSource: true\n- manifestVersion: 1\n  name: ValheimModding-Jotunn\n  versionNumber: {major: 2, minor: 20, patch: 1}\n  enabled: false\n- name: MyLocalMod\n  versionNumber: {major: 1, minor: 0, patch: 0}\n  onlineSource: false\n- name: nonamespace\n";

    #[test]
    fn parses_mods_yml_and_skips_local_entries() {
        let (mods, skipped) = parse_mods_yml(YML);
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].id(), "denikson-BepInExPack_Valheim");
        assert_eq!(mods[0].version, "5.4.2351");
        assert!(!mods[1].enabled);
        assert_eq!(mods[1].version, "2.20.1");
        assert_eq!(skipped, vec!["MyLocalMod", "nonamespace"]);
        assert!(parse_mods_yml("not: [yaml").0.is_empty());
    }

    #[test]
    fn scans_both_managers_and_reads_configs() {
        let d = tempfile::tempdir().unwrap();
        let r2 = d.path().join("r2modmanPlus-local/Valheim/profiles/Friends");
        let tmm = d.path().join("Thunderstore Mod Manager/DataFolder/Valheim/profiles/Default");
        std::fs::create_dir_all(r2.join("BepInEx/config/sub")).unwrap();
        std::fs::create_dir_all(&tmm).unwrap();
        std::fs::write(r2.join("mods.yml"), YML).unwrap();
        std::fs::write(r2.join("BepInEx/config/a.cfg"), "k = v").unwrap();
        std::fs::write(r2.join("BepInEx/config/sub/b.json"), "{}").unwrap();
        std::fs::write(tmm.join("mods.yml"), "[]").unwrap();
        std::fs::create_dir_all(d.path().join("r2modmanPlus-local/Valheim/profiles/NoYml")).unwrap();

        let c = candidates(d.path());
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].manager.as_str(), c[0].name.as_str(), c[0].mods), ("r2modman", "Friends", 2));
        assert_eq!((c[1].manager.as_str(), c[1].name.as_str(), c[1].mods), ("tmm", "Default", 0));

        let p = read_profile(&r2).unwrap();
        assert_eq!(p.profile_name, "Friends");
        assert_eq!(p.mods.len(), 2);
        let names: Vec<&str> = p.configs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["a.cfg", "sub/b.json"]);
        assert!(read_profile(&d.path().join("missing")).is_err());
    }
}
