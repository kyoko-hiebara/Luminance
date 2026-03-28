use super::LevelData;

pub struct RmsProcessor {
    /// Integration time in samples
    integration_samples: usize,
    buffer_l: Vec<f32>,
    buffer_r: Vec<f32>,
    write_pos: usize,
    peak_l: f32,
    peak_r: f32,
    peak_decay: f32,
}

impl RmsProcessor {
    /// Create a new RMS processor.
    /// `integration_ms` is the integration time in milliseconds (300ms for VU).
    /// `sample_rate` is the audio sample rate.
    pub fn new(integration_ms: f32, sample_rate: f32) -> Self {
        let integration_samples = (integration_ms * sample_rate / 1000.0) as usize;
        Self {
            integration_samples,
            buffer_l: vec![0.0; integration_samples],
            buffer_r: vec![0.0; integration_samples],
            write_pos: 0,
            peak_l: 0.0,
            peak_r: 0.0,
            peak_decay: 0.995, // peak hold decay per process call
        }
    }

    /// Process interleaved stereo samples [L, R, L, R, ...]
    /// or mono samples (duplicated to both channels).
    pub fn process(&mut self, samples_l: &[f32], samples_r: &[f32]) -> LevelData {
        // Track peaks with decay
        self.peak_l *= self.peak_decay;
        self.peak_r *= self.peak_decay;

        for (&l, &r) in samples_l.iter().zip(samples_r.iter()) {
            self.buffer_l[self.write_pos] = l * l;
            self.buffer_r[self.write_pos] = r * r;
            self.write_pos = (self.write_pos + 1) % self.integration_samples;

            let abs_l = l.abs();
            let abs_r = r.abs();
            if abs_l > self.peak_l {
                self.peak_l = abs_l;
            }
            if abs_r > self.peak_r {
                self.peak_r = abs_r;
            }
        }

        let rms_l = (self.buffer_l.iter().sum::<f32>() / self.integration_samples as f32).sqrt();
        let rms_r = (self.buffer_r.iter().sum::<f32>() / self.integration_samples as f32).sqrt();

        // Convert to dB
        let to_db = |v: f32| -> f32 {
            if v > 0.0 {
                (20.0 * v.log10()).max(-90.0)
            } else {
                -90.0
            }
        };

        LevelData {
            rms_l: to_db(rms_l),
            rms_r: to_db(rms_r),
            peak_l: to_db(self.peak_l),
            peak_r: to_db(self.peak_r),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rms_silence() {
        let mut proc = RmsProcessor::new(300.0, 44100.0);
        let silence = vec![0.0f32; 1024];
        let result = proc.process(&silence, &silence);
        assert!(result.rms_l <= -89.0);
        assert!(result.rms_r <= -89.0);
    }

    #[test]
    fn test_rms_full_scale_sine() {
        let mut proc = RmsProcessor::new(300.0, 44100.0);
        let samples: Vec<f32> = (0..44100)
            .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 44100.0).sin())
            .collect();
        let result = proc.process(&samples, &samples);
        // RMS of a sine wave = amplitude / sqrt(2) ≈ -3.01 dB
        assert!((result.rms_l - (-3.01)).abs() < 0.5, "Expected ~-3dB, got {}", result.rms_l);
    }
}
