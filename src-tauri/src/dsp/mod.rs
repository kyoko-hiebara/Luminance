pub mod analyzer;
pub mod fft;
pub mod loudness;
pub mod rms;
pub mod stereo;
pub mod utils;
pub mod window;

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct AudioData {
    pub spectrum: SpectrumData,
    pub levels: LevelData,
    pub waveform: WaveformData,
    pub stereo: StereoData,
    pub loudness: LoudnessData,
    /// Latest FFT frame magnitudes in dB (for spectrogram waterfall)
    pub spectrogram_frame: Vec<f32>,
    pub transport: Option<TransportData>,
}

#[derive(Clone, Serialize)]
pub struct TransportData {
    pub position_secs: f64,
    pub duration_secs: f64,
    pub is_paused: bool,
    pub is_looping: bool,
}

#[derive(Clone, Serialize)]
pub struct SpectrumData {
    pub magnitudes: Vec<f32>,
    pub peaks: Vec<f32>,
}

#[derive(Clone, Serialize)]
pub struct LevelData {
    pub rms_l: f32,
    pub rms_r: f32,
    pub peak_l: f32,
    pub peak_r: f32,
}

#[derive(Clone, Serialize)]
pub struct WaveformData {
    pub samples_l: Vec<f32>,
    pub samples_r: Vec<f32>,
    /// Per-channel frequency band energies (linear, 0..1)
    pub band_l: [f32; 3],
    pub band_r: [f32; 3],
    /// Side (L-R) band energies — distinct spectrum from Mid
    pub band_s: [f32; 3],
}

#[derive(Clone, Serialize)]
pub struct StereoData {
    pub correlation: f32,
    /// L channel samples for Lissajous X/Y display (decimated)
    pub lissajous_l: Vec<f32>,
    /// R channel samples for Lissajous X/Y display (decimated)
    pub lissajous_r: Vec<f32>,
}

#[derive(Clone, Serialize)]
pub struct LoudnessData {
    pub momentary: f32,
    pub short_term: f32,
    pub true_peak_l: f32,
    pub true_peak_r: f32,
    pub mid_short: f32,
    pub side_short: f32,
}
