//! Reads BepInEx .cfg files and writes individual values back in place.
use crate::error::Result;
use crate::util::safe_join;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSetting {
    pub section: String,
    pub key: String,
    pub value: String,
    pub description: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptable_values: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct ParsedConfig {
    pub file: String,
    pub settings: Vec<ConfigSetting>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ConfigChange {
    pub section: String,
    pub key: String,
    pub value: String,
}

pub fn list_files_with_ext(dir: &Path, exts: &[&str]) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, exts: &[&str], out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if e.path().is_dir() {
                walk(&e.path(), &rel, exts, out);
            } else if Path::new(&name).extension().is_some_and(|x| exts.iter().any(|ext| x.eq_ignore_ascii_case(ext))) {
                out.push(rel);
            }
        }
    }
    let mut out = vec![];
    walk(dir, "", exts, &mut out);
    out.sort();
    out
}

pub fn list_files(dir: &Path) -> Vec<String> {
    list_files_with_ext(dir, &["cfg"])
}

fn section_header(trimmed: &str) -> Option<&str> {
    (trimmed.len() >= 2 && trimmed.starts_with('[') && trimmed.ends_with(']')).then(|| &trimmed[1..trimmed.len() - 1])
}

/// `(key, byte offset of the value)` for `key = value` lines.
fn split_kv(line: &str) -> Option<(String, usize)> {
    let eq = line.find('=')?;
    let key = line[..eq].trim();
    if key.is_empty() {
        return None;
    }
    let after = &line[eq + 1..];
    Some((key.to_string(), eq + 1 + (after.len() - after.trim_start().len())))
}

fn strip_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    s.get(..prefix.len()).filter(|p| p.eq_ignore_ascii_case(prefix)).map(|_| s[prefix.len()..].trim())
}

pub fn parse_str(file: &str, raw: &str) -> ParsedConfig {
    let mut settings = vec![];
    let mut section = String::new();
    let mut comments: Vec<String> = vec![];
    for line in raw.lines() {
        let t = line.trim();
        if let Some(s) = section_header(t) {
            section = s.to_string();
            comments.clear();
        } else if t.starts_with('#') {
            comments.push(t.trim_start_matches('#').trim_start().to_string());
        } else if let Some((key, vstart)) = (!t.is_empty()).then(|| split_kv(line)).flatten() {
            let mut desc = vec![];
            let (mut type_, mut default_value, mut acceptable_values) = (None, None, None);
            for c in comments.drain(..) {
                if let Some(v) = strip_ci(&c, "Setting type:") {
                    type_ = Some(v.to_string());
                } else if let Some(v) = strip_ci(&c, "Default value:") {
                    default_value = Some(v.to_string());
                } else if let Some(v) = strip_ci(&c, "Acceptable values:").or_else(|| strip_ci(&c, "Acceptable value range:")) {
                    acceptable_values = Some(v.to_string());
                } else {
                    desc.push(c);
                }
            }
            settings.push(ConfigSetting {
                section: section.clone(),
                key,
                value: line[vstart..].to_string(),
                description: desc.join(" ").trim().to_string(),
                type_,
                default_value,
                acceptable_values,
            });
        }
    }
    ParsedConfig { file: file.to_string(), settings }
}

pub fn parse_file(dir: &Path, rel: &str) -> Result<ParsedConfig> {
    let raw = std::fs::read_to_string(safe_join(dir, rel)?)?;
    Ok(parse_str(rel, &raw))
}

pub fn apply_changes(raw: &str, changes: &[ConfigChange]) -> String {
    let map: HashMap<(&str, &str), &str> = changes.iter().map(|c| ((c.section.as_str(), c.key.as_str()), c.value.as_str())).collect();
    let mut section = String::new();
    let out: Vec<String> = raw
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .map(|line| {
            let t = line.trim();
            if let Some(s) = section_header(t) {
                section = s.to_string();
            } else if !t.starts_with('#') && !t.is_empty() {
                if let Some((key, vstart)) = split_kv(line) {
                    if let Some(v) = map.get(&(section.as_str(), key.as_str())) {
                        return format!("{}{}", &line[..vstart], v);
                    }
                }
            }
            line.to_string()
        })
        .collect();
    out.join(if raw.contains("\r\n") { "\r\n" } else { "\n" })
}

pub fn save_changes(dir: &Path, rel: &str, changes: &[ConfigChange]) -> Result<()> {
    let path = safe_join(dir, rel)?;
    let raw = std::fs::read_to_string(&path)?;
    std::fs::write(&path, apply_changes(&raw, changes))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "## Settings file was created by plugin X\r\n\r\n[General]\r\n\r\n## Enables the thing\r\n## really\r\n# Setting type: Boolean\r\n# Default value: true\r\nEnabled = true\r\n\r\n[Keys]\r\n# Setting type: KeyCode\r\n# Acceptable values: None, A, B\r\nHotkey =  A \r\nNoEquals line\r\n";

    #[test]
    fn parses_settings_with_metadata() {
        let c = parse_str("x.cfg", SAMPLE);
        assert_eq!(c.settings.len(), 2);
        let s = &c.settings[0];
        assert_eq!((s.section.as_str(), s.key.as_str(), s.value.as_str()), ("General", "Enabled", "true"));
        assert_eq!(s.description, "Enables the thing really");
        assert_eq!(s.type_.as_deref(), Some("Boolean"));
        assert_eq!(s.default_value.as_deref(), Some("true"));
        let h = &c.settings[1];
        assert_eq!(h.value, "A ");
        assert_eq!(h.acceptable_values.as_deref(), Some("None, A, B"));
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["settings"][0]["type"], "Boolean");
        assert_eq!(json["settings"][0]["defaultValue"], "true");
    }

    #[test]
    fn applies_changes_preserving_everything_else() {
        let out = apply_changes(
            SAMPLE,
            &[
                ConfigChange { section: "Keys".into(), key: "Hotkey".into(), value: "B".into() },
                ConfigChange { section: "Other".into(), key: "Enabled".into(), value: "false".into() },
            ],
        );
        assert_eq!(out, SAMPLE.replace("Hotkey =  A ", "Hotkey =  B"));
    }

    #[test]
    fn lists_nested_files_and_blocks_traversal() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("b.cfg"), SAMPLE).unwrap();
        std::fs::write(d.path().join("sub/a.cfg"), "").unwrap();
        std::fs::write(d.path().join("sub/data.json"), "{}").unwrap();
        assert_eq!(list_files(d.path()), vec!["b.cfg", "sub/a.cfg"]);
        assert_eq!(list_files_with_ext(d.path(), &["cfg", "json"]), vec!["b.cfg", "sub/a.cfg", "sub/data.json"]);
        assert!(parse_file(d.path(), "../b.cfg").is_err());
        save_changes(d.path(), "b.cfg", &[ConfigChange { section: "General".into(), key: "Enabled".into(), value: "false".into() }]).unwrap();
        assert_eq!(parse_file(d.path(), "b.cfg").unwrap().settings[0].value, "false");
        assert!(list_files(&d.path().join("missing")).is_empty());
    }
}
