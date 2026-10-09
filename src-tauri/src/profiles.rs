use crate::error::{AppError, Result};
use crate::models::{Installed, Profile};
use crate::paths::Paths;
use crate::util::{read_json, write_json};
use std::path::Path;

pub fn validate_name(name: &str) -> Result<String> {
    let n = name.trim();
    let bad =
        n.is_empty() || n.chars().count() > 64 || n == "." || n == ".." || n.ends_with('.') || n.chars().any(|c| "<>:\"/\\|?*".contains(c) || c.is_control());
    if bad {
        return Err(AppError::Invalid(format!("Invalid profile name: \"{name}\"")));
    }
    Ok(n.to_string())
}

pub fn exists(paths: &Paths, name: &str) -> bool {
    paths.profile_file(name).is_file()
}

pub fn list(paths: &Paths) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(paths.profiles_dir())
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().join("profile.json").is_file()).filter_map(|e| e.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

pub fn load(paths: &Paths, name: &str) -> Result<Profile> {
    read_json(&paths.profile_file(name))?.ok_or_else(|| AppError::NotFound(format!("Profile \"{name}\" does not exist.")))
}

pub fn save(paths: &Paths, profile: &Profile) -> Result<()> {
    write_json(&paths.profile_file(&profile.name), profile)
}

pub fn create(paths: &Paths, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    if exists(paths, &name) {
        return Err(AppError::Invalid(format!("Profile \"{name}\" already exists.")));
    }
    std::fs::create_dir_all(paths.profile_dir(&name))?;
    save(paths, &Profile { name: name.clone(), mods: vec![] })?;
    Ok(name)
}

pub fn delete(paths: &Paths, name: &str) -> Result<()> {
    let dir = paths.profile_dir(name);
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    if std::fs::read_to_string(paths.active_file()).is_ok_and(|a| a.trim() == name) {
        set_active(paths, "")?;
    }
    Ok(())
}

pub fn rename(paths: &Paths, from: &str, to: &str) -> Result<String> {
    let to = validate_name(to)?;
    let mut profile = load(paths, from)?;
    if exists(paths, &to) {
        return Err(AppError::Invalid(format!("Profile \"{to}\" already exists.")));
    }
    let was_active = active(paths).as_deref() == Some(from);
    std::fs::rename(paths.profile_dir(from), paths.profile_dir(&to))?;
    profile.name = to.clone();
    save(paths, &profile)?;
    if was_active {
        set_active(paths, &to)?;
    }
    Ok(to)
}

pub fn clone_profile(paths: &Paths, from: &str, to: &str) -> Result<String> {
    let to = validate_name(to)?;
    let mut profile = load(paths, from)?;
    if exists(paths, &to) {
        return Err(AppError::Invalid(format!("Profile \"{to}\" already exists.")));
    }
    copy_dir(&paths.profile_dir(from), &paths.profile_dir(&to))?;
    profile.name = to.clone();
    save(paths, &profile)?;
    Ok(to)
}

pub fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub fn active(paths: &Paths) -> Option<String> {
    let name = std::fs::read_to_string(paths.active_file()).ok()?.trim().to_string();
    (!name.is_empty() && exists(paths, &name)).then_some(name)
}

pub fn set_active(paths: &Paths, name: &str) -> Result<()> {
    crate::util::write_atomic(&paths.active_file(), name.as_bytes())
}

pub fn load_installed(paths: &Paths, name: &str) -> Installed {
    read_json(&paths.installed_file(name)).ok().flatten().unwrap_or_default()
}

pub fn save_installed(paths: &Paths, name: &str, installed: &Installed) -> Result<()> {
    write_json(&paths.installed_file(name), installed)
}

pub fn unique_name(paths: &Paths, base: &str) -> String {
    if !exists(paths, base) {
        return base.to_string();
    }
    (2..).map(|i| format!("{base} ({i})")).find(|n| !exists(paths, n)).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProfileMod;

    fn setup() -> (tempfile::TempDir, Paths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().to_path_buf());
        paths.ensure().unwrap();
        (dir, paths)
    }

    #[test]
    fn validates_names() {
        assert_eq!(validate_name("  My Profile ").unwrap(), "My Profile");
        for bad in ["", "   ", "a/b", "a:b", "x?", "..", "ende.", "con<"] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn create_list_load_save_delete() {
        let (_d, paths) = setup();
        assert_eq!(create(&paths, "Beta").unwrap(), "Beta");
        create(&paths, "alpha").unwrap();
        assert!(create(&paths, "alpha").is_err());
        assert_eq!(list(&paths), vec!["alpha", "Beta"]);
        let mut p = load(&paths, "alpha").unwrap();
        p.mods.push(ProfileMod::thunderstore("a", "B", "1.0.0"));
        save(&paths, &p).unwrap();
        assert_eq!(load(&paths, "alpha").unwrap().mods.len(), 1);
        set_active(&paths, "alpha").unwrap();
        delete(&paths, "alpha").unwrap();
        assert_eq!(active(&paths), None);
        assert_eq!(list(&paths), vec!["Beta"]);
        assert!(load(&paths, "alpha").is_err());
    }

    #[test]
    fn rename_and_clone_keep_files_and_active() {
        let (_d, paths) = setup();
        create(&paths, "a").unwrap();
        std::fs::create_dir_all(paths.config_dir("a")).unwrap();
        std::fs::write(paths.config_dir("a").join("x.cfg"), "k=v").unwrap();
        set_active(&paths, "a").unwrap();
        rename(&paths, "a", "b").unwrap();
        assert_eq!(active(&paths).as_deref(), Some("b"));
        assert_eq!(load(&paths, "b").unwrap().name, "b");
        clone_profile(&paths, "b", "c").unwrap();
        assert_eq!(std::fs::read_to_string(paths.config_dir("c").join("x.cfg")).unwrap(), "k=v");
        assert_eq!(load(&paths, "c").unwrap().name, "c");
        assert!(rename(&paths, "b", "c").is_err());
    }

    #[test]
    fn unique_names_get_suffix() {
        let (_d, paths) = setup();
        assert_eq!(unique_name(&paths, "x"), "x");
        create(&paths, "x").unwrap();
        create(&paths, "x (2)").unwrap();
        assert_eq!(unique_name(&paths, "x"), "x (3)");
    }
}
