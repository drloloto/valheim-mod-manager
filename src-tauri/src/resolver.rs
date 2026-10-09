use crate::models::{Installed, Pkg, Plan, ProfileMod, Resolved, Source, ToInstall};
use crate::util::{cmp_version, parse_full_name};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

pub const BEPINEX_PACK_ID: &str = "denikson-BepInExPack_Valheim";

/// Every dependency on a BepInExPack points to the one Valheim pack.
pub fn canonical_id(ns: &str, name: &str) -> String {
    if name.to_ascii_lowercase().starts_with("bepinexpack") {
        BEPINEX_PACK_ID.to_string()
    } else {
        format!("{ns}-{name}")
    }
}

struct Resolver<'a> {
    by_id: &'a HashMap<String, Pkg>,
    resolved: BTreeMap<String, Resolved>,
    errors: Vec<String>,
}

impl Resolver<'_> {
    fn visit(&mut self, ns: &str, name: &str, version: &str, parent: Option<&str>) {
        let id = canonical_id(ns, name);
        let by_id = self.by_id;
        let Some(pkg) = by_id.get(&id) else {
            let from = parent.map(|p| format!(" (required by {p})")).unwrap_or_default();
            self.errors.push(format!("Package not found: {id}{from}"));
            return;
        };
        let Some(latest) = pkg.versions.first() else { return };
        let want = if pkg.versions.iter().any(|v| v.v == version) { version.to_string() } else { latest.v.clone() };
        match self.resolved.get_mut(&id) {
            Some(cur) => {
                if let Some(p) = parent {
                    if !cur.required_by.iter().any(|x| x == p) {
                        cur.required_by.push(p.to_string());
                    }
                }
                if cmp_version(&want, &cur.version) != Ordering::Greater {
                    return;
                }
                cur.version = want.clone();
            }
            None => {
                self.resolved.insert(id.clone(), Resolved { version: want.clone(), required_by: parent.map(|p| vec![p.to_string()]).unwrap_or_default() });
            }
        }
        let deps = pkg.versions.iter().find(|v| v.v == want).map(|v| v.deps.clone()).unwrap_or_default();
        for d in deps {
            if let Some(f) = parse_full_name(&d) {
                self.visit(&f.ns, &f.name, &f.version, Some(&id));
            }
        }
    }
}

/// Pure function: dependency closure of the profile plus the diff against installed.json.
pub fn plan(mods: &[ProfileMod], by_id: &HashMap<String, Pkg>, installed: &Installed) -> Plan {
    let mut r = Resolver { by_id, resolved: BTreeMap::new(), errors: vec![] };
    for m in mods {
        match m.source {
            Source::Thunderstore => r.visit(&m.namespace, &m.name, &m.version, None),
            Source::Local => {
                let id = m.id();
                r.resolved.insert(id.clone(), Resolved { version: m.version.clone(), required_by: vec![] });
                for d in &m.deps {
                    if let Some(f) = parse_full_name(d) {
                        r.visit(&f.ns, &f.name, &f.version, Some(&id));
                    }
                }
            }
        }
    }
    if !mods.is_empty() && !r.resolved.contains_key(BEPINEX_PACK_ID) {
        match by_id.get(BEPINEX_PACK_ID).and_then(|p| p.versions.first().map(|v| (p, v.v.clone()))) {
            Some((p, v)) => r.visit(&p.ns, &p.name, &v, None),
            None => r.errors.push("BepInExPack_Valheim is not in the mod index.".to_string()),
        }
    }
    let mut errors = r.errors;
    errors.dedup();
    let to_install = r
        .resolved
        .iter()
        .filter(|(id, res)| installed.get(*id).map(|e| &e.version) != Some(&res.version))
        .map(|(id, res)| ToInstall { id: id.clone(), from: installed.get(id).map(|e| e.version.clone()), to: res.version.clone() })
        .collect();
    let to_remove = installed.keys().filter(|id| !r.resolved.contains_key(*id)).cloned().collect();
    Plan { resolved: r.resolved, to_install, to_remove, errors }
}

/// Explicit Thunderstore mods for which the index knows a newer version.
pub fn updates(mods: &[ProfileMod], by_id: &HashMap<String, Pkg>) -> BTreeMap<String, String> {
    mods.iter()
        .filter(|m| m.source == Source::Thunderstore)
        .filter_map(|m| {
            let latest = by_id.get(&m.id())?.versions.first()?;
            (cmp_version(&m.version, &latest.v) == Ordering::Less).then(|| (m.id(), latest.v.clone()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{test_pkg, InstalledEntry, ProfileMod, Source, ToInstall};

    fn index(pkgs: Vec<Pkg>) -> HashMap<String, Pkg> {
        let mut all = pkgs;
        all.push(test_pkg("denikson-BepInExPack_Valheim", &[("5.4.2351", &[]), ("5.4.2333", &[])]));
        all.into_iter().map(|p| (p.id.clone(), p)).collect()
    }
    fn m(id: &str, v: &str) -> ProfileMod {
        let (ns, name) = id.split_once('-').unwrap();
        ProfileMod::thunderstore(ns, name, v)
    }

    #[test]
    fn resolves_chain_and_adds_bepinex_pack() {
        let idx = index(vec![test_pkg("a-A", &[("1.0.0", &["b-B-1.0.0"])]), test_pkg("b-B", &[("1.0.0", &["c-C-1.0.0"])]), test_pkg("c-C", &[("1.0.0", &[])])]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved.len(), 4);
        assert_eq!(p.resolved["c-C"].required_by, vec!["b-B"]);
        assert_eq!(p.resolved[BEPINEX_PACK_ID].version, "5.4.2351");
        assert!(p.resolved[BEPINEX_PACK_ID].required_by.is_empty());
        assert_eq!(p.to_install.len(), 4);
        assert!(p.errors.is_empty());
    }

    #[test]
    fn empty_profile_needs_nothing() {
        let p = plan(&[], &index(vec![]), &Installed::new());
        assert!(p.resolved.is_empty());
    }

    #[test]
    fn explicit_pack_dependency_keeps_requested_version() {
        let idx = index(vec![test_pkg("a-A", &[("1.0.0", &["denikson-BepInExPack_Valheim-5.4.2333"])])]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved[BEPINEX_PACK_ID].version, "5.4.2333");
        assert_eq!(p.resolved[BEPINEX_PACK_ID].required_by, vec!["a-A"]);
    }

    #[test]
    fn diamond_upgrades_to_newest_and_walks_new_deps() {
        let idx = index(vec![
            test_pkg("a-A", &[("1.0.0", &["c-C-1.0.0"])]),
            test_pkg("b-B", &[("1.0.0", &["c-C-2.0.0"])]),
            test_pkg("c-C", &[("2.0.0", &["d-D-1.0.0"]), ("1.0.0", &[])]),
            test_pkg("d-D", &[("1.0.0", &[])]),
        ]);
        let p = plan(&[m("a-A", "1.0.0"), m("b-B", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved["c-C"].version, "2.0.0");
        assert_eq!(p.resolved["c-C"].required_by, vec!["a-A", "b-B"]);
        assert!(p.resolved.contains_key("d-D"));
    }

    #[test]
    fn reports_missing_and_survives_cycles() {
        let idx = index(vec![test_pkg("a-A", &[("1.0.0", &["b-B-1.0.0", "x-Gone-1.0.0"])]), test_pkg("b-B", &[("1.0.0", &["a-A-1.0.0"])])]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.errors, vec!["Package not found: x-Gone (required by a-A)"]);
        assert_eq!(p.resolved["a-A"].required_by, vec!["b-B"]);
    }

    #[test]
    fn unknown_version_falls_back_to_latest() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let p = plan(&[m("a-A", "9.9.9")], &idx, &Installed::new());
        assert_eq!(p.resolved["a-A"].version, "2.0.0");
    }

    #[test]
    fn local_mods_resolve_their_deps() {
        let idx = index(vec![test_pkg("b-B", &[("1.0.0", &[])])]);
        let local = ProfileMod {
            namespace: "local".into(),
            name: "Mine".into(),
            version: "0.1.0".into(),
            enabled: true,
            source: Source::Local,
            deps: vec!["b-B-1.0.0".into()],
        };
        let p = plan(&[local], &idx, &Installed::new());
        assert_eq!(p.resolved["local-Mine"].version, "0.1.0");
        assert_eq!(p.resolved["b-B"].required_by, vec!["local-Mine"]);
        assert!(p.errors.is_empty());
    }

    #[test]
    fn diffs_against_installed() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let mut inst = Installed::new();
        inst.insert("a-A".into(), InstalledEntry { version: "1.0.0".into(), files: vec![] });
        inst.insert("old-Old".into(), InstalledEntry { version: "1.0.0".into(), files: vec![] });
        inst.insert(BEPINEX_PACK_ID.into(), InstalledEntry { version: "5.4.2351".into(), files: vec![] });
        let p = plan(&[m("a-A", "2.0.0")], &idx, &inst);
        assert_eq!(p.to_install, vec![ToInstall { id: "a-A".into(), from: Some("1.0.0".into()), to: "2.0.0".into() }]);
        assert_eq!(p.to_remove, vec!["old-Old"]);
    }

    #[test]
    fn lists_updates_for_explicit_mods() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let u = updates(&[m("a-A", "1.0.0")], &idx);
        assert_eq!(u.get("a-A").map(String::as_str), Some("2.0.0"));
        assert!(updates(&[m("a-A", "2.0.0")], &idx).is_empty());
    }
}
