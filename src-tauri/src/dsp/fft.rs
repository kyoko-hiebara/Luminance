use rustfft::{num_complex::Complex, FftPlanner};

use super::SpectrumData;
use super::window;

pub struct FftProcessor {
    size: usize,
    window: Vec<f32>,
    planner_fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    scratch: Vec<Complex<f32>>,
    bands: Vec<BandRange>,
    /// Smoothed magnitudes (exponential decay)
    smoothed: Vec<f32>,
    /// Peak hold values with decay
    peak_values: Vec<f32>,
    sample_rate: f32,
}

struct BandRange {
    start_bin: usize,
    end_bin: usize,
}

impl FftProcessor {
    pub fn new(size: usize, num_bands: usize, sample_rate: f32) -> Self {
        let window = window::hann(size);

        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(size);
        let scratch_len = fft.get_inplace_scratch_len();

        let bands = compute_band_ranges(size, num_bands, sample_rate);
        let num_bands = bands.len();

        Self {
            size,
            window,
            planner_fft: fft,
            scratch: vec![Complex::new(0.0, 0.0); scratch_len],
            bands,
            smoothed: vec![-90.0; num_bands],
            peak_values: vec![-90.0; num_bands],
            sample_rate,
        }
    }

    /// Process a buffer of samples and return spectrum data.
    /// Input should be mono (or pre-mixed) f32 samples of length >= self.size.
    pub fn process(&mut self, input: &[f32]) -> SpectrumData {
        let n = self.size.min(input.len());

        // Apply window and convert to complex
        let mut buffer: Vec<Complex<f32>> = (0..self.size)
            .map(|i| {
                if i < n {
                    Complex::new(input[i] * self.window[i], 0.0)
                } else {
                    Complex::new(0.0, 0.0)
                }
            })
            .collect();

        // Perform FFT in-place
        self.planner_fft
            .process_with_scratch(&mut buffer, &mut self.scratch);

        // Convert to magnitudes in dB, group into bands
        let half = self.size / 2;
        let norm = self.size as f32;

        let mut magnitudes = Vec::with_capacity(self.bands.len());

        for band in &self.bands {
            let mut max_mag = 0.0f32;
            for bin in band.start_bin..band.end_bin.min(half) {
                let mag = buffer[bin].norm() / norm;
                max_mag = max_mag.max(mag);
            }
            // Convert to dB, clamp to floor
            let db = if max_mag > 0.0 {
                20.0 * max_mag.log10()
            } else {
                -90.0
            };
            magnitudes.push(db.max(-90.0));
        }

        // Apply exponential smoothing
        let attack_coeff = 0.8_f32;  // fast attack
        let release_coeff = 0.05_f32; // slow release

        for (i, &db) in magnitudes.iter().enumerate() {
            if db > self.smoothed[i] {
                self.smoothed[i] += (db - self.smoothed[i]) * attack_coeff;
            } else {
                self.smoothed[i] += (db - self.smoothed[i]) * release_coeff;
            }

            // Peak hold with decay
            if db > self.peak_values[i] {
                self.peak_values[i] = db;
            } else {
                self.peak_values[i] -= 0.3; // decay rate in dB per frame
                self.peak_values[i] = self.peak_values[i].max(-90.0);
            }
        }

        SpectrumData {
            magnitudes: self.smoothed.clone(),
            peaks: self.peak_values.clone(),
        }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
}

/// Compute logarithmically-spaced frequency band ranges
fn compute_band_ranges(fft_size: usize, num_bands: usize, sample_rate: f32) -> Vec<BandRange> {
    let half = fft_size / 2;
    let freq_resolution = sample_rate / fft_size as f32;

    let min_freq: f32 = 20.0;
    let max_freq: f32 = 20000.0_f32.min(sample_rate / 2.0);

    let log_min = min_freq.ln();
    let log_max = max_freq.ln();

    let mut bands = Vec::with_capacity(num_bands);

    for i in 0..num_bands {
        let freq_lo = (log_min + (log_max - log_min) * i as f32 / num_bands as f32).exp();
        let freq_hi = (log_min + (log_max - log_min) * (i + 1) as f32 / num_bands as f32).exp();

        let bin_lo = (freq_lo / freq_resolution).floor() as usize;
        let bin_hi = (freq_hi / freq_resolution).ceil() as usize;

        let start_bin = bin_lo.max(1).min(half);
        let end_bin = bin_hi.max(start_bin + 1).min(half);

        bands.push(BandRange {
            start_bin,
            end_bin,
        });
    }

    bands
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fft_silence() {
        let mut proc = FftProcessor::new(4096, 64, 44100.0);
        let silence = vec![0.0f32; 4096];
        let result = proc.process(&silence);
        assert_eq!(result.magnitudes.len(), 64);
        // All should be at noise floor
        for &m in &result.magnitudes {
            assert!(m <= -89.0);
        }
    }

    #[test]
    fn test_fft_sine() {
        let mut proc = FftProcessor::new(4096, 64, 44100.0);
        let freq = 1000.0;
        let samples: Vec<f32> = (0..4096)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / 44100.0).sin())
            .collect();
        let result = proc.process(&samples);
        // Should have a peak somewhere in the middle bands (1kHz)
        let max_val = result.magnitudes.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        assert!(max_val > -30.0, "Expected peak above -30dB for 1kHz sine, got {}", max_val);
    }

    #[test]
    fn test_band_ranges_coverage() {
        let bands = compute_band_ranges(4096, 64, 44100.0);
        assert_eq!(bands.len(), 64);
        // Bands should be ordered
        for i in 1..bands.len() {
            assert!(bands[i].start_bin >= bands[i - 1].start_bin);
        }
    }
}
