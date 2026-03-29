use super::LoudnessData;

struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn new(b: [f64; 3], a: [f64; 3]) -> Self {
        // Normalize by a[0]
        Self {
            b0: b[0] / a[0],
            b1: b[1] / a[0],
            b2: b[2] / a[0],
            a1: a[1] / a[0],
            a2: a[2] / a[0],
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub struct LoudnessProcessor {
    // K-weighting filters for L and R channels
    stage1_l: Biquad,
    stage2_l: Biquad,
    stage1_r: Biquad,
    stage2_r: Biquad,
    // Ring buffers for integration windows
    momentary_buf: Vec<f64>,
    short_term_buf: Vec<f64>,
    buf_pos: usize,
    block_size: usize,
    blocks_momentary: usize,
    blocks_short_term: usize,
    current_block_sum: f64,
    current_block_count: usize,
}

impl LoudnessProcessor {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate as u32;
        let (s1_b, s1_a, s2_b, s2_a) = get_k_weight_coefficients(sr);

        let block_size = (sample_rate * 0.1) as usize; // 100ms blocks
        let blocks_momentary = 4; // 400ms
        let blocks_short_term = 30; // 3s
        let max_blocks = blocks_short_term;

        Self {
            stage1_l: Biquad::new(s1_b, s1_a),
            stage2_l: Biquad::new(s2_b, s2_a),
            stage1_r: Biquad::new(s1_b, s1_a),
            stage2_r: Biquad::new(s2_b, s2_a),
            momentary_buf: vec![0.0; max_blocks],
            short_term_buf: vec![0.0; max_blocks],
            buf_pos: 0,
            block_size,
            blocks_momentary,
            blocks_short_term,
            current_block_sum: 0.0,
            current_block_count: 0,
        }
    }

    /// Process L and R sample buffers and return loudness data.
    pub fn process(&mut self, samples_l: &[f32], samples_r: &[f32]) -> LoudnessData {
        for (&l, &r) in samples_l.iter().zip(samples_r.iter()) {
            // Apply K-weighting
            let kl = self.stage2_l.process(self.stage1_l.process(l as f64));
            let kr = self.stage2_r.process(self.stage1_r.process(r as f64));

            // Accumulate mean square (both channels summed)
            self.current_block_sum += kl * kl + kr * kr;
            self.current_block_count += 1;

            if self.current_block_count >= self.block_size {
                let mean_sq = self.current_block_sum / self.current_block_count as f64;
                self.momentary_buf[self.buf_pos % self.blocks_short_term] = mean_sq;
                self.short_term_buf[self.buf_pos % self.blocks_short_term] = mean_sq;
                self.buf_pos += 1;
                self.current_block_sum = 0.0;
                self.current_block_count = 0;
            }
        }

        let momentary = self.compute_lufs(self.blocks_momentary);
        let short_term = self.compute_lufs(self.blocks_short_term);

        LoudnessData {
            momentary,
            short_term,
            true_peak_l: -90.0,
            true_peak_r: -90.0,
            mid_short: 0.0,
            side_short: 0.0,
        }
    }

    fn compute_lufs(&self, num_blocks: usize) -> f32 {
        let available = self.buf_pos.min(num_blocks);
        if available == 0 {
            return -70.0;
        }

        let total = self.blocks_short_term; // buffer size
        let mut sum = 0.0;
        for i in 0..available {
            let idx = if self.buf_pos >= available {
                (self.buf_pos - available + i) % total
            } else {
                i % total
            };
            sum += self.momentary_buf[idx];
        }

        let mean = sum / available as f64;
        if mean <= 0.0 {
            -70.0
        } else {
            // LUFS = -0.691 + 10 * log10(sum of channel powers)
            // For stereo: power = mean_sq (already summed L+R in accumulation, divide by 2 for per-channel)
            let lufs = -0.691 + 10.0 * (mean / 2.0).log10();
            (lufs as f32).max(-70.0)
        }
    }
}

fn get_k_weight_coefficients(sample_rate: u32) -> ([f64; 3], [f64; 3], [f64; 3], [f64; 3]) {
    match sample_rate {
        44100 => (
            [
                1.5308412300498355,
                -2.6509799951547297,
                1.1690790799215869,
            ],
            [1.0, -1.6636551132560204, 0.7125954280732254],
            [1.0, -2.0, 1.0],
            [1.0, -1.9891696736297957, 0.9891990357870394],
        ),
        48000 => (
            [1.53512485958697, -2.69169618940638, 1.19839281085285],
            [1.0, -1.69065929318241, 0.73248077421585],
            [1.0, -2.0, 1.0],
            [1.0, -1.99004745483398, 0.99007225036621],
        ),
        _ => {
            // Fallback to 48kHz coefficients for other sample rates
            (
                [1.53512485958697, -2.69169618940638, 1.19839281085285],
                [1.0, -1.69065929318241, 0.73248077421585],
                [1.0, -2.0, 1.0],
                [1.0, -1.99004745483398, 0.99007225036621],
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_silence_lufs() {
        let mut proc = LoudnessProcessor::new(48000.0);
        let silence = vec![0.0f32; 48000]; // 1 second
        let result = proc.process(&silence, &silence);
        assert!(result.momentary <= -69.0);
    }

    #[test]
    fn test_full_scale_sine_lufs() {
        let mut proc = LoudnessProcessor::new(48000.0);
        // Full-scale 1kHz sine for 1 second
        let samples: Vec<f32> = (0..48000)
            .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 48000.0).sin())
            .collect();
        let result = proc.process(&samples, &samples);
        // Full-scale sine should be around -3 LUFS (before K-weighting at 1kHz it's roughly passthrough)
        assert!(
            result.momentary > -10.0 && result.momentary < 0.0,
            "Expected momentary between -10 and 0, got {}",
            result.momentary
        );
    }

    #[test]
    fn test_biquad_passthrough() {
        // Unity filter: b=[1,0,0], a=[1,0,0]
        let mut bq = Biquad::new([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
        let input = 0.5;
        let output = bq.process(input);
        assert!((output - 0.5).abs() < 1e-10);
    }
}
