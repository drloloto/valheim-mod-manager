use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A package store the index is built from. Hexium speaks Thunderstore's API on its own hosts; the index
/// merges both by package id (`owner-name`), so a profile and a manifest name mods the same way whichever
/// store has them.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    #[default]
    Thunderstore,
    Hexium,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Version {
    pub v: String,
    pub deps: Vec<String>,
    pub size: u64,
    pub date: i64,
    /// The store this release is downloaded from (a release on both stores is taken from Thunderstore).
    #[serde(default)]
    pub src: Store,
    /// The download URL as the store listed it; empty for Thunderstore, whose URL follows from the id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub dl: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Pkg {
    pub id: String,
    pub ns: String,
    pub name: String,
    pub desc: String,
    pub icon: String,
    pub cats: Vec<String>,
    pub rating: i64,
    pub dl: u64,
    pub upd: i64,
    pub created: i64,
    pub dep: bool,
    pub nsfw: bool,
    pub pinned: bool,
    /// The Thunderstore page; empty when only Hexium has the package.
    pub url: String,
    pub web: String,
    /// The Hexium page; empty when Hexium does not have the package.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub hx_url: String,
    /// Which stores list the package.
    #[serde(default)]
    pub stores: Vec<Store>,
    /// newest first
    pub versions: Vec<Version>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    Thunderstore,
    Local,
}

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfileMod {
    pub namespace: String,
    pub name: String,
    pub version: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub source: Source,
    /// Pinned: "Update all" and update detection leave this version alone (set by picking an older
    /// version, or by hand). Server adoption still overrides it; the flag survives.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// Local mods only: dependencies from their manifest.json.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deps: Vec<String>,
    /// Adopted from a server as one of its dependencies: kept in the profile so the resolver pins the
    /// server's version, but not the player's own pick. The UI never sees it as a profile mod; it shows up
    /// as a dependency like any other (`set_mods` carries it over, see commands.rs) until the next
    /// adoption replaces the set.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub implicit: bool,
    /// Listed by the linked server: set on every entry an adoption writes. The next adoption replaces exactly
    /// this set (server versions win, what the server dropped goes); the player's own mods are left alone.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub managed: bool,
}

impl ProfileMod {
    pub fn id(&self) -> String {
        format!("{}-{}", self.namespace, self.name)
    }

    pub fn thunderstore(ns: &str, name: &str, version: &str) -> Self {
        ProfileMod {
            namespace: ns.into(),
            name: name.into(),
            version: version.into(),
            enabled: true,
            source: Source::Thunderstore,
            pinned: false,
            deps: vec![],
            implicit: false,
            managed: false,
        }
    }
}

/// A companion server this profile mirrors (see server.rs). The token is needed for publishing only.
/// With `sync_code` set the link goes through a sealed gist instead (gistsync.rs); `url` may then be
/// empty, and `gist_token` (admin only) is what publishing needs.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerLink {
    pub url: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gist_token: Option<String>,
    /// `<manifest hash>:<config hash>` of the server state last adopted, so an unchanged server does not prompt again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_adopted: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub mods: Vec<ProfileMod>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<ServerLink>,
    /// "Override": the player may change the server's mods (remove, other version, disable) in this profile.
    /// Off by default; the UI and `set_mods` lock managed entries while it is off.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub override_locks: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct InstalledEntry {
    pub version: String,
    pub files: Vec<String>,
}

pub type Installed = BTreeMap<String, InstalledEntry>;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub version: String,
    pub required_by: Vec<String>,
    /// Where this version is downloaded from (the index's `Version::src`).
    #[serde(default)]
    pub store: Store,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ToInstall {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub to: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub resolved: BTreeMap<String, Resolved>,
    pub to_install: Vec<ToInstall>,
    pub to_remove: Vec<String>,
    pub errors: Vec<String>,
}

#[cfg(test)]
pub fn test_pkg(id: &str, versions: &[(&str, &[&str])]) -> Pkg {
    let (ns, name) = id.split_once('-').unwrap();
    Pkg {
        id: id.into(),
        ns: ns.into(),
        name: name.into(),
        desc: String::new(),
        icon: String::new(),
        cats: vec![],
        rating: 0,
        dl: 0,
        upd: 0,
        created: 0,
        dep: false,
        nsfw: false,
        pinned: false,
        url: String::new(),
        web: String::new(),
        hx_url: String::new(),
        stores: vec![Store::Thunderstore],
        versions: versions
            .iter()
            .map(|(v, deps)| Version {
                v: v.to_string(),
                deps: deps.iter().map(|d| d.to_string()).collect(),
                size: 0,
                date: 0,
                src: Store::Thunderstore,
                dl: String::new(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_link_takes_the_frontend_field_names() {
        // The link dialog sends camelCase; a gist link arrives with an empty URL and the code.
        let l: ServerLink = serde_json::from_str(r#"{"url":"","name":"","syncCode":"vmm1.x.y","gistToken":"t"}"#).unwrap();
        assert_eq!((l.sync_code.as_deref(), l.gist_token.as_deref()), (Some("vmm1.x.y"), Some("t")));
        let old: ServerLink = serde_json::from_str(r#"{"url":"http://h:1","name":"n","token":"t"}"#).unwrap();
        assert!(old.sync_code.is_none() && old.token.as_deref() == Some("t"));
        assert!(serde_json::to_string(&l).unwrap().contains("\"syncCode\""));
    }

    #[test]
    fn old_profile_json_gets_defaults() {
        let m: ProfileMod = serde_json::from_str(r#"{"namespace":"a","name":"B","version":"1.0.0"}"#).unwrap();
        assert!(m.enabled);
        assert_eq!(m.source, Source::Thunderstore);
        assert!(m.deps.is_empty());
        assert_eq!(m.id(), "a-B");
    }

    #[test]
    fn plan_serializes_camel_case() {
        let mut p = Plan::default();
        p.to_install.push(ToInstall { id: "a-B".into(), from: None, to: "1.0.0".into() });
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"toInstall\""));
        assert!(!s.contains("\"from\""));
    }
}
