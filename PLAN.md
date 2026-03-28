# 🎛️ Luminance — Audio Visualizer

minimeters-inspired multi-panel audio visualizer built with Tauri 2 + React + Rust.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Tauri 2 App                                    │
│                                                 │
│  ┌──────────────────┐   ┌────────────────────┐  │
│  │   Rust Backend   │   │  React Frontend    │  │
│  │                  │   │                    │  │
│  │  CPAL audio I/O  │──▶│  Canvas2D / WebGL  │  │
│  │  rustfft (FFT)   │   │  Visualizer panels │  │
│  │  LUFS metering   │   │  Layout engine     │  │
│  │  Ring buffer     │   │  Theme system      │  │
│  │                  │   │                    │  │
│  │  Tauri Commands  │◀─▶│  @tauri-apps/api   │  │
│  └──────────────────┘   └────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Data Flow

```
Audio Source (file / mic)
  → CPAL stream callback
  → Ring buffer (lock-free, crossbeam)
  → DSP thread (dedicated)
      ├─ FFT (rustfft, window: Hann)
      ├─ RMS / Peak (VU)
      ├─ LUFS (BS.1770 K-weighting)
      ├─ Stereo correlation
      └─ Waveform samples (decimated)
  → Tauri event emit (JSON, ~60fps throttle)
  → React state → Canvas render
```

---

## Tech Stack

### Rust Backend (src-tauri/)
| Crate | Purpose |
|---|---|
| `tauri` v2 | App framework |
| `cpal` | Cross-platform audio I/O (file playback + mic capture) |
| `rustfft` | FFT for spectrum / spectrogram |
| `symphonia` | Audio file decoding (wav, flac, mp3, ogg, aac) |
| `crossbeam` | Lock-free ring buffer for audio data |
| `serde` / `serde_json` | Serialization for Tauri commands/events |
| `rubato` | Sample rate conversion (if needed) |

### React Frontend (src/)
| Library | Purpose |
|---|---|
| `react` + `vite` | UI framework + build tool |
| `@tauri-apps/api` v2 | Tauri IPC bridge |
| `tailwindcss` | Utility styling + dark theme |
| Canvas 2D API | All visualizer rendering |
| `react-grid-layout` | Draggable/resizable panel layout (optional) |

---

## Project Structure

```
luminance/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── lib.rs               # Module exports
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── engine.rs        # Audio engine (CPAL setup, stream management)
│   │   │   ├── file_player.rs   # File decoding + playback (symphonia)
│   │   │   ├── mic_capture.rs   # Microphone input
│   │   │   └── ring_buffer.rs   # Lock-free ring buffer
│   │   ├── dsp/
│   │   │   ├── mod.rs
│   │   │   ├── fft.rs           # FFT processor (spectrum + spectrogram)
│   │   │   ├── rms.rs           # RMS / Peak / VU metering
│   │   │   ├── loudness.rs      # ITU-R BS.1770 LUFS
│   │   │   ├── stereo.rs        # Stereo correlation + Lissajous
│   │   │   └── window.rs        # Window functions (Hann, Blackman-Harris)
│   │   ├── commands.rs          # Tauri command handlers
│   │   ├── state.rs             # App state management
│   │   └── render/
│   │       ├── mod.rs
│   │       ├── session.rs       # Render session manager (start/cancel/progress)
│   │       ├── scheduler.rs     # Frame-accurate sample position calculator
│   │       └── encoder.rs       # FFmpeg sidecar process spawner + stdin pipe
│   └── icons/
├── src/
│   ├── main.tsx
│   ├── App.tsx                  # Main layout with panel grid
│   ├── hooks/
│   │   ├── useAudioData.ts      # Tauri event listener for audio data
│   │   └── useAnimationFrame.ts # requestAnimationFrame hook
│   ├── components/
│   │   ├── Layout.tsx           # Panel grid container
│   │   ├── Panel.tsx            # Generic panel wrapper (title bar, resize)
│   │   ├── Toolbar.tsx          # File open, mic select, transport controls
│   │   └── visualizers/
│   │       ├── Spectrum.tsx     # FFT spectrum analyzer
│   │       ├── Waveform.tsx     # Waveform display
│   │       ├── Oscilloscope.tsx # Oscilloscope (triggered waveform)
│   │       ├── VUMeter.tsx      # VU meter (needle or bar)
│   │       ├── Loudness.tsx     # LUFS meter (integrated + short-term)
│   │       ├── Spectrogram.tsx  # Scrolling spectrogram (waterfall)
│   │       └── Stereometer.tsx  # Lissajous / correlation meter
│   ├── lib/
│   │   ├── canvas.ts            # Canvas drawing utilities
│   │   ├── colors.ts            # Color palettes / gradients
│   │   ├── scales.ts            # Frequency/dB scale helpers
│   │   └── offscreen.ts         # OffscreenCanvas renderer for video export
│   └── styles/
│       └── globals.css
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

---

## Development Phases

### Phase 0: Scaffold (Sprint 0)
- [ ] `cargo create-tauri-app luminance` with React + Vite template
- [ ] Add Rust crate dependencies (cpal, rustfft, symphonia, crossbeam)
- [ ] Basic Tauri window with dark background
- [ ] Verify CPAL can list audio devices (mic) in Tauri command
- [ ] File open dialog → symphonia decode → basic PCM buffer

### Phase 1: Spectrum Analyzer (MVP)
**Goal: FFT spectrum bars rendering on screen**

Rust side:
- [ ] Audio engine: mic capture OR file playback → ring buffer
- [ ] FFT processor: 4096-point FFT, Hann window, magnitude → dB conversion
- [ ] Tauri event: emit spectrum data at 60fps (`app.emit("audio-data", payload)`)
- [ ] Frequency bin → perceptual grouping (logarithmic scale, ~64-128 bands)

React side:
- [ ] `useAudioData` hook: listen to Tauri event, store in ref (not state, for perf)
- [ ] `Spectrum.tsx`: Canvas 2D bar chart
  - Logarithmic frequency axis (20Hz–20kHz)
  - dB scale (-90dB to 0dB)
  - Gradient fill (cool-to-warm, e.g., deep blue → cyan → green → yellow → red)
  - Peak hold (slowly decaying peak indicators)
  - Smooth falloff animation (exponential decay)

### Phase 2: Waveform + Oscilloscope
**Goal: Time-domain visualization**

Rust side:
- [ ] Decimated waveform buffer (downsample to ~2048 samples for display)
- [ ] Oscilloscope trigger detection (zero-crossing, rising edge)

React side:
- [ ] `Waveform.tsx`: Scrolling/static waveform
  - L/R or mono display
  - Line or filled style
  - Grid overlay with time markers
- [ ] `Oscilloscope.tsx`: Triggered waveform
  - Stable display via trigger point alignment
  - Phosphor glow effect (optional, via trail rendering)
  - Adjustable time division

### Phase 3: VU + Loudness Meters
**Goal: Level metering with broadcast standards**

Rust side:
- [ ] RMS calculation (300ms integration for VU)
- [ ] Peak detection (sample-accurate, with hold/decay)
- [ ] ITU-R BS.1770 LUFS implementation:
  - K-weighting filter (high-shelf + high-pass, 2nd order IIR)
  - Momentary (400ms), Short-term (3s), Integrated (gated)
  - True Peak (4x oversampled)

React side:
- [ ] `VUMeter.tsx`:
  - Classic needle-style or modern bar style
  - Peak LED indicator
  - Stereo (L/R) display
- [ ] `Loudness.tsx`:
  - Momentary / Short-term / Integrated LUFS readout
  - Loudness range (LRA) bar
  - True Peak indicator
  - Target reference line (e.g., -14 LUFS for streaming)

### Phase 4: Spectrogram + Stereometer
**Goal: Advanced visualizations**

Rust side:
- [ ] STFT for spectrogram (overlapping FFT frames, stored in circular 2D buffer)
- [ ] Stereo correlation: `Σ(L·R) / sqrt(Σ(L²)·Σ(R²))`
- [ ] L/R → M/S conversion for Lissajous

React side:
- [ ] `Spectrogram.tsx`:
  - Scrolling waterfall display (newest at bottom or right)
  - Color mapping: magnitude → colormap (inferno, magma, or custom)
  - WebGL recommended for performance (texture-based scrolling)
  - Frequency axis: logarithmic
  - Time resolution display
- [ ] `Stereometer.tsx`:
  - Lissajous (X/Y scope): L on one axis, R on other
  - Correlation meter bar (-1 to +1)
  - Phase scope with persistence/decay

### Phase 5: Video Render Mode 🎬
**Goal: Offline render audio file → MP4 for Twitter/SNS posting**

This is NOT real-time screen capture. It's an offline, frame-accurate renderer:

```
Audio File (symphonia decode)
  → Frame-by-frame DSP (deterministic, no real-time constraint)
  → Canvas render per frame
  → Raw RGBA pixels → FFmpeg stdin pipe
  → MP4 (H.264 + AAC) output
```

#### Architecture

Rust side:
- [ ] Offline DSP engine: process audio in exact frame-sized chunks
  - Frame chunk size = `sample_rate / fps` samples per frame
  - Run FFT, RMS, LUFS, stereo analysis per chunk (same DSP as real-time, reused)
- [ ] FFmpeg process management:
  - Spawn `ffmpeg` as child process via `std::process::Command`
  - Pipe raw RGBA frames to stdin (`-f rawvideo -pix_fmt rgba`)
  - Mux with original audio file (`-i audio_file`)
  - Output: H.264 + AAC in MP4 container
- [ ] Progress tracking: emit progress events to frontend (frame N / total frames)

React side:
- [ ] Render mode toggle: switches from real-time to offline render
- [ ] Offscreen canvas: same visualizer components render to offscreen canvas
  - `OffscreenCanvas` or hidden canvas element
  - Each frame: receive DSP data → draw → extract pixels via `getImageData()`
  - Send RGBA bytes back to Rust via Tauri command
- [ ] Render dialog UI:
  - Resolution picker: 1920×1080 (default), 1280×720, 3840×2160
  - FPS: 30 (default) or 60
  - Which panels to include in render (checkbox per visualizer)
  - Progress bar with ETA
  - Cancel button
- [ ] Export presets (SNS-optimized):

  | Preset | Resolution | FPS | Aspect | Limits |
  |---|---|---|---|---|
  | Twitter/X | 1280×720 | 30 | 16:9 | Max 2:20, ≤512MB |
  | Twitter HQ | 1920×1080 | 60 | 16:9 | Same limits |
  | Instagram Feed | 1080×1080 | 30 | 1:1 | Max 60s |
  | Instagram Reel | 1080×1920 | 30 | 9:16 | Max 90s |
  | YouTube | 1920×1080 | 60 | 16:9 | No real limits |
  | Custom | User-defined | — | — | — |

  Auto-warning: if audio length exceeds platform limit, show trim dialog or warning.

#### FFmpeg Command (generated by Rust)
```bash
ffmpeg -y \
  -f rawvideo -pix_fmt rgba -s {width}x{height} -r {fps} -i pipe:0 \
  -i "{audio_file_path}" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 256k \
  -shortest \
  -movflags +faststart \
  "{output_path}.mp4"
```

#### Key Design Notes
- **Why offscreen render, not screen capture?**
  Frame-perfect sync. No dropped frames. Render at any resolution regardless of monitor.
  A 3-minute track at 30fps = 5,400 frames. Offline render might take 30-90 seconds
  depending on complexity, but every frame is guaranteed correct.

- **FFmpeg delivery strategy:**
  Two options — start with Option A:

  **Option A: Tauri Sidecar (recommended)**
  Bundle `ffmpeg` binary via `tauri.conf.json > bundle > externalBin`.
  Zero setup for user, works out of the box. Binary size ~70MB.
  Tauri sidecar API handles spawning/killing the process cleanly.

  **Option B: System FFmpeg fallback**
  Detect system `ffmpeg` via `which ffmpeg` / `where ffmpeg`.
  If missing, show install instructions. Smaller app bundle.

  **NVENC / Hardware encoding:**
  When available, prefer GPU encoding for much faster renders:
  ```bash
  # NVIDIA (NVENC)
  -c:v h264_nvenc -preset p4 -cq 20 -pix_fmt yuv420p
  # macOS (VideoToolbox)
  -c:v h264_videotoolbox -q:v 65 -pix_fmt yuv420p
  ```
  Detect availability: `ffmpeg -encoders | grep nvenc` at app startup, cache result.

- **Frame data flow optimization:**
  RGBA pixels for 1080p = 1920×1080×4 = ~8MB per frame.
  Use shared memory or large buffer Tauri command to avoid serialization overhead.
  Consider rendering directly in Rust (tiny-skia or cairo) to skip JS↔Rust pixel transfer
  entirely — this is a potential Phase 5 optimization.

#### Render UX Flow (Twitter WIP投稿ワークフロー)
1. 曲ファイルをロード → 普段通りビジュアライザーで確認
2. パネルレイアウトを好みに調整
3. 🎬 **Render** ボタンをクリック
4. プリセット選択 (Twitter 720p / Twitter HQ 1080p / Custom)
5. 含めるパネルをチェックボックスで選択
6. 出力先を選択 → **Start Render**
7. プログレスバー + プレビューサムネイル + 残り時間表示
8. 完了 → 「フォルダを開く」/「パスをコピー」ボタン

### Phase 6: Polish
- [ ] Panel layout system (drag to rearrange, resize)
- [ ] Color theme presets (Neon, Minimal, Retro, Custom)
- [ ] Settings panel (FFT size, smoothing, color scheme, fps cap)
- [ ] Window transparency / frameless mode
- [ ] Performance profiling and optimization
- [ ] App icon and branding

---

## Design System — Color Palette

### "Neon Noir" (Default Theme)
```
Background:    #0a0a0f (near-black with blue tint)
Panel BG:      #12121a
Panel Border:  #1e1e2e
Grid Lines:    #1a1a2e (subtle)
Text Primary:  #e0e0e8
Text Dim:      #6a6a7a

Spectrum Gradient (bottom → top):
  #1a1a4e → #2563eb → #06b6d4 → #22c55e → #eab308 → #ef4444

Accent:        #8b5cf6 (purple, for highlights)
Peak Hold:     #f472b6 (pink)
VU Needle:     #f8fafc (white)
LUFS OK:       #22c55e (green)
LUFS Warn:     #eab308 (yellow)
LUFS Over:     #ef4444 (red)
```

### Spectrogram Colormaps
- `inferno`: black → purple → orange → yellow → white
- `viridis`: dark purple → teal → green → yellow
- `plasma`: deep purple → magenta → orange → yellow
- Custom: user-defined gradient stops

---

## Key Design Decisions

### Why Canvas 2D over WebGL for most panels?
- Simpler to implement and debug
- Sufficient performance for bars/lines at 60fps with ~128 data points
- WebGL reserved for Spectrogram (texture scrolling) if Canvas becomes a bottleneck

### Why Tauri events over Tauri commands for streaming data?
- Commands are request-response (polling = latency + overhead)
- Events are push-based: Rust emits → JS listens, natural fit for real-time audio
- Throttle on Rust side to match display refresh rate

### FFT Details
- Default size: 4096 samples (at 44.1kHz → ~10.7Hz resolution, ~93ms window)
- Window: Hann (good frequency resolution, moderate leakage)
- Overlap: 50% for spectrogram, none needed for spectrum
- Output: magnitude in dB → `20 * log10(|X[k]| / N)`

### Audio Buffer Architecture
- Ring buffer size: 8192 samples per channel (power of 2)
- Lock-free SPSC (single-producer single-consumer) via crossbeam
- Audio thread writes, DSP thread reads
- DSP thread processes and emits Tauri events

---

## Claude Code Prompting Strategy

When using Claude Code, work through phases incrementally:

### Prompt Template for Each Phase
```
I'm building "Luminance", an audio visualizer with Tauri 2 + React + Rust.
Project structure: [paste relevant section]
Current phase: [Phase N description]

What's already done: [list completed items]
Next task: [specific task from checklist]

Requirements:
- Rust backend handles all DSP, frontend is pure rendering
- Data flows via Tauri events (not commands) for real-time streams
- Canvas 2D for rendering (unless otherwise noted)
- Dark theme, color scheme: [paste palette]
```

### Tips for Claude Code Sessions
1. **One component at a time** — don't ask for all visualizers at once
2. **Test audio first** — make sure CPAL + symphonia work before any UI
3. **Verify data flow** — log Tauri events in console before rendering
4. **Keep DSP pure** — no Tauri dependencies in dsp/ modules (testable independently)
5. **Profile early** — watch for frame drops, especially spectrogram
