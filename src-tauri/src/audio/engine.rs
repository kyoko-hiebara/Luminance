use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;

use super::file_player::FilePlayer;
use super::mic_capture::MicCapture;
use super::ring_buffer::RingBuffer;
use super::transport::{TransportState, NO_SEEK};
use crate::dsp::fft::FftProcessor;
use crate::dsp::loudness::LoudnessProcessor;
use crate::dsp::rms::RmsProcessor;
use crate::dsp::stereo::StereoProcessor;
use crate::dsp::utils::{compute_band_energies, decimate_waveform};
use crate::dsp::{AudioData, TransportData};

const FFT_SIZE: usize = 8192;
const NUM_BANDS: usize = 96;
const WAVEFORM_DISPLAY_SAMPLES: usize = 512;

pub struct AudioEngine {
    running: Arc<AtomicBool>,
    dsp_thread: Option<thread::JoinHandle<()>>,
    audio_thread: Option<thread::JoinHandle<()>>,
    transport: Option<TransportState>,
}

unsafe impl Send for AudioEngine {}

impl AudioEngine {
    pub fn transport(&self) -> Option<&TransportState> {
        self.transport.as_ref()
    }

    pub fn new_mic_capture(
        app: tauri::AppHandle,
        device_name: Option<String>,
    ) -> Result<Self> {
        let running = Arc::new(AtomicBool::new(true));
        let ring_buffer = RingBuffer::new(64);
        let producer = ring_buffer.producer();
        let consumer = ring_buffer.consumer();

        let (sr_tx, sr_rx) = crossbeam_channel::bounded::<Result<u32, String>>(1);

        let audio_running = running.clone();
        let audio_thread = thread::spawn(move || {
            match MicCapture::start(device_name.as_deref(), producer) {
                Ok(mic) => {
                    let _ = sr_tx.send(Ok(mic.sample_rate()));
                    while audio_running.load(Ordering::Relaxed) {
                        thread::sleep(Duration::from_millis(100));
                    }
                    drop(mic);
                }
                Err(e) => {
                    let _ = sr_tx.send(Err(e.to_string()));
                }
            }
        });

        let sample_rate = sr_rx
            .recv()
            .map_err(|e| anyhow::anyhow!("Audio thread failed: {}", e))?
            .map_err(|e| anyhow::anyhow!("{}", e))?;

        let dsp_running = running.clone();
        let dsp_thread = thread::spawn(move || {
            run_dsp_loop(app, consumer, sample_rate as f32, dsp_running, None);
        });

        Ok(Self {
            running,
            dsp_thread: Some(dsp_thread),
            audio_thread: Some(audio_thread),
            transport: None,
        })
    }

    pub fn new_file_player(
        app: tauri::AppHandle,
        path: &str,
    ) -> Result<Self> {
        let running = Arc::new(AtomicBool::new(true));
        let ring_buffer = RingBuffer::new(256);
        let producer = ring_buffer.producer();
        let consumer = ring_buffer.consumer();

        let player = FilePlayer::decode(path)?;

        // Pre-analyze file for adaptive display ranges
        let analysis = crate::dsp::analyzer::analyze(
            player.interleaved(),
            player.channels(),
            player.sample_rate(),
        );
        let _ = app.emit("file-analysis", &analysis);

        let file_rate = player.sample_rate();
        let source_channels = player.channels() as usize;

        // Try the file's native sample rate first (most OS audio APIs handle conversion)
        let samples = Arc::new(player.interleaved().to_vec());
        let sample_rate = file_rate;

        let total_frames = samples.len() / source_channels.max(1);
        let transport = TransportState::new(total_frames, sample_rate);

        let (ready_tx, ready_rx) = crossbeam_channel::bounded::<Result<(), String>>(1);

        let audio_running = running.clone();
        let t = transport.clone();
        let audio_samples = samples.clone();
        let audio_thread = thread::spawn(move || {
            // Try with file's native sample rate first
            let result = build_output_stream(
                audio_samples.clone(), source_channels, sample_rate, producer.clone(), t.clone()
            ).or_else(|_| {
                // If CPAL rejects the rate, resample to device rate and retry
                let host = cpal::default_host();
                let device_rate = host.default_output_device()
                    .and_then(|d| d.default_output_config().ok())
                    .map(|c| c.sample_rate().0)
                    .unwrap_or(48000);

                if device_rate == sample_rate {
                    return Err(anyhow::anyhow!("Device rejected its own sample rate"));
                }

                let resampled = resample_interleaved(
                    &audio_samples, source_channels, sample_rate, device_rate
                )?;
                let new_samples = Arc::new(resampled);
                let new_total = new_samples.len() / source_channels.max(1);
                t.total_frames.store(new_total, Ordering::Relaxed);
                build_output_stream(new_samples, source_channels, device_rate, producer, t)
            });

            match result {
                Ok(stream) => {
                    let _ = ready_tx.send(Ok(()));
                    while audio_running.load(Ordering::Relaxed) {
                        thread::sleep(Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                }
            }
        });

        ready_rx
            .recv()
            .map_err(|e| anyhow::anyhow!("Audio thread failed: {}", e))?
            .map_err(|e| anyhow::anyhow!("{}", e))?;

        let dsp_running = running.clone();
        let dsp_transport = transport.clone();
        let dsp_thread = thread::spawn(move || {
            run_dsp_loop(app, consumer, sample_rate as f32, dsp_running, Some(dsp_transport));
        });

        Ok(Self {
            running,
            dsp_thread: Some(dsp_thread),
            audio_thread: Some(audio_thread),
            transport: Some(transport),
        })
    }

    pub fn stop(self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.dsp_thread {
            let _ = handle.join();
        }
        if let Some(handle) = self.audio_thread {
            let _ = handle.join();
        }
    }
}

/// Resample interleaved audio from one sample rate to another using rubato.
fn resample_interleaved(
    interleaved: &[f32],
    channels: usize,
    from_rate: u32,
    to_rate: u32,
) -> Result<Vec<f32>> {
    use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction, Resampler};

    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };

    let ch = channels.max(1);
    let total_frames = interleaved.len() / ch;
    let chunk_size = 1024;

    let mut resampler = SincFixedIn::<f32>::new(
        to_rate as f64 / from_rate as f64,
        2.0,
        params,
        chunk_size,
        ch,
    )?;

    // Deinterleave entire file into per-channel vectors
    let mut channel_bufs: Vec<Vec<f32>> = (0..ch).map(|_| Vec::with_capacity(total_frames)).collect();
    for frame in 0..total_frames {
        for c in 0..ch {
            channel_bufs[c].push(interleaved[frame * ch + c]);
        }
    }

    // Process in chunks
    let ratio = to_rate as f64 / from_rate as f64;
    let estimated_out = (total_frames as f64 * ratio) as usize + chunk_size;
    let mut output_channels: Vec<Vec<f32>> = (0..ch).map(|_| Vec::with_capacity(estimated_out)).collect();

    let mut pos = 0;
    while pos < total_frames {
        let end = (pos + chunk_size).min(total_frames);
        let chunk_len = end - pos;

        // Pad to chunk_size if needed (last chunk)
        let chunks: Vec<Vec<f32>> = (0..ch)
            .map(|c| {
                let mut v = channel_bufs[c][pos..end].to_vec();
                v.resize(chunk_size, 0.0);
                v
            })
            .collect();

        let refs: Vec<&[f32]> = chunks.iter().map(|v| v.as_slice()).collect();
        let resampled = resampler.process(&refs, None)?;

        // Only take proportional output for partial last chunk
        let out_len = if chunk_len < chunk_size {
            (chunk_len as f64 * ratio).ceil() as usize
        } else {
            resampled[0].len()
        };

        for c in 0..ch {
            output_channels[c].extend_from_slice(&resampled[c][..out_len.min(resampled[c].len())]);
        }

        pos += chunk_size;
    }

    // Re-interleave
    let out_frames = output_channels[0].len();
    let mut output = Vec::with_capacity(out_frames * ch);
    for f in 0..out_frames {
        for c in 0..ch {
            output.push(output_channels[c][f]);
        }
    }

    Ok(output)
}

fn build_output_stream(
    samples: Arc<Vec<f32>>,
    source_channels: usize,
    sample_rate: u32,
    producer: super::ring_buffer::AudioProducer,
    transport: TransportState,
) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .context("No default output device found")?;

    let supported = device
        .default_output_config()
        .context("Failed to get default output config")?;

    let output_channels = supported.channels() as usize;
    let config = StreamConfig {
        channels: supported.channels(),
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    let total_frames = transport.total_frames.load(Ordering::Relaxed);
    let pos = transport.play_pos.clone();
    let is_paused = transport.paused.clone();
    let is_looping = transport.looping.clone();
    let seek_target = transport.seek_target.clone();

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_output_stream(
            &config,
            move |output: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let output_frames = output.len() / output_channels;
                let mut stereo_buf = Vec::with_capacity(output_frames * 2);

                // Handle pending seek
                let seek = seek_target.swap(NO_SEEK, Ordering::AcqRel);
                let mut current_frame = if seek != NO_SEEK {
                    pos.store(seek, Ordering::Relaxed);
                    seek
                } else {
                    pos.load(Ordering::Relaxed)
                };

                // Handle pause: output silence, don't advance
                if is_paused.load(Ordering::Relaxed) {
                    for s in output.iter_mut() {
                        *s = 0.0;
                    }
                    stereo_buf.resize(output_frames * 2, 0.0);
                    let _ = producer.try_send(stereo_buf);
                    return;
                }

                for i in 0..output_frames {
                    // Handle end of file
                    if current_frame >= total_frames {
                        if is_looping.load(Ordering::Relaxed) {
                            current_frame = 0;
                        } else {
                            // Past end, not looping: silence
                            for ch in 0..output_channels {
                                output[i * output_channels + ch] = 0.0;
                            }
                            stereo_buf.push(0.0);
                            stereo_buf.push(0.0);
                            continue;
                        }
                    }

                    let src_offset = current_frame * source_channels;
                    let l = samples[src_offset];
                    let r = if source_channels >= 2 {
                        samples[src_offset + 1]
                    } else {
                        l
                    };

                    for ch in 0..output_channels {
                        let sample = if ch == 0 {
                            l
                        } else if ch == 1 {
                            r
                        } else if source_channels > ch {
                            samples[src_offset + ch]
                        } else {
                            0.0
                        };
                        output[i * output_channels + ch] = sample;
                    }

                    stereo_buf.push(l);
                    stereo_buf.push(r);
                    current_frame += 1;
                }

                pos.store(current_frame, Ordering::Relaxed);
                let _ = producer.try_send(stereo_buf);
            },
            move |err| {
                eprintln!("Audio output error: {}", err);
            },
            None,
        )?,
        format => anyhow::bail!("Unsupported output sample format: {:?}", format),
    };

    stream.play().context("Failed to start output stream")?;
    Ok(stream)
}

fn run_dsp_loop(
    app: tauri::AppHandle,
    consumer: super::ring_buffer::AudioConsumer,
    sample_rate: f32,
    running: Arc<AtomicBool>,
    transport: Option<TransportState>,
) {
    let mut fft = FftProcessor::new(FFT_SIZE, NUM_BANDS, sample_rate);
    let mut fft_l = FftProcessor::new(FFT_SIZE, NUM_BANDS, sample_rate);
    let mut fft_r = FftProcessor::new(FFT_SIZE, NUM_BANDS, sample_rate);
    let mut fft_s = FftProcessor::new(FFT_SIZE, NUM_BANDS, sample_rate);
    let mut rms = RmsProcessor::new(300.0, sample_rate);
    let stereo_proc = StereoProcessor::new();
    let mut loudness = LoudnessProcessor::new(sample_rate);
    let mut loudness_l = LoudnessProcessor::new(sample_rate);
    let mut loudness_r = LoudnessProcessor::new(sample_rate);
    let mut loudness_m = LoudnessProcessor::new(sample_rate);
    let mut loudness_s = LoudnessProcessor::new(sample_rate);

    let frame_duration = Duration::from_micros(16_667);
    let mut acc_l: Vec<f32> = Vec::new();
    let mut acc_r: Vec<f32> = Vec::new();

    while running.load(Ordering::Relaxed) {
        let frame_start = Instant::now();

        let new_data = consumer.drain();
        if !new_data.is_empty() {
            for pair in new_data.chunks(2) {
                if pair.len() == 2 {
                    acc_l.push(pair[0]);
                    acc_r.push(pair[1]);
                }
            }
        }

        if acc_l.len() >= FFT_SIZE {
            let start = acc_l.len().saturating_sub(FFT_SIZE);
            let left = &acc_l[start..];
            let right = &acc_r[start..];

            let mono: Vec<f32> = left
                .iter()
                .zip(right.iter())
                .map(|(&l, &r)| (l + r) * 0.5)
                .collect();

            let spectrum = fft.process(&mono);
            let spectrogram_frame = spectrum.magnitudes.clone();
            // Per-channel band energies for Rekordbox-style coloring
            let spec_l = fft_l.process(left);
            let spec_r = fft_r.process(right);
            let (bl_l, bm_l, bh_l) = compute_band_energies(&spec_l.magnitudes, NUM_BANDS);
            let (bl_r, bm_r, bh_r) = compute_band_energies(&spec_r.magnitudes, NUM_BANDS);
            // Side signal = (L - R) * 0.5 for independent M/S coloring
            let side: Vec<f32> = left.iter().zip(right.iter())
                .map(|(&l, &r)| (l - r) * 0.5)
                .collect();
            let spec_s = fft_s.process(&side);
            let (bl_s, bm_s, bh_s) = compute_band_energies(&spec_s.magnitudes, NUM_BANDS);
            let levels = rms.process(left, right);
            let stereo_data = stereo_proc.process(left, right);
            let total_lufs = loudness.process(left, right);
            let l_lufs = loudness_l.process(left, left);
            let r_lufs = loudness_r.process(right, right);
            let mid: Vec<f32> = left.iter().zip(right.iter()).map(|(&l, &r)| (l + r) * 0.5).collect();
            let side_sig: Vec<f32> = left.iter().zip(right.iter()).map(|(&l, &r)| (l - r) * 0.5).collect();
            let mid_lufs = loudness_m.process(&mid, &mid);
            let side_lufs = loudness_s.process(&side_sig, &side_sig);
            let loudness_data = crate::dsp::LoudnessData {
                momentary: total_lufs.momentary,
                short_term: total_lufs.short_term,
                mid_m: mid_lufs.momentary,
                side_m: side_lufs.momentary,
                l_m: l_lufs.momentary,
                r_m: r_lufs.momentary,
            };

            let waveform_l = decimate_waveform(left, WAVEFORM_DISPLAY_SAMPLES);
            let waveform_r = decimate_waveform(right, WAVEFORM_DISPLAY_SAMPLES);

            let transport_data = transport.as_ref().map(|t| TransportData {
                position_secs: t.position_secs(),
                duration_secs: t.duration_secs(),
                is_paused: t.paused.load(Ordering::Relaxed),
                is_looping: t.looping.load(Ordering::Relaxed),
            });

            let audio_data = AudioData {
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
                transport: transport_data,
            };

            let _ = app.emit("audio-data", &audio_data);

            if acc_l.len() > FFT_SIZE * 4 {
                let keep_from = acc_l.len() - FFT_SIZE;
                acc_l = acc_l[keep_from..].to_vec();
                acc_r = acc_r[keep_from..].to_vec();
            }
        }

        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            thread::sleep(frame_duration - elapsed);
        }
    }
}

