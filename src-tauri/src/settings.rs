use crate::error::Result;
use crate::paths::Paths;
use crate::util::{read_json, write_json};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub valheim_dir: Option<String>,
    pub steam_exe: Option<String>,
    pub download_concurrency: usize,
    pub index_ttl_minutes: u64,
    pub show_nsfw: bool,
    /// Thunderstore team service-account token (`tss_…`) for publishing modpacks; stored locally only.
    pub thunderstore_token: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { valheim_dir: None, steam_exe: None, download_concurrency: 4, index_ttl_minutes: 30, show_nsfw: false, thunderstore_token: None }
    }
}

pub fn load(paths: &Paths) -> Settings {
    read_json(&paths.settings_file()).ok().flatten().unwrap_or_default()
}

/// Saves normalized settings and returns them.
pub fn save(paths: &Paths, s: &Settings) -> Result<Settings> {
    let blank = |v: &Option<String>| v.as_ref().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    let clean = Settings {
        valheim_dir: blank(&s.valheim_dir),
        steam_exe: blank(&s.steam_exe),
        download_concurrency: s.download_concurrency.clamp(1, 16),
        index_ttl_minutes: s.index_ttl_minutes.max(5),
        show_nsfw: s.show_nsfw,
        thunderstore_token: blank(&s.thunderstore_token),
    };
    write_json(&paths.settings_file(), &clean)?;
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_with_clamping_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().to_path_buf());
        assert_eq!(load(&paths), Settings::default());
        let saved = save(&paths, &Settings { valheim_dir: Some("  ".into()), download_concurrency: 99, index_ttl_minutes: 1, ..Settings::default() }).unwrap();
        assert_eq!(saved.valheim_dir, None);
        assert_eq!(saved.download_concurrency, 16);
        assert_eq!(saved.index_ttl_minutes, 5);
        assert_eq!(load(&paths), saved);
        std::fs::write(paths.settings_file(), r#"{"showNsfw":true}"#).unwrap();
        assert_eq!(load(&paths).download_concurrency, 4);
        assert!(load(&paths).show_nsfw);
    }
}
