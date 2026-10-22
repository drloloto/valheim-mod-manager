//! Finds Steam/Valheim, provides the doorstop files and launches the game.
use crate::error::Result;
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const APP_ID: &str = "892970";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub valheim_dir: Option<String>,
    pub steam_exe: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Tok {
    Str(String),
    Open,
    Close,
}

fn vdf_tokens(text: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '"' => {
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => {
                            if let Some(n) = chars.next() {
                                s.push(n);
                            }
                        }
                        '"' => break,
                        c => s.push(c),
                    }
                }
                out.push(Tok::Str(s));
            }
            _ => {}
        }
    }
    out
}

/// Path of the Steam library from libraryfolders.vdf whose `apps` block contains `app_id`.
pub fn find_library_with_app(vdf: &str, app_id: &str) -> Option<String> {
    let t = vdf_tokens(vdf);
    let mut depth = 0usize;
    let mut apps_depth: Option<usize> = None;
    let mut last_path = None;
    let mut i = 0;
    while i < t.len() {
        match (&t[i], t.get(i + 1)) {
            (Tok::Open, _) => depth += 1,
            (Tok::Close, _) => {
                if apps_depth == Some(depth) {
                    apps_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            (Tok::Str(key), Some(Tok::Str(value))) => {
                if apps_depth == Some(depth) && key == app_id {
                    return last_path;
                }
                if apps_depth.is_none() && key.eq_ignore_ascii_case("path") {
                    last_path = Some(value.clone());
                }
                i += 2;
                continue;
            }
            (Tok::Str(key), Some(Tok::Open)) if key.eq_ignore_ascii_case("apps") => apps_depth = Some(depth + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

#[cfg(windows)]
fn steam_dir() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam").ok().and_then(|k| k.get_value::<String, _>("SteamPath").ok());
    let hklm = || {
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam").ok().and_then(|k| k.get_value::<String, _>("InstallPath").ok())
    };
    hkcu.or_else(hklm).map(PathBuf::from).filter(|p| p.is_dir())
}

#[cfg(not(windows))]
fn steam_dir() -> Option<PathBuf> {
    None
}

pub fn is_valheim_dir(p: &Path) -> bool {
    p.join("valheim.exe").is_file()
}

/// `(LastUpdated in ms, buildid)` from Steam's `appmanifest_892970.acf`, two folders above the game folder.
pub fn app_manifest(valheim_dir: &Path) -> Option<(i64, String)> {
    let acf = valheim_dir.parent()?.parent()?.join(format!("appmanifest_{APP_ID}.acf"));
    parse_app_manifest(&std::fs::read_to_string(acf).ok()?)
}

pub fn parse_app_manifest(text: &str) -> Option<(i64, String)> {
    let t = vdf_tokens(text);
    let (mut updated, mut build) = (None, None);
    for pair in t.windows(2) {
        if let (Tok::Str(k), Tok::Str(v)) = (&pair[0], &pair[1]) {
            if k.eq_ignore_ascii_case("LastUpdated") {
                updated = v.parse::<i64>().ok().map(|s| s * 1000);
            } else if k.eq_ignore_ascii_case("buildid") {
                build = Some(v.clone());
            }
        }
    }
    Some((updated?, build?))
}

pub fn detect() -> GameInfo {
    let Some(steam) = steam_dir() else { return GameInfo::default() };
    let steam_exe = Some(steam.join("steam.exe")).filter(|p| p.is_file());
    let library = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf"))
        .ok()
        .and_then(|v| find_library_with_app(&v, APP_ID))
        .map(PathBuf::from)
        .unwrap_or_else(|| steam.clone());
    let valheim = Some(library.join("steamapps").join("common").join("Valheim")).filter(|p| is_valheim_dir(p));
    GameInfo { valheim_dir: valheim.map(|p| p.display().to_string()), steam_exe: steam_exe.map(|p| p.display().to_string()) }
}

pub fn resolve(settings: &Settings, detected: &GameInfo) -> GameInfo {
    GameInfo {
        valheim_dir: settings.valheim_dir.clone().or_else(|| detected.valheim_dir.clone()),
        steam_exe: settings.steam_exe.clone().or_else(|| detected.steam_exe.clone()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Doorstop {
    V3,
    V4,
}

pub fn doorstop_version(ini: &str) -> Doorstop {
    if ini.lines().any(|l| l.trim().eq_ignore_ascii_case("[UnityDoorstop]")) {
        Doorstop::V3
    } else {
        Doorstop::V4
    }
}

/// `profile_dir = None` → vanilla launch (doorstop off).
pub fn launch_args(ver: Doorstop, profile_dir: Option<&Path>, has_corlib: bool) -> Vec<String> {
    let (enable, target, corlib_flag) = match ver {
        Doorstop::V3 => ("--doorstop-enable", "--doorstop-target", "--mono-dll-search-path-override"),
        Doorstop::V4 => ("--doorstop-enabled", "--doorstop-target-assembly", "--doorstop-mono-dll-search-path-override"),
    };
    let Some(p) = profile_dir else { return vec![enable.into(), "false".into()] };
    let preloader = p.join("BepInEx").join("core").join("BepInEx.Preloader.dll");
    let mut args = vec![enable.into(), "true".into(), target.into(), preloader.display().to_string()];
    if has_corlib {
        args.push(corlib_flag.into());
        args.push(p.join("unstripped_corlib").display().to_string());
    }
    args
}

fn same_file(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if ma.len() != mb.len() {
        return false;
    }
    let hash = |p: &Path| std::fs::read(p).map(Sha256::digest);
    matches!((hash(a), hash(b)), (Ok(x), Ok(y)) if x == y)
}

/// Copies the profile's doorstop files into the game folder when they are missing
/// or differ. Returns the number of copied files.
pub fn sync_doorstop(src: &Path, game_dir: &Path) -> Result<usize> {
    let mut copied = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest = game_dir.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&dest)?;
            copied += sync_doorstop(&entry.path(), &dest)?;
        } else if !same_file(&entry.path(), &dest) {
            std::fs::copy(entry.path(), &dest)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// The registry key conhost reads for a program that allocates its own console: the executable's path
/// with `_` for every backslash under `HKCU\Console`.
pub fn console_key_name(exe: &Path) -> String {
    exe.display().to_string().replace('\\', "_")
}

/// Turns QuickEdit off for the console the game opens for BepInEx. In QuickEdit mode a click into the
/// window starts a selection, which blocks the game's output until Enter releases it (the "stuck" console).
/// The setting lives in the user's registry for this one executable; every other console keeps its mode.
#[cfg(windows)]
pub fn disable_console_quick_edit(game_exe: &Path) -> Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(format!("Console\\{}", console_key_name(game_exe)))?;
    if key.get_value::<u32, _>("QuickEdit").ok() != Some(0) {
        key.set_value("QuickEdit", &0u32)?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn disable_console_quick_edit(_game_exe: &Path) -> Result<()> {
    Ok(())
}

pub fn launch(steam_exe: &Path, args: &[String]) -> Result<()> {
    std::process::Command::new(steam_exe).arg("-applaunch").arg(APP_ID).args(args).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VDF: &str = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"228980"		"123"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"apps"
		{
			"892970"		"4542729814"
		}
	}
}"#;

    #[test]
    fn finds_library_containing_valheim() {
        assert_eq!(find_library_with_app(VDF, APP_ID).as_deref(), Some("D:\\SteamLibrary"));
        assert_eq!(find_library_with_app(VDF, "1"), None);
    }

    #[test]
    fn parses_app_manifest() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"892970\"\n\t\"LastUpdated\"\t\t\"1791308611\"\n\t\"buildid\"\t\t\"25730771\"\n\t\"InstalledDepots\"\n\t{\n\t}\n}";
        assert_eq!(parse_app_manifest(acf), Some((1_791_308_611_000, "25730771".to_string())));
        assert_eq!(parse_app_manifest("\"AppState\" { \"appid\" \"1\" }"), None);
    }

    #[test]
    fn console_key_follows_conhost_naming() {
        assert_eq!(
            console_key_name(Path::new(r"C:\Program Files (x86)\Steam\steamapps\common\Valheim\valheim.exe")),
            "C:_Program Files (x86)_Steam_steamapps_common_Valheim_valheim.exe"
        );
    }

    #[test]
    fn detects_doorstop_version() {
        assert_eq!(doorstop_version("[General]\nenabled = true\ntarget_assembly=x"), Doorstop::V4);
        assert_eq!(doorstop_version("[UnityDoorstop]\nenabled=true\ntargetAssembly=x"), Doorstop::V3);
    }

    #[test]
    fn builds_launch_args() {
        let p = Path::new("P");
        let pre = p.join("BepInEx").join("core").join("BepInEx.Preloader.dll").display().to_string();
        let corlib = p.join("unstripped_corlib").display().to_string();
        assert_eq!(launch_args(Doorstop::V4, Some(p), false), vec!["--doorstop-enabled", "true", "--doorstop-target-assembly", &pre]);
        assert_eq!(
            launch_args(Doorstop::V3, Some(p), true),
            vec!["--doorstop-enable", "true", "--doorstop-target", &pre, "--mono-dll-search-path-override", &corlib]
        );
        assert_eq!(launch_args(Doorstop::V4, None, false), vec!["--doorstop-enabled", "false"]);
        assert_eq!(launch_args(Doorstop::V3, None, true), vec!["--doorstop-enable", "false"]);
    }

    #[test]
    fn syncs_doorstop_files_only_when_changed() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        let game = d.path().join("game");
        std::fs::create_dir_all(src.join("doorstop_libs")).unwrap();
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(src.join("winhttp.dll"), "w").unwrap();
        std::fs::write(src.join("doorstop_libs/x.so"), "x").unwrap();
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 2);
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 0);
        std::fs::write(game.join("winhttp.dll"), "v").unwrap();
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(game.join("winhttp.dll")).unwrap(), "w");
    }

    /// Manual only, on a machine with Valheim installed: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn detects_local_installation() {
        let info = detect();
        assert!(info.steam_exe.is_some(), "{info:?}");
        assert!(info.valheim_dir.as_deref().is_some_and(|d| is_valheim_dir(Path::new(d))), "{info:?}");
    }

    #[test]
    fn settings_override_detection() {
        let detected = GameInfo { valheim_dir: Some("A".into()), steam_exe: Some("S".into()) };
        let s = Settings { valheim_dir: Some("B".into()), ..Settings::default() };
        assert_eq!(resolve(&s, &detected), GameInfo { valheim_dir: Some("B".into()), steam_exe: Some("S".into()) });
    }
}
