use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct FileAnalysis {
    pub peak_l_db: f32,
    pub peak_r_db: f32,
    pub rms_l_db: f32,
    pub rms_r_db: f32,
    pub dynamic_range_db: f32,
    /// Density (max-min per 512-sample window) percentiles
    pub density_p10: f32,
    pub density_p50: f32,
    pub density_p90: f32,
    pub density_max: f32,
    /// Rough integrated loudness estimate (unweighted, for range-setting only)
    pub integrated_loudness_estimate: f32,
    pub sample_rate: u32,
    pub duration_secs: f64,
}

const WINDOW_SIZE: usize = 512;

fn to_db(amp: f32) -> f32 {
    if amp > 0.0 {
        20.0 * amp.log10()
    } else {
        -90.0
    }
}

pub fn analyze(interleaved: &[f32], channels: u16, sample_rate: u32) -> FileAnalysis {
    let ch = channels.max(1) as usize;
    let total_frames = interleaved.len() / ch;
    let samples_per_sec = sample_rate as usize;

    let mut peak_l: f32 = 0.0;
    let mut peak_r: f32 = 0.0;
    let mut sum_sq_l: f64 = 0.0;
    let mut sum_sq_r: f64 = 0.0;

    // Per-second RMS tracking
    let mut sec_sum_l: f64 = 0.0;
    let mut sec_sum_r: f64 = 0.0;
    let mut sec_count: usize = 0;
    let mut rms_per_sec: Vec<f32> = Vec::new();

    // Per-window density tracking
    let mut win_min: f32 = f32::INFINITY;
    let mut win_max: f32 = f32::NEG_INFINITY;
    let mut win_count: usize = 0;
    let mut densities: Vec<f32> = Vec::new();

    for frame in 0..total_frames {
        let offset = frame * ch;
        let l = interleaved[offset];
        let r = if ch >= 2 { interleaved[offset + 1] } else { l };
        let mono = (l + r) * 0.5;

        // Peaks
        let al = l.abs();
        let ar = r.abs();
        if al > peak_l {
            peak_l = al;
        }
        if ar > peak_r {
            peak_r = ar;
        }

        // Overall sum of squares
        sum_sq_l += (l as f64) * (l as f64);
        sum_sq_r += (r as f64) * (r as f64);

        // Per-second accumulation
        sec_sum_l += (l as f64) * (l as f64);
        sec_sum_r += (r as f64) * (r as f64);
        sec_count += 1;
        if sec_count >= samples_per_sec {
            let rms = ((sec_sum_l + sec_sum_r) / (2.0 * sec_count as f64)).sqrt() as f32;
            rms_per_sec.push(to_db(rms));
            sec_sum_l = 0.0;
            sec_sum_r = 0.0;
            sec_count = 0;
        }

        // Per-window min/max for density
        if mono < win_min {
            win_min = mono;
        }
        if mono > win_max {
            win_max = mono;
        }
        win_count += 1;
        if win_count >= WINDOW_SIZE {
            densities.push(win_max - win_min);
            win_min = f32::INFINITY;
            win_max = f32::NEG_INFINITY;
            win_count = 0;
        }
    }

    // Flush remaining per-second
    if sec_count > 0 {
        let rms = ((sec_sum_l + sec_sum_r) / (2.0 * sec_count as f64)).sqrt() as f32;
        rms_per_sec.push(to_db(rms));
    }
    // Flush remaining window
    if win_count > 0 && win_max > win_min {
        densities.push(win_max - win_min);
    }

    // Overall RMS
    let rms_l = (sum_sq_l / total_frames.max(1) as f64).sqrt() as f32;
    let rms_r = (sum_sq_r / total_frames.max(1) as f64).sqrt() as f32;

    // Dynamic range from per-second RMS
    rms_per_sec.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dynamic_range_db = if rms_per_sec.len() >= 2 {
        let p5 = rms_per_sec[rms_per_sec.len() * 5 / 100];
        let p95 = rms_per_sec[rms_per_sec.len() * 95 / 100];
        (p95 - p5).max(0.0)
    } else {
        0.0
    };

    // Density percentiles
    densities.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let density_percentile = |p: usize| -> f32 {
        if densities.is_empty() {
            return 0.0;
        }
        let idx = (densities.len() * p / 100).min(densities.len() - 1);
        densities[idx]
    };

    // Integrated loudness estimate (unweighted, simplified)
    let mean_sq = (sum_sq_l + sum_sq_r) / (2.0 * total_frames.max(1) as f64);
    let integrated = if mean_sq > 0.0 {
        (-0.691 + 10.0 * mean_sq.log10()) as f32
    } else {
        -70.0
    };

    FileAnalysis {
        peak_l_db: to_db(peak_l).max(-90.0),
        peak_r_db: to_db(peak_r).max(-90.0),
        rms_l_db: to_db(rms_l).max(-90.0),
        rms_r_db: to_db(rms_r).max(-90.0),
        dynamic_range_db,
        density_p10: density_percentile(10),
        density_p50: density_percentile(50),
        density_p90: density_percentile(90),
        density_max: densities.last().copied().unwrap_or(0.0),
        integrated_loudness_estimate: integrated.max(-70.0),
        sample_rate,
        duration_secs: total_frames as f64 / sample_rate as f64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_silence() {
        let data = vec![0.0f32; 48000 * 2]; // 1 sec stereo silence
        let result = analyze(&data, 2, 48000);
        assert!(result.peak_l_db <= -89.0);
        assert!(result.rms_l_db <= -89.0);
        assert!(result.density_p50 < 0.001);
    }

    #[test]
    fn test_full_scale_sine() {
        let data: Vec<f32> = (0..48000)
            .flat_map(|i| {
                let s = (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 48000.0).sin();
                [s, s] // stereo
            })
            .collect();
        let result = analyze(&data, 2, 48000);
        assert!(
            result.peak_l_db > -1.0,
            "peak should be near 0 dB, got {}",
            result.peak_l_db
        );
        assert!(
            result.rms_l_db > -4.0 && result.rms_l_db < -2.0,
            "RMS of sine should be ~-3dB, got {}",
            result.rms_l_db
        );
        assert!(result.density_p50 > 0.5, "density should be high for sine");
    }

    #[test]
    fn test_dynamic_range() {
        // 2 seconds: first second loud, second second quiet
        let mut data: Vec<f32> = Vec::new();
        for i in 0..48000 {
            let s = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin();
            data.push(s);
            data.push(s);
        }
        for i in 0..48000 {
            let s = 0.01 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin();
            data.push(s);
            data.push(s);
        }
        let result = analyze(&data, 2, 48000);
        assert!(
            result.dynamic_range_db > 20.0,
            "dynamic range should be >20dB, got {}",
            result.dynamic_range_db
        );
    }
}
