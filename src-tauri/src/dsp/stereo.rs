use super::StereoData;

pub struct StereoProcessor {
    lissajous_size: usize,
}

impl StereoProcessor {
    pub fn new() -> Self {
        Self {
            lissajous_size: 512,
        }
    }

    pub fn process(&self, samples_l: &[f32], samples_r: &[f32]) -> StereoData {
        let mut sum_lr = 0.0_f64;
        let mut sum_ll = 0.0_f64;
        let mut sum_rr = 0.0_f64;

        for (&l, &r) in samples_l.iter().zip(samples_r.iter()) {
            let l = l as f64;
            let r = r as f64;
            sum_lr += l * r;
            sum_ll += l * l;
            sum_rr += r * r;
        }

        let denom = (sum_ll * sum_rr).sqrt();
        let correlation = if denom > 1e-10 {
            (sum_lr / denom) as f32
        } else {
            0.0
        };

        // Decimate for Lissajous display
        let (lissajous_l, lissajous_r) =
            decimate_stereo(samples_l, samples_r, self.lissajous_size);

        StereoData {
            correlation: correlation.clamp(-1.0, 1.0),
            lissajous_l,
            lissajous_r,
        }
    }
}

fn decimate_stereo(l: &[f32], r: &[f32], target: usize) -> (Vec<f32>, Vec<f32>) {
    let len = l.len().min(r.len());
    if len <= target {
        return (l[..len].to_vec(), r[..len].to_vec());
    }
    let step = len as f32 / target as f32;
    let dl: Vec<f32> = (0..target)
        .map(|i| l[(i as f32 * step) as usize])
        .collect();
    let dr: Vec<f32> = (0..target)
        .map(|i| r[(i as f32 * step) as usize])
        .collect();
    (dl, dr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mono_correlation() {
        let proc = StereoProcessor::new();
        let samples: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.1).sin()).collect();
        let result = proc.process(&samples, &samples);
        assert!((result.correlation - 1.0).abs() < 0.01);
        assert!(!result.lissajous_l.is_empty());
    }

    #[test]
    fn test_inverted_correlation() {
        let proc = StereoProcessor::new();
        let samples: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.1).sin()).collect();
        let inverted: Vec<f32> = samples.iter().map(|s| -s).collect();
        let result = proc.process(&samples, &inverted);
        assert!((result.correlation - (-1.0)).abs() < 0.01);
    }

    #[test]
    fn test_silence_correlation() {
        let proc = StereoProcessor::new();
        let silence = vec![0.0f32; 1024];
        let result = proc.process(&silence, &silence);
        assert!((result.correlation - 0.0).abs() < 0.01);
    }
}
