use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};

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

pub struct FfmpegProcess {
    child: Child,
    stdin: ChildStdin,
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
            // Real-time timestamps: each frame gets a wallclock timestamp
            // so FFmpeg knows the actual timing regardless of capture speed
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

        // Video codec
        if let Some(enc) = hw_encoder {
            match enc {
                "h264_videotoolbox" => {
                    args.extend(["-c:v".into(), enc.into(), "-q:v".into(), "65".into()]);
                }
                "h264_nvenc" => {
                    args.extend([
                        "-c:v".into(),
                        enc.into(),
                        "-preset".into(),
                        "p4".into(),
                        "-cq".into(),
                        "20".into(),
                    ]);
                }
                _ => {
                    args.extend([
                        "-c:v".into(),
                        "libx264".into(),
                        "-preset".into(),
                        "medium".into(),
                        "-crf".into(),
                        "18".into(),
                    ]);
                }
            }
        } else {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "18".into(),
            ]);
        }

        args.extend([
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-r".into(),
            "30".into(),
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

        Ok(Self { child, stdin })
    }

    pub fn write_frame(&mut self, jpeg_data: &[u8]) -> Result<()> {
        self.stdin
            .write_all(jpeg_data)
            .context("Failed to write frame to ffmpeg")
    }

    pub fn finish(self) -> Result<()> {
        drop(self.stdin);
        let output = self
            .child
            .wait_with_output()
            .context("Failed to wait for ffmpeg")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "FFmpeg failed: {}",
                stderr.chars().take(500).collect::<String>()
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ffmpeg() {
        // This test just checks the function doesn't panic.
        // On CI without ffmpeg, it returns None.
        let _result = find_ffmpeg();
    }
}
