use std::f32::consts::PI;

/// Generate a Hann window of the given size
pub fn hann(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| {
            let t = i as f32 / (size - 1) as f32;
            0.5 * (1.0 - (2.0 * PI * t).cos())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hann_window_size() {
        let w = hann(1024);
        assert_eq!(w.len(), 1024);
    }

    #[test]
    fn test_hann_window_endpoints() {
        let w = hann(1024);
        // Hann window starts and ends near zero
        assert!(w[0].abs() < 1e-6);
        // Middle should be near 1.0
        assert!((w[512] - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_hann_window_symmetry() {
        let w = hann(256);
        for i in 0..128 {
            assert!((w[i] - w[255 - i]).abs() < 1e-5);
        }
    }
}
