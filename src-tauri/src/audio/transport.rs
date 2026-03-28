use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

pub const NO_SEEK: usize = usize::MAX;

#[derive(Clone)]
pub struct TransportState {
    pub play_pos: Arc<AtomicUsize>,
    pub total_frames: Arc<AtomicUsize>,
    pub paused: Arc<AtomicBool>,
    pub looping: Arc<AtomicBool>,
    pub seek_target: Arc<AtomicUsize>,
    pub sample_rate: u32,
}

impl TransportState {
    pub fn new(total_frames: usize, sample_rate: u32) -> Self {
        Self {
            play_pos: Arc::new(AtomicUsize::new(0)),
            total_frames: Arc::new(AtomicUsize::new(total_frames)),
            paused: Arc::new(AtomicBool::new(true)),
            looping: Arc::new(AtomicBool::new(false)),
            seek_target: Arc::new(AtomicUsize::new(NO_SEEK)),
            sample_rate,
        }
    }

    pub fn seek(&self, frame: usize) {
        self.seek_target.store(frame, Ordering::Release);
    }

    pub fn toggle_pause(&self) -> bool {
        let was = self.paused.load(Ordering::Relaxed);
        self.paused.store(!was, Ordering::Release);
        !was
    }

    pub fn position_secs(&self) -> f64 {
        self.play_pos.load(Ordering::Relaxed) as f64 / self.sample_rate as f64
    }

    pub fn duration_secs(&self) -> f64 {
        self.total_frames.load(Ordering::Relaxed) as f64 / self.sample_rate as f64
    }
}
