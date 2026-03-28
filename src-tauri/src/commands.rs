use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::audio::engine::AudioEngine;
use crate::state::{AppState, RenderState};
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let default_device_name = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let devices: Vec<AudioDeviceInfo> = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?
        .filter_map(|device| {
            let name = device.name().ok()?;
            Some(AudioDeviceInfo {
                is_default: name == default_device_name,
                name,
            })
        })
        .collect();

    Ok(devices)
}

#[tauri::command]
pub fn start_mic_capture(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    device_name: Option<String>,
) -> Result<(), String> {
    let mut engine_lock = state.engine.lock().map_err(|e| e.to_string())?;
    let mut transport_lock = state.transport.lock().map_err(|e| e.to_string())?;

    if let Some(engine) = engine_lock.take() {
        engine.stop();
    }
    *transport_lock = None;

    // Clear file analysis state when switching to mic capture
    let _ = app.emit("file-analysis", &Option::<crate::dsp::analyzer::FileAnalysis>::None);

    let engine = AudioEngine::new_mic_capture(app, device_name)
        .map_err(|e| format!("Failed to start mic capture: {}", e))?;

    *engine_lock = Some(engine);
    Ok(())
}

#[tauri::command]
pub fn open_audio_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut engine_lock = state.engine.lock().map_err(|e| e.to_string())?;
    let mut transport_lock = state.transport.lock().map_err(|e| e.to_string())?;

    if let Some(engine) = engine_lock.take() {
        engine.stop();
    }

    let engine = AudioEngine::new_file_player(app, &path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;

    *transport_lock = engine.transport().cloned();
    *engine_lock = Some(engine);
    Ok(())
}

#[tauri::command]
pub fn stop_audio(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut engine_lock = state.engine.lock().map_err(|e| e.to_string())?;
    let mut transport_lock = state.transport.lock().map_err(|e| e.to_string())?;

    if let Some(engine) = engine_lock.take() {
        engine.stop();
    }
    *transport_lock = None;

    // Clear file analysis state when stopping audio
    let _ = app.emit("file-analysis", &Option::<crate::dsp::analyzer::FileAnalysis>::None);

    Ok(())
}

#[tauri::command]
pub fn play_pause(state: State<'_, AppState>) -> Result<bool, String> {
    let lock = state.transport.lock().map_err(|e| e.to_string())?;
    let transport = lock.as_ref().ok_or("No file loaded")?;
    Ok(transport.toggle_pause())
}

#[tauri::command]
pub fn seek(state: State<'_, AppState>, position_secs: f64) -> Result<(), String> {
    let lock = state.transport.lock().map_err(|e| e.to_string())?;
    let transport = lock.as_ref().ok_or("No file loaded")?;
    let frame = (position_secs * transport.sample_rate as f64) as usize;
    let total = transport.total_frames.load(Ordering::Relaxed);
    transport.seek(frame.min(total));
    Ok(())
}

#[tauri::command]
pub fn set_looping(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let lock = state.transport.lock().map_err(|e| e.to_string())?;
    let transport = lock.as_ref().ok_or("No file loaded")?;
    transport.looping.store(enabled, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn check_ffmpeg() -> Result<Option<String>, String> {
    Ok(crate::render::ffmpeg::find_ffmpeg())
}

#[tauri::command]
pub fn start_render(
    state: State<'_, AppState>,
    audio_path: String,
    output_path: String,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<(), String> {
    use crate::render::ffmpeg::{find_ffmpeg, detect_hw_encoder, FfmpegProcess};

    let mut render_lock = state.render.lock().map_err(|e| e.to_string())?;

    if let Some(existing) = render_lock.take() {
        existing.cancel.store(true, Ordering::Relaxed);
    }

    let ffmpeg_path = find_ffmpeg().ok_or("FFmpeg not found")?;
    let hw_enc = detect_hw_encoder(&ffmpeg_path);

    let ffmpeg = FfmpegProcess::new(
        &ffmpeg_path, width, height, fps, &audio_path, &output_path, hw_enc.as_deref(),
    ).map_err(|e| format!("Failed to start FFmpeg: {}", e))?;

    let cancel = Arc::new(AtomicBool::new(false));

    *render_lock = Some(RenderState {
        ffmpeg: Some(ffmpeg),
        cancel: cancel.clone(),
    });

    Ok(())
}

#[tauri::command]
pub fn submit_frame(
    state: State<'_, AppState>,
    frame_data: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&frame_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let mut render_lock = state.render.lock().map_err(|e| e.to_string())?;
    let render = render_lock.as_mut().ok_or("No active render")?;
    let ffmpeg = render.ffmpeg.as_mut().ok_or("FFmpeg not running")?;
    ffmpeg.write_frame(&bytes).map_err(|e| format!("FFmpeg write error: {}", e))
}

#[tauri::command]
pub fn finish_render(state: State<'_, AppState>) -> Result<(), String> {
    let mut render_lock = state.render.lock().map_err(|e| e.to_string())?;
    if let Some(mut render) = render_lock.take() {
        if let Some(ffmpeg) = render.ffmpeg.take() {
            ffmpeg.finish().map_err(|e| format!("FFmpeg finish error: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_render(state: State<'_, AppState>) -> Result<(), String> {
    let mut render_lock = state.render.lock().map_err(|e| e.to_string())?;
    if let Some(mut render) = render_lock.take() {
        render.cancel.store(true, Ordering::Relaxed);
        drop(render.ffmpeg.take()); // kill FFmpeg
    }
    Ok(())
}
