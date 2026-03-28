use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};

use super::ring_buffer::AudioProducer;

pub struct MicCapture {
    stream: Stream,
    config: StreamConfig,
}

impl MicCapture {
    pub fn start(device_name: Option<&str>, producer: AudioProducer) -> Result<Self> {
        let host = cpal::default_host();

        let device = if let Some(name) = device_name {
            host.input_devices()
                .context("Failed to enumerate input devices")?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .context(format!("Input device '{}' not found", name))?
        } else {
            host.default_input_device()
                .context("No default input device found")?
        };

        let supported_config = device
            .default_input_config()
            .context("Failed to get default input config")?;

        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();
        let channels = config.channels as usize;

        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // Output interleaved stereo [L, R, L, R, ...]
                    let stereo: Vec<f32> = if channels == 1 {
                        // Mono: duplicate to stereo
                        data.iter().flat_map(|&s| [s, s]).collect()
                    } else {
                        // Multi-channel: take first 2 channels
                        data.chunks(channels)
                            .flat_map(|frame| {
                                let l = frame[0];
                                let r = if channels >= 2 { frame[1] } else { l };
                                [l, r]
                            })
                            .collect()
                    };
                    let _ = producer.try_send(stereo);
                },
                |err| eprintln!("Audio input error: {}", err),
                None,
            )?,
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let stereo: Vec<f32> = if channels == 1 {
                        data.iter()
                            .flat_map(|&s| {
                                let f = s as f32 / i16::MAX as f32;
                                [f, f]
                            })
                            .collect()
                    } else {
                        data.chunks(channels)
                            .flat_map(|frame| {
                                let l = frame[0] as f32 / i16::MAX as f32;
                                let r = if channels >= 2 {
                                    frame[1] as f32 / i16::MAX as f32
                                } else {
                                    l
                                };
                                [l, r]
                            })
                            .collect()
                    };
                    let _ = producer.try_send(stereo);
                },
                |err| eprintln!("Audio input error: {}", err),
                None,
            )?,
            format => anyhow::bail!("Unsupported sample format: {:?}", format),
        };

        stream.play().context("Failed to start audio stream")?;
        Ok(Self { stream, config })
    }

    pub fn sample_rate(&self) -> u32 {
        self.config.sample_rate.0
    }
}
