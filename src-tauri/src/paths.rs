use crate::error::Result;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Paths { root }
    }

    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(self.profiles_dir())?;
        std::fs::create_dir_all(self.downloads())?;
        Ok(())
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    pub fn active_file(&self) -> PathBuf {
        self.root.join("active.txt")
    }
    pub fn index_cache(&self) -> PathBuf {
        self.root.join("cache").join("index.json")
    }
    pub fn downloads(&self) -> PathBuf {
        self.root.join("cache").join("downloads")
    }
    pub fn zip_cache(&self, id: &str, version: &str) -> PathBuf {
        self.downloads().join(format!("{id}-{version}.zip"))
    }
    pub fn profiles_dir(&self) -> PathBuf {
        self.root.join("profiles")
    }
    pub fn profile_dir(&self, name: &str) -> PathBuf {
        self.profiles_dir().join(name)
    }
    pub fn profile_file(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("profile.json")
    }
    pub fn installed_file(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("installed.json")
    }
    pub fn config_dir(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("BepInEx").join("config")
    }
    pub fn local_dir(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("local")
    }
    pub fn doorstop_dir(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("doorstop")
    }
    pub fn log_file(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join("BepInEx").join("LogOutput.log")
    }
}
