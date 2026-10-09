//! Reads LogOutput.log and delivers new lines incrementally.
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
pub struct LogChunk {
    pub lines: Vec<String>,
    pub reset: bool,
}

fn split_lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes).split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect()
}

/// The last `n` complete lines and the offset just past the last of them.
pub fn read_last_lines(path: &Path, n: usize) -> (Vec<String>, u64) {
    let Ok(bytes) = std::fs::read(path) else { return (vec![], 0) };
    let Some(last_nl) = bytes.iter().rposition(|b| *b == b'\n') else { return (vec![], 0) };
    let lines = split_lines(&bytes[..last_nl]);
    let start = lines.len().saturating_sub(n);
    (lines[start..].to_vec(), last_nl as u64 + 1)
}

/// New complete lines since `offset`. If the file got shorter (new game start),
/// reading restarts from the beginning and `reset` is set.
pub fn poll(path: &Path, offset: &mut u64) -> Option<LogChunk> {
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut reset = false;
    if len < *offset {
        *offset = 0;
        reset = true;
    }
    let empty = || reset.then(|| LogChunk { lines: vec![], reset });
    if len == *offset {
        return empty();
    }
    let mut f = std::fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(*offset)).ok()?;
    let mut buf = vec![];
    f.take(len - *offset).read_to_end(&mut buf).ok()?;
    let Some(last_nl) = buf.iter().rposition(|b| *b == b'\n') else { return empty() };
    *offset += last_nl as u64 + 1;
    Some(LogChunk { lines: split_lines(&buf[..last_nl]), reset })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_tail_and_follows_appends() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("LogOutput.log");
        assert_eq!(read_last_lines(&p, 10), (vec![], 0));
        std::fs::write(&p, "a\r\nb\nc\n").unwrap();
        let (lines, mut off) = read_last_lines(&p, 2);
        assert_eq!(lines, vec!["b", "c"]);
        assert!(poll(&p, &mut off).is_none());

        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"d\npart").unwrap();
        let c = poll(&p, &mut off).unwrap();
        assert_eq!((c.lines, c.reset), (vec!["d".to_string()], false));
        assert!(poll(&p, &mut off).is_none());
        f.write_all(b"ial\n").unwrap();
        assert_eq!(poll(&p, &mut off).unwrap().lines, vec!["partial"]);

        std::fs::write(&p, "new\n").unwrap();
        let c = poll(&p, &mut off).unwrap();
        assert_eq!((c.lines, c.reset), (vec!["new".to_string()], true));
    }
}
