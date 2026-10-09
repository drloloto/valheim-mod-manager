use crate::error::{AppError, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

pub fn cmp_version(a: &str, b: &str) -> Ordering {
    let pa: Vec<u64> = a.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    let pb: Vec<u64> = b.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    for i in 0..pa.len().max(pb.len()) {
        let o = pa.get(i).copied().unwrap_or(0).cmp(&pb.get(i).copied().unwrap_or(0));
        if o != Ordering::Equal {
            return o;
        }
    }
    Ordering::Equal
}

#[derive(Debug, Clone, PartialEq)]
pub struct FullName {
    pub ns: String,
    pub name: String,
    pub version: String,
}

/// "Namespace-Name-1.2.3" → parts. Namespace and version never contain "-".
pub fn parse_full_name(full: &str) -> Option<FullName> {
    let parts: Vec<&str> = full.split('-').collect();
    if parts.len() < 3 {
        return None;
    }
    Some(FullName { ns: parts[0].to_string(), name: parts[1..parts.len() - 1].join("-"), version: parts[parts.len() - 1].to_string() })
}

/// Joins a relative path onto `base` and rejects anything that could escape it.
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf> {
    let norm = rel.replace('\\', "/");
    let invalid = || AppError::Invalid(format!("Invalid path: {rel}"));
    if norm.starts_with('/') {
        return Err(invalid());
    }
    let mut out = base.to_path_buf();
    let mut any = false;
    for part in norm.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(invalid()),
            p if p.contains(':') => return Err(invalid()),
            p => {
                out.push(p);
                any = true;
            }
        }
    }
    if any {
        Ok(out)
    } else {
        Err(invalid())
    }
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_atomic(path, &serde_json::to_vec_pretty(value)?)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `x.dll` → `x.dll.old` (name of a disabled file).
pub fn with_old(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".old");
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(cmp_version("1.10.0", "1.9.0"), Ordering::Greater);
        assert_eq!(cmp_version("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(cmp_version("0.9.9", "1.0.0"), Ordering::Less);
    }

    #[test]
    fn parses_full_names() {
        let f = parse_full_name("denikson-BepInExPack_Valheim-5.4.2351").unwrap();
        assert_eq!((f.ns.as_str(), f.name.as_str(), f.version.as_str()), ("denikson", "BepInExPack_Valheim", "5.4.2351"));
        let f = parse_full_name("a-b-c-1.0.0").unwrap();
        assert_eq!(f.name, "b-c");
        assert!(parse_full_name("bad").is_none());
        assert!(parse_full_name("a-1.0.0").is_none());
    }

    #[test]
    fn safe_join_rejects_escapes() {
        let base = Path::new("/base");
        assert_eq!(safe_join(base, "a/b.cfg").unwrap(), base.join("a").join("b.cfg"));
        assert_eq!(safe_join(base, "a\\b.cfg").unwrap(), base.join("a").join("b.cfg"));
        for bad in ["../x", "/abs", "C:/x", "a/../../x", "", "."] {
            assert!(safe_join(base, bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn write_atomic_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("f.json");
        write_json(&p, &vec![1, 2]).unwrap();
        write_json(&p, &vec![3]).unwrap();
        let v: Option<Vec<i32>> = read_json(&p).unwrap();
        assert_eq!(v, Some(vec![3]));
        let missing: Option<Vec<i32>> = read_json(&dir.path().join("nope.json")).unwrap();
        assert_eq!(missing, None);
    }
}
