use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::audio::engine::AudioEngine;
use crate::audio::transport::TransportState;
use crate::render::ffmpeg::FfmpegProcess;

pub struct RenderState {
    pub ffmpeg: Option<FfmpegProcess>,
    pub cancel: Arc<AtomicBool>,
}

pub struct AppState {
    pub engine: Mutex<Option<AudioEngine>>,
    pub transport: Mutex<Option<TransportState>>,
    pub render: Mutex<Option<RenderState>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            transport: Mutex::new(None),
            render: Mutex::new(None),
        }
    }
}
