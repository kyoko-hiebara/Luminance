use anyhow::{Context, Result};
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct FilePlayer {
    /// Interleaved PCM samples (original channel layout, f32)
    interleaved: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

impl FilePlayer {
    /// Decode an audio file to interleaved PCM samples in memory.
    pub fn decode(path: &str) -> Result<Self> {
        let path = Path::new(path);
        let file = File::open(path).context("Failed to open audio file")?;

        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .context("Unsupported audio format")?;

        let mut format = probed.format;
        let track = format
            .default_track()
            .context("No audio track found")?;

        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track.codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);
        let track_id = track.id;

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .context("Failed to create decoder")?;

        let mut interleaved: Vec<f32> = Vec::new();

        loop {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(symphonia::core::errors::Error::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break;
                }
                Err(e) => return Err(e.into()),
            };

            if packet.track_id() != track_id {
                continue;
            }

            let decoded = decoder.decode(&packet)?;
            let spec = *decoded.spec();
            let num_frames = decoded.capacity();

            let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
            sample_buf.copy_interleaved_ref(decoded);
            interleaved.extend_from_slice(sample_buf.samples());
        }

        Ok(Self {
            interleaved,
            sample_rate,
            channels,
        })
    }

    pub fn interleaved(&self) -> &[f32] {
        &self.interleaved
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }
}
