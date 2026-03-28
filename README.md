# Luminance

Multi-panel audio visualizer built with Tauri 2, React, and Rust.

Inspired by minimeters. Designed for music producers, DJs, and audio enthusiasts.

## Features

### 7 Visualizer Panels

- **Spectrum** -- FabFilter Pro-Q style smooth curve with rainbow fill, sparkle dots, and peak frequency bubbles
- **Waveform** -- Rekordbox-style frequency-colored scrolling waveform with L/R and M/S modes
- **Oscilloscope** -- Triggered waveform with phosphor glow, BPM-synced time divisions
- **VU Meter** -- LED segment bars with peak hold and floating value bubbles
- **Loudness** -- ITU-R BS.1770 LUFS meter (Momentary / Short-term) with -14 LUFS reference
- **Spectrogram** -- Scrolling waterfall with 11-stop color gradient and dB legend
- **Stereometer** -- Lissajous M/S scope with LED correlation bar

### Audio

- File playback (WAV, MP3, FLAC, OGG, AAC) with transport controls
- Microphone capture
- Play / Pause / Seek / Loop
- Stereo data flow (L/R independent processing)

### Adaptive Metering

- File pre-analysis on load: automatic display range optimization
- Per-channel frequency band coloring (independent L/R/M/S FFT)
- User-adjustable range sliders on VU, Loudness, and Waveform
- Shared BPM input for beat-synced grids

### Video Export

- Live screen capture to MP4 (H.264 + AAC)
- Hardware encoding support (VideoToolbox on macOS, NVENC on NVIDIA)
- Automatic end-of-file detection
- Requires FFmpeg installed on the system

### Visual Design

- Neon Noir dark theme with glowing text labels
- LED segment meters with glow effects
- Custom NeonSlider / NeonRangeSlider controls
- HiDPI-aware canvas rendering with context caching

## Architecture

```
Rust (src-tauri/)          = ALL audio I/O + ALL DSP computation
React (src/)               = ONLY rendering + UI interaction
Bridge                     = Tauri events (Rust->JS) + Tauri commands (JS->Rust)
```

### Data Flow

```
Audio Source -> CPAL -> Ring Buffer (crossbeam, lock-free SPSC)
  -> DSP thread (8192-point FFT, RMS, LUFS, Stereo)
  -> Tauri event emit (~60fps)
  -> React -> Canvas
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App framework | Tauri 2 |
| Audio I/O | cpal |
| FFT | rustfft (8192-point) |
| Audio decoding | symphonia |
| Lock-free buffer | crossbeam |
| LUFS metering | ITU-R BS.1770 K-weighting (biquad IIR) |
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 |
| Video export | FFmpeg (system) via stdin pipe |

## Prerequisites

- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) (v20+)
- [FFmpeg](https://ffmpeg.org/) (for video export, optional)

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
luminance/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   ├── state.rs
│   │   ├── audio/
│   │   │   ├── engine.rs      # Audio engine + DSP loop
│   │   │   ├── file_player.rs # Symphonia decoder
│   │   │   ├── mic_capture.rs # CPAL input
│   │   │   ├── ring_buffer.rs # Lock-free SPSC
│   │   │   └── transport.rs   # Play/pause/seek/loop
│   │   ├── dsp/
│   │   │   ├── fft.rs         # FFT processor
│   │   │   ├── rms.rs         # RMS / Peak
│   │   │   ├── loudness.rs    # ITU-R BS.1770 LUFS
│   │   │   ├── stereo.rs      # Correlation + Lissajous
│   │   │   ├── analyzer.rs    # File pre-analysis
│   │   │   ├── window.rs      # Hann window
│   │   │   └── utils.rs       # Band energy + decimation
│   │   └── render/
│   │       ├── ffmpeg.rs       # FFmpeg process management
│   │       └── offline.rs      # Offline DSP engine
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── Panel.tsx
│   │   ├── Toolbar.tsx
│   │   ├── RenderDialog.tsx
│   │   ├── NeonSlider.tsx
│   │   └── visualizers/
│   │       ├── Spectrum.tsx
│   │       ├── Waveform.tsx
│   │       ├── Oscilloscope.tsx
│   │       ├── VUMeter.tsx
│   │       ├── Loudness.tsx
│   │       ├── Spectrogram.tsx
│   │       └── Stereometer.tsx
│   ├── hooks/
│   │   ├── useAudioData.ts
│   │   ├── useAnimationFrame.ts
│   │   ├── useFileAnalysis.ts
│   │   └── useBpm.tsx
│   └── lib/
│       ├── canvas.ts
│       ├── colors.ts
│       ├── scales.ts
│       └── offscreenRenderer.ts
```

## License

MIT
