/// Compute frequency band energies from FFT magnitudes (in dB).
/// Returns (low, mid, high) as linear values 0..1.
pub fn compute_band_energies(magnitudes: &[f32], num_bands: usize) -> (f32, f32, f32) {
    // Bands are log-spaced 20Hz-20kHz. Approximate frequency boundaries:
    // Band i covers freq: 20 * (20000/20)^((i+0.5)/num_bands)
    // 200 Hz boundary: 20 * 1000^(i/n) = 200 => i = n * log10(10) / log10(1000) = n * 1/3
    // 2000 Hz boundary: i = n * 2/3
    let low_end = num_bands / 3; // ~200 Hz boundary
    let mid_end = num_bands * 2 / 3; // ~2000 Hz boundary

    let sum_band = |from: usize, to: usize| -> f32 {
        let mut sum = 0.0f32;
        for i in from..to.min(magnitudes.len()) {
            // Convert from dB back to linear power for energy summation
            let db = magnitudes[i].max(-90.0);
            sum += (10.0f32).powf(db / 10.0); // power (not amplitude)
        }
        sum
    };

    let low = sum_band(0, low_end);
    let mid = sum_band(low_end, mid_end);
    let high = sum_band(mid_end, num_bands);
    let total = (low + mid + high).max(1e-10);

    // Normalize to 0..1 (relative energy per band)
    (low / total, mid / total, high / total)
}

pub fn decimate_waveform(samples: &[f32], target_len: usize) -> Vec<f32> {
    if samples.len() <= target_len {
        return samples.to_vec();
    }
    let step = samples.len() as f32 / target_len as f32;
    (0..target_len)
        .map(|i| {
            let idx = (i as f32 * step) as usize;
            samples[idx.min(samples.len() - 1)]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_band_energies_uniform() {
        // All bands at same dB level => roughly equal energy split
        let magnitudes = vec![-20.0f32; 96];
        let (low, mid, high) = compute_band_energies(&magnitudes, 96);
        let sum = low + mid + high;
        assert!((sum - 1.0).abs() < 0.01, "energies should sum to 1.0, got {}", sum);
        // Each third should be roughly 0.33
        assert!((low - 0.333).abs() < 0.01);
        assert!((mid - 0.333).abs() < 0.01);
        assert!((high - 0.333).abs() < 0.01);
    }

    #[test]
    fn test_compute_band_energies_empty() {
        let magnitudes: Vec<f32> = vec![];
        let (low, mid, high) = compute_band_energies(&magnitudes, 0);
        // Should not panic; all zeros go to total = 1e-10
        assert!(low >= 0.0);
        assert!(mid >= 0.0);
        assert!(high >= 0.0);
    }

    #[test]
    fn test_decimate_waveform_shorter_input() {
        let samples = vec![1.0, 2.0, 3.0];
        let result = decimate_waveform(&samples, 10);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_decimate_waveform_longer_input() {
        let samples: Vec<f32> = (0..1024).map(|i| i as f32).collect();
        let result = decimate_waveform(&samples, 128);
        assert_eq!(result.len(), 128);
        // First sample should be 0.0
        assert!((result[0] - 0.0).abs() < f32::EPSILON);
    }
}
