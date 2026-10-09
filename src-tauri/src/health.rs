//! Health hints for a profile: duplicate DLLs, deprecated mods, mods older than the last game update.
use crate::models::{Installed, Pkg, ProfileMod, Source};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
    /// "duplicate" | "deprecated" | "stale"
    pub kind: &'static str,
    pub ids: Vec<String>,
    /// duplicate: the file name; stale: the mod's last update (ms); deprecated: empty
    pub detail: String,
}

fn dll_name(rel: &str) -> Option<String> {
    if rel.starts_with("doorstop/") || rel.starts_with("BepInEx/core/") {
        return None;
    }
    let name = rel.rsplit('/').next()?;
    name.to_ascii_lowercase().ends_with(".dll").then(|| name.to_string())
}

pub fn check(mods: &[ProfileMod], installed: &Installed, by_id: Option<&HashMap<String, Pkg>>, game_updated: Option<i64>) -> Vec<HealthIssue> {
    let mut out = vec![];

    // Same DLL file name installed by more than one package (case-insensitive).
    let mut owners: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();
    for (id, entry) in installed {
        for f in &entry.files {
            if let Some(name) = dll_name(f) {
                let e = owners.entry(name.to_ascii_lowercase()).or_insert_with(|| (name.clone(), vec![]));
                if !e.1.contains(id) {
                    e.1.push(id.clone());
                }
            }
        }
    }
    for (_, (name, ids)) in owners {
        if ids.len() > 1 {
            out.push(HealthIssue { kind: "duplicate", ids, detail: name });
        }
    }

    if let Some(by_id) = by_id {
        for m in mods.iter().filter(|m| m.source == Source::Thunderstore) {
            let Some(p) = by_id.get(&m.id()) else { continue };
            if p.dep {
                out.push(HealthIssue { kind: "deprecated", ids: vec![m.id()], detail: String::new() });
            }
            if let Some(g) = game_updated {
                if p.upd > 0 && p.upd < g {
                    out.push(HealthIssue { kind: "stale", ids: vec![m.id()], detail: p.upd.to_string() });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{test_pkg, InstalledEntry};

    fn entry(files: &[&str]) -> InstalledEntry {
        InstalledEntry { version: "1.0.0".into(), files: files.iter().map(|f| f.to_string()).collect() }
    }

    #[test]
    fn finds_duplicate_dlls_ignoring_core_and_doorstop() {
        let mut inst = Installed::new();
        inst.insert("a-A".into(), entry(&["BepInEx/plugins/a-A/A.dll", "BepInEx/plugins/a-A/Shared.dll"]));
        inst.insert("b-B".into(), entry(&["BepInEx/plugins/B/shared.DLL", "BepInEx/plugins/B/readme.txt"]));
        inst.insert("c-C".into(), entry(&["BepInEx/core/Shared.dll", "doorstop/Shared.dll"]));
        let issues = check(&[], &inst, None, None);
        assert_eq!(issues, vec![HealthIssue { kind: "duplicate", ids: vec!["a-A".into(), "b-B".into()], detail: "Shared.dll".into() }]);
    }

    #[test]
    fn flags_deprecated_and_stale_mods() {
        let mut old = test_pkg("a-A", &[("1.0.0", &[])]);
        old.upd = 1_000;
        let mut dep = test_pkg("b-B", &[("1.0.0", &[])]);
        dep.dep = true;
        dep.upd = 5_000;
        let mut fresh = test_pkg("c-C", &[("1.0.0", &[])]);
        fresh.upd = 5_000;
        let idx: HashMap<String, Pkg> = [old, dep, fresh].into_iter().map(|p| (p.id.clone(), p)).collect();
        let mods = vec![ProfileMod::thunderstore("a", "A", "1.0.0"), ProfileMod::thunderstore("b", "B", "1.0.0"), ProfileMod::thunderstore("c", "C", "1.0.0")];
        let issues = check(&mods, &Installed::new(), Some(&idx), Some(3_000));
        assert_eq!(issues.iter().map(|i| (i.kind, i.ids[0].as_str())).collect::<Vec<_>>(), vec![("stale", "a-A"), ("deprecated", "b-B")]);
        assert_eq!(issues[0].detail, "1000");
        assert!(check(&mods, &Installed::new(), Some(&idx), None).iter().all(|i| i.kind == "deprecated"));
    }
}
