use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;

pub struct TempDir(PathBuf);

impl TempDir {
    pub fn create(prefix: &str) -> std::io::Result<Self> {
        let dir = std::env::temp_dir().join(format!("{prefix}-{}", crate::services::id_generator::next_id()));
        std::fs::create_dir_all(&dir)?;
        Ok(Self(dir))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MediaError {
    Missing(String),
    Invalid(String),
}

async fn run(program: &str, args: &[&std::ffi::OsStr]) -> Result<Vec<u8>, MediaError> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                MediaError::Missing(format!("{program} was not found; install ffmpeg or set FFMPEG_PATH / FFPROBE_PATH"))
            } else {
                MediaError::Missing(format!("could not start {program}: {e}"))
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.trim().lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        return Err(MediaError::Invalid(format!("{program} failed: {}", tail.chars().take(300).collect::<String>())));
    }
    Ok(output.stdout)
}

/// Duration in seconds of the first audio stream, or an error when there is no audio.
pub async fn probe_audio_duration(ffprobe: &str, path: &Path) -> Result<f32, MediaError> {
    let out = run(
        ffprobe,
        &[
            "-v".as_ref(),
            "error".as_ref(),
            "-select_streams".as_ref(),
            "a:0".as_ref(),
            "-show_entries".as_ref(),
            "stream=codec_type:format=duration".as_ref(),
            "-of".as_ref(),
            "default=noprint_wrappers=1".as_ref(),
            path.as_os_str(),
        ],
    )
    .await?;
    parse_probe(&String::from_utf8_lossy(&out))
}

/// `codec_type=audio` must be present; `duration=` gives the length.
pub fn parse_probe(output: &str) -> Result<f32, MediaError> {
    let mut has_audio = false;
    let mut duration = None;
    for line in output.lines() {
        match line.trim().split_once('=') {
            Some(("codec_type", "audio")) => has_audio = true,
            Some(("duration", value)) => duration = value.trim().parse::<f32>().ok(),
            _ => {}
        }
    }
    if !has_audio {
        return Err(MediaError::Invalid("the file has no audio stream".to_string()));
    }
    duration
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or_else(|| MediaError::Invalid("the audio has no readable duration".to_string()))
}

/// Converts any input to 16 kHz mono Opus and cuts it into parts of `part_secs` seconds
pub async fn split_for_asr(
    ffmpeg: &str,
    input: &Path,
    out_dir: &Path,
    part_secs: u32,
    bitrate: &str,
) -> Result<Vec<PathBuf>, MediaError> {
    let pattern = out_dir.join("part_%03d.ogg");
    let part_secs = part_secs.to_string();
    run(
        ffmpeg,
        &[
            "-nostdin".as_ref(),
            "-hide_banner".as_ref(),
            "-loglevel".as_ref(),
            "error".as_ref(),
            "-y".as_ref(),
            "-i".as_ref(),
            input.as_os_str(),
            "-vn".as_ref(),
            "-ac".as_ref(),
            "1".as_ref(),
            "-ar".as_ref(),
            "16000".as_ref(),
            "-c:a".as_ref(),
            "libopus".as_ref(),
            "-b:a".as_ref(),
            bitrate.as_ref(),
            "-application".as_ref(),
            "voip".as_ref(),
            "-f".as_ref(),
            "segment".as_ref(),
            "-segment_time".as_ref(),
            part_secs.as_ref(),
            "-reset_timestamps".as_ref(),
            "1".as_ref(),
            pattern.as_os_str(),
        ],
    )
    .await?;

    let mut parts: Vec<PathBuf> = std::fs::read_dir(out_dir)
        .map_err(|e| MediaError::Invalid(format!("could not list audio parts: {e}")))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("part_") && n.ends_with(".ogg"))
        })
        .collect();
    parts.sort();
    if parts.is_empty() {
        return Err(MediaError::Invalid("ffmpeg produced no audio".to_string()));
    }
    Ok(parts)
}

/// Finds ffmpeg/ffprobe for tests: FFMPEG_PATH or `ffmpeg` on PATH.
pub fn tools_available(ffmpeg: &str, ffprobe: &str) -> bool {
    let works = |program: &str| {
        std::process::Command::new(program)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    };
    works(ffmpeg) && works(ffprobe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_output_needs_an_audio_stream_and_a_duration() {
        assert_eq!(parse_probe("codec_type=audio\nduration=3605.42\n"), Ok(3605.42));
        assert_eq!(parse_probe("codec_type=audio\r\nduration=12.5\r\n"), Ok(12.5));
        assert!(matches!(parse_probe("duration=10.0\n"), Err(MediaError::Invalid(_))));
        assert!(matches!(parse_probe("codec_type=audio\nduration=N/A\n"), Err(MediaError::Invalid(_))));
    }

    #[test]
    fn temp_dir_is_removed_on_drop() {
        let path = {
            let dir = TempDir::create("opentask-test").unwrap();
            std::fs::write(dir.path().join("x.txt"), b"x").unwrap();
            dir.path().to_path_buf()
        };
        assert!(!path.exists());
    }
}
