use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;
use crossbeam_channel::Receiver;
use serde::Serialize;
use tauri::Emitter;

use crate::audio::file_player::FilePlayer;
use crate::dsp::fft::FftProcessor;
use crate::dsp::loudness::LoudnessProcessor;
use crate::dsp::rms::RmsProcessor;
use crate::dsp::stereo::StereoProcessor;
use crate::dsp::utils::{compute_band_energies, decimate_waveform};

use super::ffmpeg::{find_ffmpeg, detect_hw_encoder, FfmpegProcess};

const FFT_SIZE: usize = 8192;
const NUM_BANDS: usize = 96;
const WAVEFORM_SAMPLES: usize = 512;

#[derive(Clone, Serialize)]
pub struct RenderConfig {
    pub audio_path: String,
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Clone, Serialize)]
pub struct RenderFrameEvent {
    pub frame_index: u32,
    pub total_frames: u32,
    pub audio_data: crate::dsp::AudioData,
}

#[derive(Clone, Serialize)]
pub struct RenderProgress {
    pub current_frame: u32,
    pub total_frames: u32,
    pub phase: String,
}

pub fn run_offline_render(
    app: tauri::AppHandle,
    config: RenderConfig,
    frame_rx: Receiver<Vec<u8>>,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    // Decode audio
    let player = FilePlayer::decode(&config.audio_path)?;
    let sample_rate = player.sample_rate();
    let channels = player.channels() as usize;
    let interleaved = player.interleaved();
    let total_audio_frames = interleaved.len() / channels.max(1);
    let samples_per_frame = (sample_rate as usize) / (config.fps as usize);
    let total_frames = (total_audio_frames / samples_per_frame) as u32;

    // Find FFmpeg
    let ffmpeg_path =
        find_ffmpeg().ok_or_else(|| anyhow::anyhow!("FFmpeg not found in PATH"))?;
    let hw_enc = detect_hw_encoder(&ffmpeg_path);

    // Spawn FFmpeg
    let mut ffmpeg = FfmpegProcess::new(
        &ffmpeg_path,
        config.width,
        config.height,
        config.fps,
        &config.audio_path,
        &config.output_path,
        hw_enc.as_deref(),
    )?;

    // DSP processors
    let sr = sample_rate as f32;
    let mut fft = FftProcessor::new(FFT_SIZE, NUM_BANDS, sr);
    let mut fft_l = FftProcessor::new(FFT_SIZE, NUM_BANDS, sr);
    let mut fft_r = FftProcessor::new(FFT_SIZE, NUM_BANDS, sr);
    let mut fft_s = FftProcessor::new(FFT_SIZE, NUM_BANDS, sr);
    let mut rms = RmsProcessor::new(300.0, sr);
    let stereo_proc = StereoProcessor::new();
    let mut loudness = LoudnessProcessor::new(sr);

    let mut acc_l: Vec<f32> = Vec::new();
    let mut acc_r: Vec<f32> = Vec::new();

    let _ = app.emit(
        "render-progress",
        &RenderProgress {
            current_frame: 0,
            total_frames,
            phase: "rendering".into(),
        },
    );

    for frame in 0..total_frames {
        if cancel.load(Ordering::Relaxed) {
            let _ = app.emit(
                "render-progress",
                &RenderProgress {
                    current_frame: frame,
                    total_frames,
                    phase: "cancelled".into(),
                },
            );
            return Ok(());
        }

        // Extract this frame's audio
        let start_sample = (frame as usize) * samples_per_frame;
        let end_sample = ((frame as usize) + 1) * samples_per_frame;

        for s in start_sample..end_sample.min(total_audio_frames) {
            let offset = s * channels;
            let l = interleaved[offset];
            let r = if channels >= 2 {
                interleaved[offset + 1]
            } else {
                l
            };
            acc_l.push(l);
            acc_r.push(r);
        }

        // Build AudioData (only when we have enough for FFT)
        let audio_data = if acc_l.len() >= FFT_SIZE {
            let start = acc_l.len().saturating_sub(FFT_SIZE);
            let left = &acc_l[start..];
            let right = &acc_r[start..];
            let mono: Vec<f32> = left
                .iter()
                .zip(right.iter())
                .map(|(&l, &r)| (l + r) * 0.5)
                .collect();
            let side: Vec<f32> = left
                .iter()
                .zip(right.iter())
                .map(|(&l, &r)| (l - r) * 0.5)
                .collect();

            let spectrum = fft.process(&mono);
            let spectrogram_frame = spectrum.magnitudes.clone();
            let spec_l = fft_l.process(left);
            let spec_r = fft_r.process(right);
            let spec_s = fft_s.process(&side);
            let (bl_l, bm_l, bh_l) = compute_band_energies(&spec_l.magnitudes, NUM_BANDS);
            let (bl_r, bm_r, bh_r) = compute_band_energies(&spec_r.magnitudes, NUM_BANDS);
            let (bl_s, bm_s, bh_s) = compute_band_energies(&spec_s.magnitudes, NUM_BANDS);
            let levels = rms.process(left, right);
            let stereo_data = stereo_proc.process(left, right);
            let total_lufs = loudness.process(left, right);
            let tp_l = left.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
            let tp_r = right.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
            let loudness_data = crate::dsp::LoudnessData {
                momentary: total_lufs.momentary,
                short_term: total_lufs.short_term,
                true_peak_l: if tp_l > 0.0 { (20.0 * tp_l.log10()).max(-90.0) } else { -90.0 },
                true_peak_r: if tp_r > 0.0 { (20.0 * tp_r.log10()).max(-90.0) } else { -90.0 },
                mid_short: total_lufs.short_term,
                side_short: -70.0,
            };
            let waveform_l = decimate_waveform(left, WAVEFORM_SAMPLES);
            let waveform_r = decimate_waveform(right, WAVEFORM_SAMPLES);

            // Trim accumulators to prevent unbounded growth
            if acc_l.len() > FFT_SIZE * 4 {
                let keep = acc_l.len() - FFT_SIZE;
                acc_l = acc_l[keep..].to_vec();
                acc_r = acc_r[keep..].to_vec();
            }

            crate::dsp::AudioData {
                spectrum,
                levels,
                waveform: crate::dsp::WaveformData {
                    samples_l: waveform_l,
                    samples_r: waveform_r,
                    band_l: [bl_l, bm_l, bh_l],
                    band_r: [bl_r, bm_r, bh_r],
                    band_s: [bl_s, bm_s, bh_s],
                },
                stereo: stereo_data,
                loudness: loudness_data,
                spectrogram_frame,
                transport: Some(crate::dsp::TransportData {
                    position_secs: frame as f64 / config.fps as f64,
                    duration_secs: total_frames as f64 / config.fps as f64,
                    is_paused: false,
                    is_looping: false,
                }),
            }
        } else {
            // Not enough data yet - emit silence/zeros
            crate::dsp::AudioData {
                spectrum: crate::dsp::SpectrumData {
                    magnitudes: vec![-90.0; NUM_BANDS],
                    peaks: vec![-90.0; NUM_BANDS],
                },
                levels: crate::dsp::LevelData {
                    rms_l: -90.0,
                    rms_r: -90.0,
                    peak_l: -90.0,
                    peak_r: -90.0,
                },
                waveform: crate::dsp::WaveformData {
                    samples_l: vec![0.0; WAVEFORM_SAMPLES],
                    samples_r: vec![0.0; WAVEFORM_SAMPLES],
                    band_l: [0.33, 0.33, 0.34],
                    band_r: [0.33, 0.33, 0.34],
                    band_s: [0.33, 0.33, 0.34],
                },
                stereo: crate::dsp::StereoData {
                    correlation: 0.0,
                    lissajous_l: vec![],
                    lissajous_r: vec![],
                },
                loudness: crate::dsp::LoudnessData {
                    momentary: -70.0,
                    short_term: -70.0,
                    true_peak_l: -90.0,
                    true_peak_r: -90.0,
                    mid_short: -70.0,
                    side_short: -70.0,
                },
                spectrogram_frame: vec![-90.0; NUM_BANDS],
                transport: None,
            }
        };

        // Emit frame to frontend for rendering
        let _ = app.emit(
            "render-frame",
            &RenderFrameEvent {
                frame_index: frame,
                total_frames,
                audio_data,
            },
        );

        // Wait for JPEG bytes from frontend
        let jpeg_data = frame_rx
            .recv()
            .map_err(|e| anyhow::anyhow!("Frame receive error: {}", e))?;

        // Write JPEG frame to FFmpeg (image2pipe)
        ffmpeg.write_frame(&jpeg_data)?;

        // Progress updates every 10 frames
        if frame % 10 == 0 {
            let _ = app.emit(
                "render-progress",
                &RenderProgress {
                    current_frame: frame,
                    total_frames,
                    phase: "rendering".into(),
                },
            );
        }
    }

    // Finish encoding
    let _ = app.emit(
        "render-progress",
        &RenderProgress {
            current_frame: total_frames,
            total_frames,
            phase: "encoding".into(),
        },
    );

    ffmpeg.finish()?;

    let _ = app.emit(
        "render-progress",
        &RenderProgress {
            current_frame: total_frames,
            total_frames,
            phase: "complete".into(),
        },
    );

    Ok(())
}
