mod audio;
mod commands;
mod dsp;
mod render;
mod state;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_audio_devices,
            commands::start_mic_capture,
            commands::open_audio_file,
            commands::stop_audio,
            commands::play_pause,
            commands::seek,
            commands::set_looping,
            commands::check_ffmpeg,
            commands::start_render,
            commands::submit_frame,
            commands::finish_render,
            commands::cancel_render,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
