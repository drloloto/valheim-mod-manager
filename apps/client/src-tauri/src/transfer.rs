//! The transfer assistant: compares a source (a server's lock or another profile) with a target profile,
//! sorts every mod into one case, and applies the player's decisions. The server kind is `server::adopt`
//! plus per-item choices; the profile kind is an additive copy. `check_locks` is the rule that keeps a
//! server's mods read-only while a profile's Override is off.
use crate::error::{AppError, Result};
use crate::models::{Profile, ProfileMod, Source};
use crate::server::{self, ManifestMod};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// The source is the linked server's lock: the target becomes the server's profile.
    Server,
    /// The source is another profile: its mods are copied into the target.
    Profile,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Case {
    /// In the source, not in the target.
    Add,
    /// Same mod, same version.
    Same,
    /// Same mod, another version in the target.
    Version,
    /// Server-managed in the target, no longer on the server.
    Dropped,
    /// In the target, unknown to the source (the player's own, or a local mod).
    Extra,
    /// Optional in the server's lock (recommended, not required): offered, never managed.
    Optional,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    /// Apply the source: install, set the version, or (for `dropped`) remove.
    Take,
    /// Leave the target entry as it is (for `dropped`: keep it as the player's own).
    Keep,
    /// Remove the target entry (for `extra`).
    Remove,
}

/// Thunderstore's side categories, when the index knows the package.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Server,
    Client,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub ns: String,
    pub name: String,
    pub case: Case,
    /// The target's version before; None for `add`.
    pub from: Option<String>,
    /// The source's version; None for `dropped` and `extra`.
    pub to: Option<String>,
    /// A local (imported) mod: never on a server, copied with its files between profiles.
    pub local: bool,
    /// The target entry is the server's and the profile's Override is off: the item cannot change.
    pub locked: bool,
    /// Server-managed after the transfer (server kind: everything the server lists).
    pub managed: bool,
    pub side: Option<Side>,
    pub decision: Decision,
    /// Which decisions the player may pick for this item.
    pub choices: Vec<Decision>,
}

/// One entry of the source as the planner sees it.
#[derive(Clone, Debug)]
pub struct SourceMod {
    pub ns: String,
    pub name: String,
    pub version: String,
    pub local: bool,
    pub deps: Vec<String>,
    pub pinned: bool,
    /// Recommended, not required (a lock's `optional`, or the flag on a profile's entry).
    pub optional: bool,
}

impl SourceMod {
    pub fn id(&self) -> String {
        format!("{}-{}", self.ns, self.name)
    }
    pub fn from_profile(m: &ProfileMod) -> Self {
        SourceMod {
            ns: m.namespace.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            local: m.source == Source::Local,
            deps: m.deps.clone(),
            pinned: m.pinned,
            optional: m.optional,
        }
    }
    pub fn from_manifest(m: &ManifestMod) -> Option<Self> {
        let (ns, name) = m.split()?;
        Some(SourceMod { ns: ns.into(), name: name.into(), version: m.version.clone(), local: false, deps: vec![], pinned: true, optional: m.optional })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub decision: Decision,
}

/// Sorts every mod of source and target into a case with a default decision. `target` is the profile as
/// it is (an empty one for a new target); implicit entries (a server's dependencies) are not listed.
pub fn plan(kind: Kind, target: &Profile, source: &[SourceMod], side_of: &dyn Fn(&str) -> Option<Side>) -> Vec<Item> {
    let unlocked = target.override_locks;
    let servers = server::servers_ids(target);
    let by_id: HashMap<String, &ProfileMod> = target.mods.iter().map(|m| (m.id(), m)).collect();
    let mut items = vec![];
    let mut seen = HashSet::new();
    for s in source {
        let id = s.id();
        if server::is_pack(&id) || !seen.insert(id.clone()) {
            continue;
        }
        let t = by_id.get(&id);
        if kind == Kind::Server && s.optional {
            // Recommended by the server: install it (the default for a target that never adopted) or skip
            // it; an entry the target has stays the player's, in their version unless they take the server's.
            let never_adopted = target.server.as_ref().is_none_or(|l| l.last_adopted.is_none());
            let (decision, choices) = match t {
                None => (if never_adopted { Decision::Take } else { Decision::Keep }, vec![Decision::Take, Decision::Keep]),
                Some(t) if t.version == s.version => (Decision::Keep, vec![Decision::Keep]),
                Some(_) => (Decision::Keep, vec![Decision::Keep, Decision::Take]),
            };
            items.push(Item {
                id: id.clone(),
                ns: s.ns.clone(),
                name: s.name.clone(),
                case: Case::Optional,
                from: t.map(|t| t.version.clone()),
                to: Some(s.version.clone()),
                local: false,
                locked: false,
                managed: false,
                side: side_of(&id),
                decision,
                choices,
            });
            continue;
        }
        let (case, from) = match t {
            None => (Case::Add, None),
            Some(t) if t.version == s.version => (Case::Same, Some(t.version.clone())),
            Some(t) => (Case::Version, Some(t.version.clone())),
        };
        let locked = kind == Kind::Profile && case == Case::Version && t.is_some_and(|t| t.managed) && !unlocked;
        let (decision, choices) = match (kind, case) {
            (Kind::Server, _) => (Decision::Take, vec![Decision::Take]),
            (Kind::Profile, Case::Same) => (Decision::Keep, vec![Decision::Keep]),
            (Kind::Profile, Case::Add) => (Decision::Take, vec![Decision::Take, Decision::Keep]),
            (Kind::Profile, _) if locked => (Decision::Keep, vec![Decision::Keep]),
            (Kind::Profile, _) => (Decision::Take, vec![Decision::Take, Decision::Keep]),
        };
        items.push(Item {
            id: id.clone(),
            ns: s.ns.clone(),
            name: s.name.clone(),
            case,
            from,
            to: Some(s.version.clone()),
            local: s.local,
            locked,
            managed: kind == Kind::Server,
            side: side_of(&id),
            decision,
            choices,
        });
    }
    if kind == Kind::Server {
        for t in target.mods.iter().filter(|m| !m.implicit) {
            let id = t.id();
            if seen.contains(&id) || server::is_pack(&id) {
                continue;
            }
            let dropped = servers.contains(&id);
            let (case, decision) = if dropped { (Case::Dropped, Decision::Take) } else { (Case::Extra, Decision::Keep) };
            items.push(Item {
                id: id.clone(),
                ns: t.namespace.clone(),
                name: t.name.clone(),
                case,
                from: Some(t.version.clone()),
                to: None,
                local: t.source == Source::Local,
                locked: false,
                managed: false,
                side: side_of(&id),
                decision,
                choices: if dropped { vec![Decision::Take, Decision::Keep] } else { vec![Decision::Keep, Decision::Remove] },
            });
        }
    }
    items
}

/// The decision for an item: the player's choice when it is one of the item's options, else the default.
fn decision_of(item: &Item, choices: &[Choice]) -> Decision {
    choices.iter().find(|c| c.id == item.id).map(|c| c.decision).filter(|d| item.choices.contains(d)).unwrap_or(item.decision)
}

/// Writes the plan into the target. Server kind: `server::adopt` does the server's part (`manifest` is
/// its list), then `dropped` entries chosen "keep" come back as the player's own and `extra` entries
/// chosen "remove" go. Profile kind: taken entries are upserted as the player's own; locked ones never
/// change. Returns the ids of local mods whose files the caller has to copy from the source profile.
pub fn apply(kind: Kind, target: &mut Profile, items: &[Item], choices: &[Choice], manifest: &[ManifestMod], source: &[SourceMod]) -> Vec<String> {
    let mut copy_local = vec![];
    let src: HashMap<String, &SourceMod> = source.iter().map(|s| (s.id(), s)).collect();
    match kind {
        Kind::Server => {
            let before: HashMap<String, ProfileMod> = target.mods.iter().map(|m| (m.id(), m.clone())).collect();
            // The assistant decides per optional item; adopt itself adds none of them here.
            server::adopt(target, manifest, false);
            let mut remove = HashSet::new();
            for item in items {
                match (item.case, decision_of(item, choices)) {
                    (Case::Dropped, Decision::Keep) => {
                        if let Some(old) = before.get(&item.id) {
                            if !target.mods.iter().any(|m| m.id() == item.id) {
                                target.mods.push(ProfileMod { managed: false, implicit: false, ..old.clone() });
                            }
                        }
                    }
                    (Case::Extra, Decision::Remove) => {
                        remove.insert(item.id.clone());
                    }
                    (Case::Optional, d) => {
                        let Some(s) = src.get(&item.id) else { continue };
                        match target.mods.iter_mut().find(|m| m.id() == item.id) {
                            Some(t) => {
                                t.optional = true;
                                if d == Decision::Take {
                                    t.version = s.version.clone();
                                }
                            }
                            None if d == Decision::Take => {
                                target.mods.push(ProfileMod { optional: true, ..ProfileMod::thunderstore(&s.ns, &s.name, &s.version) })
                            }
                            None => {}
                        }
                    }
                    _ => {}
                }
            }
            target.mods.retain(|m| !remove.contains(&m.id()));
        }
        Kind::Profile => {
            for item in items {
                if item.locked || decision_of(item, choices) != Decision::Take || !matches!(item.case, Case::Add | Case::Version) {
                    continue;
                }
                let Some(s) = src.get(&item.id) else { continue };
                let entry = ProfileMod {
                    namespace: s.ns.clone(),
                    name: s.name.clone(),
                    version: s.version.clone(),
                    enabled: true,
                    source: if s.local { Source::Local } else { Source::Thunderstore },
                    pinned: s.pinned,
                    deps: s.deps.clone(),
                    implicit: false,
                    managed: false,
                    optional: s.optional,
                };
                match target.mods.iter_mut().find(|m| m.id() == item.id) {
                    // A server-managed entry stays the server's, in the source's version (Override is on here).
                    Some(t) => *t = ProfileMod { managed: t.managed, enabled: t.enabled, ..entry },
                    None => target.mods.push(entry),
                }
                if s.local {
                    copy_local.push(item.id.clone());
                }
            }
        }
    }
    copy_local
}

/// The lock rule for every edit of a profile's list: while Override is off, a server-managed entry keeps
/// its version and enabled state and cannot be removed. Returns the names of the entries an edit touches.
pub fn check_locks(old: &Profile, new: &[ProfileMod]) -> Result<()> {
    if old.override_locks {
        return Ok(());
    }
    let mut touched = vec![];
    for m in old.mods.iter().filter(|m| m.managed) {
        match new.iter().find(|n| n.id() == m.id()) {
            Some(n) if n.version == m.version && n.enabled == m.enabled => {}
            _ => touched.push(m.name.clone()),
        }
    }
    if touched.is_empty() {
        return Ok(());
    }
    Err(AppError::Invalid(format!("Managed by the server, switch on Override in the profile settings to change it: {}", touched.join(", "))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ServerLink, Store};

    fn mm(id: &str, v: &str) -> ManifestMod {
        ManifestMod {
            id: id.into(),
            version: v.into(),
            explicit: true,
            required_by: vec![],
            ns: String::new(),
            name: String::new(),
            source: Store::Thunderstore,
            optional: false,
        }
    }
    fn managed(ns: &str, name: &str, v: &str) -> ProfileMod {
        ProfileMod { managed: true, pinned: true, ..ProfileMod::thunderstore(ns, name, v) }
    }
    fn local(name: &str) -> ProfileMod {
        ProfileMod { namespace: "local".into(), source: Source::Local, ..ProfileMod::thunderstore("local", name, "1.0.0") }
    }
    fn no_side(_: &str) -> Option<Side> {
        None
    }
    fn find(p: &Profile, id: &str) -> Option<ProfileMod> {
        p.mods.iter().find(|m| m.id() == id).cloned()
    }
    fn case_of<'a>(items: &'a [Item], id: &str) -> &'a Item {
        items.iter().find(|i| i.id == id).unwrap()
    }

    #[test]
    fn optional_server_mods_are_offered_not_imposed() {
        let opt = |ns: &str, name: &str, v: &str| SourceMod { optional: true, ..SourceMod::from_profile(&ProfileMod::thunderstore(ns, name, v)) };
        let source =
            vec![SourceMod::from_profile(&managed("a", "Req", "1.0.0")), opt("b", "Nice", "1.0.0"), opt("c", "Have", "1.0.0"), opt("d", "Older", "2.0.0")];
        // A target that never adopted: the missing optional mod is taken by default, the others stay as they are.
        let fresh =
            Profile { mods: vec![ProfileMod::thunderstore("c", "Have", "1.0.0"), ProfileMod::thunderstore("d", "Older", "1.0.0")], ..Default::default() };
        let items = plan(Kind::Server, &fresh, &source, &no_side);
        let nice = case_of(&items, "b-Nice");
        assert_eq!(
            (nice.case, nice.decision, nice.managed, nice.choices.clone()),
            (Case::Optional, Decision::Take, false, vec![Decision::Take, Decision::Keep])
        );
        assert_eq!((case_of(&items, "c-Have").case, case_of(&items, "c-Have").choices.clone()), (Case::Optional, vec![Decision::Keep]));
        assert_eq!((case_of(&items, "d-Older").decision, case_of(&items, "d-Older").choices.clone()), (Decision::Keep, vec![Decision::Keep, Decision::Take]));
        assert!(case_of(&items, "a-Req").managed);
        // A target that adopted before: skip is the default.
        let seasoned = Profile { server: Some(ServerLink { last_adopted: Some("x".into()), ..Default::default() }), ..fresh.clone() };
        assert_eq!(case_of(&plan(Kind::Server, &seasoned, &source, &no_side), "b-Nice").decision, Decision::Keep);
        // Apply with the defaults: b installed as optional, d keeps the player's version, nothing optional is managed.
        let mut target = fresh.clone();
        let manifest: Vec<ManifestMod> = source.iter().map(|s| ManifestMod { optional: s.optional, ..mm(&s.id(), &s.version) }).collect();
        apply(Kind::Server, &mut target, &items, &[], &manifest, &source);
        assert_eq!(find(&target, "b-Nice").map(|m| (m.version, m.managed, m.optional)), Some(("1.0.0".into(), false, true)));
        assert_eq!(find(&target, "d-Older").map(|m| (m.version, m.optional)), Some(("1.0.0".into(), true)));
        assert!(find(&target, "a-Req").is_some_and(|m| m.managed && !m.optional));
        // Skipping b and taking the server's d: b stays out, d moves to 2.0.0 and stays unmanaged.
        let mut target = fresh.clone();
        let choices = [Choice { id: "b-Nice".into(), decision: Decision::Keep }, Choice { id: "d-Older".into(), decision: Decision::Take }];
        apply(Kind::Server, &mut target, &items, &choices, &manifest, &source);
        assert!(find(&target, "b-Nice").is_none());
        assert_eq!(find(&target, "d-Older").map(|m| (m.version, m.managed, m.optional)), Some(("2.0.0".into(), false, true)));
        // Locks never hold an optional entry.
        assert!(check_locks(&target, &[]).is_ok() || !target.mods.iter().any(|m| m.optional && m.managed));
    }

    #[test]
    fn server_plan_sorts_every_combination() {
        // The owner's matrix: empty profile, same version, other version, server-dropped, unknown, local.
        let target = Profile {
            mods: vec![
                managed("a", "Same", "1.0.0"),
                managed("b", "Older", "1.0.0"),
                managed("c", "Gone", "1.0.0"),
                ProfileMod::thunderstore("d", "Mine", "2.0.0"),
                local("Hand"),
            ],
            ..Default::default()
        };
        let manifest = [mm("a-Same", "1.0.0"), mm("b-Older", "1.2.0"), mm("e-New", "0.1.0"), mm("denikson-BepInExPack_Valheim", "5.4.2351")];
        let source: Vec<SourceMod> = manifest.iter().filter_map(SourceMod::from_manifest).collect();
        let side = |id: &str| if id == "d-Mine" { Some(Side::Server) } else { None };
        let items = plan(Kind::Server, &target, &source, &side);
        assert_eq!(items.len(), 6, "the pack is not listed: {items:?}");
        assert_eq!((case_of(&items, "a-Same").case, case_of(&items, "a-Same").managed), (Case::Same, true));
        let older = case_of(&items, "b-Older");
        assert_eq!((older.case, older.from.as_deref(), older.to.as_deref()), (Case::Version, Some("1.0.0"), Some("1.2.0")));
        assert_eq!((case_of(&items, "e-New").case, case_of(&items, "e-New").decision), (Case::Add, Decision::Take));
        let gone = case_of(&items, "c-Gone");
        assert_eq!((gone.case, gone.decision, gone.choices.clone()), (Case::Dropped, Decision::Take, vec![Decision::Take, Decision::Keep]));
        let mine = case_of(&items, "d-Mine");
        assert_eq!((mine.case, mine.decision, mine.side), (Case::Extra, Decision::Keep, Some(Side::Server)));
        let hand = case_of(&items, "local-Hand");
        assert_eq!((hand.case, hand.local, hand.managed), (Case::Extra, true, false));

        // Empty profile: everything is an add.
        let empty = Profile::default();
        assert!(plan(Kind::Server, &empty, &source, &no_side).iter().all(|i| i.case == Case::Add && i.managed));
    }

    #[test]
    fn server_apply_adopts_then_honours_keep_and_remove() {
        let mut target = Profile {
            mods: vec![managed("b", "Older", "1.0.0"), managed("c", "Gone", "1.0.0"), ProfileMod::thunderstore("d", "Mine", "2.0.0"), local("Hand")],
            server: Some(ServerLink::default()),
            ..Default::default()
        };
        let manifest = [mm("b-Older", "1.2.0"), mm("e-New", "0.1.0")];
        let source: Vec<SourceMod> = manifest.iter().filter_map(SourceMod::from_manifest).collect();
        let items = plan(Kind::Server, &target, &source, &no_side);
        let choices = [Choice { id: "c-Gone".into(), decision: Decision::Keep }, Choice { id: "d-Mine".into(), decision: Decision::Remove }];
        let copy = apply(Kind::Server, &mut target, &items, &choices, &manifest, &source);
        assert!(copy.is_empty());
        let get = |id: &str| find(&target, id);
        assert_eq!(get("b-Older").map(|m| (m.version, m.managed)), Some(("1.2.0".into(), true)));
        assert_eq!(get("e-New").map(|m| (m.version, m.managed, m.pinned)), Some(("0.1.0".into(), true, true)));
        // Kept after the server dropped it: the player's own now, no longer the server's.
        assert_eq!(get("c-Gone").map(|m| m.managed), Some(false));
        assert!(get("d-Mine").is_none(), "removed on request");
        assert!(get("local-Hand").is_some(), "a local extra stays by default");
    }

    #[test]
    fn profile_copy_is_additive_and_respects_locks() {
        let src_profile = Profile {
            mods: vec![
                ProfileMod::thunderstore("a", "A", "2.0.0"),
                ProfileMod::thunderstore("b", "B", "1.0.0"),
                ProfileMod::thunderstore("n", "New", "1.0.0"),
                local("Hand"),
            ],
            ..Default::default()
        };
        let source: Vec<SourceMod> = src_profile.mods.iter().map(SourceMod::from_profile).collect();
        let mut target = Profile {
            mods: vec![managed("a", "A", "1.0.0"), ProfileMod::thunderstore("b", "B", "1.0.0"), ProfileMod::thunderstore("t", "Only", "1.0.0")],
            ..Default::default()
        };
        let items = plan(Kind::Profile, &target, &source, &no_side);
        let a = case_of(&items, "a-A");
        assert_eq!((a.case, a.locked, a.decision), (Case::Version, true, Decision::Keep));
        assert_eq!(case_of(&items, "b-B").case, Case::Same);
        assert_eq!(case_of(&items, "n-New").case, Case::Add);
        assert!(!items.iter().any(|i| i.id == "t-Only"), "a copy never lists the target's extras");

        // Even a "take" sent for a locked item changes nothing.
        let copy = apply(Kind::Profile, &mut target, &items, &[Choice { id: "a-A".into(), decision: Decision::Take }], &[], &source);
        assert_eq!(copy, vec!["local-Hand"]);
        let get = |id: &str| find(&target, id);
        assert_eq!(get("a-A").map(|m| m.version), Some("1.0.0".into()));
        assert_eq!(get("n-New").map(|m| (m.version, m.managed)), Some(("1.0.0".into(), false)));
        assert_eq!(get("local-Hand").map(|m| m.source), Some(Source::Local));
        assert!(get("t-Only").is_some());

        // With Override on, the managed entry takes the source's version and stays the server's.
        target.override_locks = true;
        let items = plan(Kind::Profile, &target, &source, &no_side);
        assert!(!case_of(&items, "a-A").locked);
        apply(Kind::Profile, &mut target, &items, &[], &[], &source);
        assert_eq!(find(&target, "a-A").map(|m| (m.version, m.managed)), Some(("2.0.0".into(), true)));
    }

    #[test]
    fn locks_hold_managed_entries_until_override() {
        let old = Profile { mods: vec![managed("a", "A", "1.0.0"), ProfileMod::thunderstore("b", "B", "1.0.0")], ..Default::default() };
        // The player's own mod may go; the server's may not.
        assert!(check_locks(&old, &[managed("a", "A", "1.0.0")]).is_ok());
        assert!(check_locks(&old, &[ProfileMod::thunderstore("b", "B", "1.0.0")]).is_err());
        assert!(check_locks(&old, &[managed("a", "A", "1.1.0"), ProfileMod::thunderstore("b", "B", "1.0.0")]).is_err());
        assert!(check_locks(&old, &[ProfileMod { enabled: false, ..managed("a", "A", "1.0.0") }]).is_err());
        let unlocked = Profile { override_locks: true, ..old };
        assert!(check_locks(&unlocked, &[]).is_ok());
    }
}
