use std::io::{BufWriter, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

use anyhow::{Context, Result};

pub fn find_ffmpeg() -> Option<String> {
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    Command::new(cmd)
        .arg("ffmpeg")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().lines().next().unwrap_or("ffmpeg").to_string())
}

pub fn detect_hw_encoder(ffmpeg_path: &str) -> Option<String> {
    let out = Command::new(ffmpeg_path)
        .args(["-encoders"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    if cfg!(target_os = "macos") && s.contains("h264_videotoolbox") {
        Some("h264_videotoolbox".into())
    } else if s.contains("h264_nvenc") {
        Some("h264_nvenc".into())
    } else {
        None
    }
}

/// Wraps FFmpeg with a background writer thread so write_frame never blocks the caller.
pub struct FfmpegProcess {
    child: Child,
    frame_tx: Option<mpsc::Sender<Vec<u8>>>,
    writer_thread: Option<thread::JoinHandle<Result<(), String>>>,
}

impl FfmpegProcess {
    pub fn new(
        ffmpeg_path: &str,
        _width: u32,
        _height: u32,
        fps: u32,
        audio_path: &str,
        output_path: &str,
        hw_encoder: Option<&str>,
    ) -> Result<Self> {
        let mut args = vec![
            "-y".to_string(),
            "-use_wallclock_as_timestamps".into(),
            "1".into(),
            "-f".into(),
            "image2pipe".into(),
            "-c:v".into(),
            "mjpeg".into(),
            "-i".into(),
            "pipe:0".into(),
            "-i".into(),
            audio_path.to_string(),
        ];

        let _ = hw_encoder;
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            "18".into(),
        ]);

        args.extend([
            "-vf".into(),
            "pad=ceil(iw/2)*2:ceil(ih/2)*2".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-r".into(),
            fps.to_string(),
            "-vsync".into(),
            "cfr".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "256k".into(),
            "-shortest".into(),
            "-movflags".into(),
            "+faststart".into(),
            output_path.to_string(),
        ]);

        let mut child = Command::new(ffmpeg_path)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn ffmpeg")?;

        let stdin = child.stdin.take().context("Failed to get ffmpeg stdin")?;

        // Background writer thread with large buffer — write_frame never blocks the caller
        let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>();
        let writer_thread = thread::spawn(move || {
            let mut writer = BufWriter::with_capacity(4 * 1024 * 1024, stdin); // 4MB buffer
            for frame_data in frame_rx {
                if let Err(e) = writer.write_all(&frame_data) {
                    return Err(format!("FFmpeg write error: {}", e));
                }
            }
            if let Err(e) = writer.flush() {
                return Err(format!("FFmpeg flush error: {}", e));
            }
            Ok(())
        });

        Ok(Self {
            child,
            frame_tx: Some(frame_tx),
            writer_thread: Some(writer_thread),
        })
    }

    pub fn write_frame(&self, jpeg_data: &[u8]) -> Result<()> {
        if let Some(tx) = &self.frame_tx {
            tx.send(jpeg_data.to_vec())
                .map_err(|e| anyhow::anyhow!("FFmpeg pipe closed: {}", e))?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<()> {
        // Close the channel to signal EOF to the writer thread
        drop(self.frame_tx.take());

        // Wait for writer thread to flush
        if let Some(handle) = self.writer_thread.take() {
            handle
                .join()
                .map_err(|_| anyhow::anyhow!("Writer thread panicked"))?
                .map_err(|e| anyhow::anyhow!("{}", e))?;
        }

        // Wait for FFmpeg to finish encoding
        let output = self
            .child
            .wait_with_output()
            .context("Failed to wait for ffmpeg")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_str = stderr.to_string();
            let tail: String = if stderr_str.len() > 1000 {
                format!("...{}", &stderr_str[stderr_str.len() - 1000..])
            } else {
                stderr_str
            };
            anyhow::bail!("FFmpeg failed: {}", tail);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ffmpeg() {
        let _result = find_ffmpeg();
    }
}
