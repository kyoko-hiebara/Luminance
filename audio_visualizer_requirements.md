# Audio-Reactive VJ Visualizer — 要件定義書

**Version:** 0.1.0-draft
**Date:** 2026-03-29
**Author:** きょーこ


## 1. プロジェクト概要

### 1.1 プロダクトビジョン

音楽のFFT解析パラメータ（周波数帯域別エネルギー、スペクトラルセントロイド、ビート検出など）をトリガーとして、複数の抽象的なジオメトリック/オーガニックシェイプが**リアルタイム**で生成・変形・運動するVJ向けビジュアライザー。

**ビジュアルリファレンス:** シアン〜パープルのグラデーション空間に、有機的ブロブ形状（メタボール的）、幾何学パターン（ドットグリッド、斜線束、十字マーカー、丸角矩形）、弧状トレイルなどが浮遊し、音楽パラメータに応答して移動・変形・発光する。

### 1.2 技術スタック

| レイヤー | 技術 | 役割 |
|---------|------|------|
| ホストアプリ | **Tauri 2.x** | ウィンドウ管理、ファイルI/O、システムトレイ |
| オーディオ解析 | **Rust** (cpal + rustfft) | 低レイテンシFFT、特徴量抽出、ビート検出 |
| レンダリング | **React + WebGL2 (or WebGPU)** | GLSLシェーダーベースのフラグメントレンダリング |
| オーディオ→フロント通信 | **Tauri Event / IPC** | Rust解析結果をJSON or ArrayBufferでフロントに配信 |
| UI | **React + CSS** | コントロールパネル、モード切替、パラメータモニタ |

### 1.3 デザインゴール

- 60fps安定（フルHD以上）
- VJユースケース対応（OBSブラウザソース / NDI出力 / フルスクリーン）
- モジュラー構成：シェイプ/シーンの追加が容易
- 音に対するレスポンスの「気持ちよさ」を最優先


## 2. オーディオ解析エンジン（Rust側）

### 2.1 入力ソース

| ソース | 優先度 | 実装方法 |
|--------|--------|----------|
| ローカルオーディオファイル | **P0** | rodio / symphonia でデコード |
| システムオーディオキャプチャ (loopback) | P1 | cpal (WASAPI loopback / PulseAudio monitor) |
| マイク入力 | P2 | cpal デフォルトデバイス |

### 2.2 FFT パイプライン

```
Raw PCM (f32, mono downmix)
  → Hann Window (2048 samples, hop=512)
  → FFT (rustfft, complex output)
  → |magnitude|² → dB scale
  → 周波数ビン配列 (1024 bins)
```

**パラメータ設定:**
- FFTサイズ: 2048 (設定可能: 512 / 1024 / 2048 / 4096)
- ホップサイズ: FFTサイズの1/4（デフォルト512）
- ウィンドウ関数: Hann（Blackman-Harris選択可）
- サンプルレート: ソース依存（通常44100/48000 Hz）

### 2.3 抽出する特徴量

以下の特徴量を**各フレーム（~60Hz）** で抽出し、フロントエンドに送信する。

| パラメータ | 定義 | 正規化範囲 | 用途 |
|-----------|------|-----------|------|
| `bass` | 20–250 Hz帯域のRMSエネルギー | 0.0–1.0 | シェイプスケール、移動速度 |
| `mid` | 250–4000 Hz帯域のRMSエネルギー | 0.0–1.0 | テクスチャ変形、回転 |
| `high` | 4000–20000 Hz帯域のRMSエネルギー | 0.0–1.0 | パーティクル密度、エッジ発光 |
| `sub_bass` | 20–80 Hz帯域のRMSエネルギー | 0.0–1.0 | 画面全体パルス |
| `rms` | 全帯域のRMSラウドネス | 0.0–1.0 | 全体ブライトネス |
| `spectral_centroid` | 重心周波数 (正規化) | 0.0–1.0 | カラーパレットシフト |
| `spectral_flux` | フレーム間のスペクトル差分 | 0.0–1.0 | トランジション速度 |
| `spectral_rolloff` | エネルギー85%累積周波数 | 0.0–1.0 | フォグ/ブルーム強度 |
| `beat` | オンセット検出（エネルギー閾値ベース） | 0.0–1.0 (decay) | フラッシュ、対称性スイッチ |
| `beat_phase` | 推定ビート位相（0→1で1拍） | 0.0–1.0 | 周期的アニメーション同期 |
| `spectrum_texture` | FFTビン配列（128 or 256ビン、対数スケール圧縮） | u8[128] | シェーダーテクスチャ入力 |

### 2.4 スムージング

各パラメータに独立したスムージングを適用する（指数移動平均）。

```
smoothed[i] = smoothed[i] + (raw[i] - smoothed[i]) * attack_or_release
```

- **Attack** （値が増加する方向）: 0.3–0.8（速い追従）
- **Release** （値が減少する方向）: 0.05–0.15（ゆっくり減衰）
- パラメータごとにattack/release値を個別設定可能
- `beat` のみ特別処理: ピーク検出→即座に1.0→指数減衰（decay factor: 0.85–0.92）

### 2.5 IPC プロトコル

Tauri Event System経由で `audio_frame` イベントを配信:

```rust
#[derive(Serialize)]
struct AudioFrame {
    bass: f32,
    mid: f32,
    high: f32,
    sub_bass: f32,
    rms: f32,
    spectral_centroid: f32,
    spectral_flux: f32,
    spectral_rolloff: f32,
    beat: f32,
    beat_phase: f32,
    spectrum: Vec<u8>,  // 128 bins, log-scaled
    timestamp_ms: u64,
}
```

**配信レート:** 60Hz（ディスプレイリフレッシュに同期）
**バッファリング:** ダブルバッファ（書き込み中/読み取り中の分離）


## 3. レンダリングエンジン（React + WebGL2 側）

### 3.1 アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│                   Scene Manager                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Scene A  │  │ Scene B  │  │ Scene C  │ ...  │
│  │(Tunnel)  │  │(Shapes)  │  │(Kaleido) │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       └──────────────┼──────────────┘            │
│                      ▼                           │
│              ┌───────────────┐                   │
│              │  Compositor   │                   │
│              │ (Post-FX)     │                   │
│              │ - Bloom       │                   │
│              │ - Chromatic   │                   │
│              │ - Feedback    │                   │
│              └───────┬───────┘                   │
│                      ▼                           │
│              ┌───────────────┐                   │
│              │  Final Output │                   │
│              │  (Canvas)     │                   │
│              └───────────────┘                   │
└─────────────────────────────────────────────────┘
```

**レンダリング方式:** フルスクリーンクワッドへのフラグメントシェーダー描画（SDF / Raymarching / Procedural）

### 3.2 シーンシステム

各シーン（ビジュアルモード）は以下のインターフェースを実装する:

```typescript
interface VJScene {
  name: string;
  init(gl: WebGL2RenderingContext): void;
  render(gl: WebGL2RenderingContext, params: AudioParams, time: number): void;
  destroy(): void;
  getUniforms(): UniformDescriptor[];  // GUI自動生成用
}
```

シーン切り替えは**クロスフェード**（フレームバッファ2枚のαブレンド、0.5–2秒）で行う。

### 3.3 シーン一覧（初期実装）

#### 3.3.1 Scene: Organic Shapes（メインシーン）

**コンセプト:** 参考画像のような、シアン〜パープル空間にブロブ・幾何学シェイプが浮遊する構成。

**シェイプ種別と音声マッピング:**

| シェイプ | SDF / 描画方式 | 音声トリガー | 挙動 |
|---------|---------------|-------------|------|
| **Blob（有機的ブロブ）** | メタボール SDF (複数球の smooth union) | `bass` → 膨張/収縮, `spectral_flux` → 変形速度 | ゆっくり浮遊、呼吸するようにスケール |
| **Rounded Rectangle** | SDF `sdRoundBox` | `mid` → 角丸半径変化, `beat` → 回転キック | 中央〜中景に配置、回転 |
| **Dot Grid** | 繰り返しSDF `sdCircle` + `mod` | `high` → 個別ドットのスケール（スペクトラムテクスチャ参照） | 右下に配置、波状にパルス |
| **Diagonal Lines（斜線束）** | SDF `sdSegment` 配列 | `spectral_centroid` → 線間隔, `rms` → 太さ | 左下に配置、角度が微動 |
| **Cross Marker（＋）** | SDF 2本の `sdBox` 直交 | `beat` → スケールパルス | 左上にアクセント配置 |
| **Arc Trails（弧状トレイル）** | SDF `sdArc` or 極座標リング | `mid` → 半径, `beat_phase` → 描画範囲（0→2π） | ブロブの周囲を周回 |
| **Floating Circles（浮遊円）** | `sdCircle` + グロー | `sub_bass` → 位置のゆらぎ振幅 | 空間に散在、ゆっくりドリフト |

**シェイプ管理システム:**

```typescript
interface Shape {
  type: ShapeType;
  position: Vec2;       // 正規化座標 (-1 to 1)
  velocity: Vec2;       // フレーム毎の移動量
  scale: number;
  rotation: number;
  color: Vec4;          // RGBA
  audioBinding: AudioBinding;  // どのパラメータにどう反応するか
  layer: number;        // 描画順（背面=0, 前面=N）
  opacity: number;
}

interface AudioBinding {
  param: keyof AudioParams;    // "bass", "mid", etc.
  target: "scale" | "rotation" | "position.x" | "position.y" | "opacity" | "color_shift";
  curve: "linear" | "exponential" | "step" | "sine";
  multiplier: number;
  offset: number;
}
```

各シェイプは**複数のAudioBinding**を持てる（例: bassでスケール + midで回転 + beatで発光）。

#### 3.3.2 Scene: Infinite Tunnel

前回プロトタイプのトンネルシェーダー。極座標マッピング + fbmノイズ壁面。

- `bass` → スクロール速度
- `mid` → 壁面ワープ振幅
- `high` → リングパターンの鋭さ
- `beat` → フラッシュ + FOV瞬間拡大

#### 3.3.3 Scene: Domain Warp Flow

多層fbmドメインワーピング。宇宙的プラズマ流。

- `bass` / `mid` → 各ワープ層のパラメータ
- `spectral_centroid` → カラーパレット遷移
- `rms` → 全体輝度パルス

#### 3.3.4 Scene: Kaleidoscope SDF

極座標リピート + SDFジオメトリ（ポリゴンリング、ラジアルライン、スペクトラムリング）。

- `bass` → 対称数（6–12の動的変化）
- `mid` → 内部回転速度
- `spectral_centroid` → 色相回転
- `beat` → 対称数ジャンプ

### 3.4 カラーシステム

**パレットエンジン:**

```typescript
// Inigo Quilez palette function
palette(t, a, b, c, d) = a + b * cos(2π * (c*t + d))
```

プリセットパレット:

| 名称 | 特徴 | 参考 |
|------|------|------|
| **Cyan-Purple** | 参考画像ベース。シアン(#00F5D4)〜バイオレット(#7B2FBE)のグラデ | デフォルト |
| **Neon Sunset** | マゼンタ〜オレンジ〜イエロー | EDM/Future Bass向き |
| **Monochrome Glow** | 白〜グレーに単色アクセント | ミニマルテクノ向き |
| **Aurora** | グリーン〜ティール〜パープルのオーロラ的遷移 | Trance/Progressive向き |

`spectral_centroid` の値でパレットの `t` パラメータをシフトさせ、音の「明るさ」に応じて色が自然遷移する。

パレットの手動切替 + **自動遷移モード**（ビート数カウントで切替）を実装。

### 3.5 ポストプロセッシング

FBO（Framebuffer Object）チェーンで以下のポストエフェクトを適用:

| エフェクト | 制御パラメータ | 音声マッピング |
|-----------|---------------|---------------|
| **Bloom** | threshold, intensity, radius | `rms` → intensity |
| **Chromatic Aberration** | offset amount | `beat` → 瞬間オフセット |
| **Film Grain** | amount, speed | 定数 (subtle) |
| **Feedback / Echo** | decay, zoom | `spectral_flux` → decay |
| **Vignette** | radius, softness | 定数 |
| **Color Grading** | lift/gamma/gain | パレット連動 |

### 3.6 パフォーマンスバジェット

| 項目 | 目標 |
|------|------|
| フレームレート | 60fps安定 (16.6ms/frame) |
| GPU描画 | < 8ms (フラグメントシェーダー + ポストFX) |
| CPU (JS) | < 4ms (パラメータ受信 + uniform更新) |
| VRAM | < 128MB (FBO × 3 + テクスチャ) |
| 解像度 | ネイティブ × DPR (上限2.0) |


## 4. UIレイヤー

### 4.1 コントロールパネル

**トランスポート:**
- ファイル選択 / ドラッグ&ドロップ
- 再生 / 一時停止 / シークバー
- 時間表示 (current / total)

**シーン制御:**
- モード切替ボタン（Shapes / Tunnel / Flow / Kaleido）
- クロスフェード時間スライダー
- 自動シーンローテーション（ON/OFF + 間隔）

**パラメータモニタ:**
- リアルタイムで全AudioParamsを数値 + ミニバーグラフ表示
- ミニスペクトラム表示（64–128ビン）

**パレット制御:**
- パレットプリセット選択
- 自動遷移モード ON/OFF
- ベースカラー微調整（Hue/Saturation/Brightness オフセット）

**出力設定:**
- フルスクリーン切替
- 解像度スケール (0.5x / 1.0x / 2.0x)
- FPS表示 ON/OFF

### 4.2 キーボードショートカット

| キー | 機能 |
|------|------|
| `Space` | 再生/一時停止 |
| `1`–`4` | シーン直接切替 |
| `H` | UI表示/非表示トグル |
| `F` | フルスクリーンモード |
| `P` | パレット次へ |
| `[` / `]` | 反応感度 ±10% |
| `G` | パラメータモニタ表示トグル |

### 4.3 自動UI非表示

再生中にマウス/タッチ操作がない場合、4秒後にUIをフェードアウト。マウス移動で復帰。VJ時にクリーンな映像出力を確保する。


## 5. Rustクレート構成（案）

```
audio-visualizer/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── capture.rs      # cpal入力デバイス管理
│   │   │   ├── decoder.rs      # symphoniaファイルデコード
│   │   │   ├── fft.rs          # rustfft パイプライン
│   │   │   ├── features.rs     # 特徴量抽出
│   │   │   ├── beat.rs         # ビート検出
│   │   │   └── smoothing.rs    # パラメータスムージング
│   │   ├── ipc/
│   │   │   ├── mod.rs
│   │   │   └── audio_event.rs  # AudioFrame構造体、イベント配信
│   │   └── config.rs           # FFTサイズ等の設定
│   └── Cargo.toml
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── Controls/           # トランスポート、モード選択
│   │   ├── ParamMonitor/       # リアルタイムパラメータ表示
│   │   └── PaletteSelector/    # カラーパレット選択
│   ├── gl/
│   │   ├── renderer.ts         # WebGL2初期化、レンダーループ
│   │   ├── scene-manager.ts    # シーン管理、クロスフェード
│   │   ├── post-fx.ts          # ポストプロセッシングチェーン
│   │   ├── shader-utils.ts     # コンパイル、uniform管理
│   │   └── scenes/
│   │       ├── organic-shapes.ts
│   │       ├── tunnel.ts
│   │       ├── flow.ts
│   │       └── kaleidoscope.ts
│   ├── audio/
│   │   └── audio-bridge.ts     # Tauri IPC受信、パラメータバッファ
│   ├── shaders/
│   │   ├── common.glsl         # noise, palette, SDF共通関数
│   │   ├── quad.vert           # フルスクリーンクワッド頂点
│   │   ├── organic-shapes.frag
│   │   ├── tunnel.frag
│   │   ├── flow.frag
│   │   ├── kaleidoscope.frag
│   │   └── post/
│   │       ├── bloom.frag
│   │       ├── chromatic.frag
│   │       └── composite.frag
│   └── types/
│       └── audio.ts            # AudioFrame型定義
└── package.json
```


## 6. 将来拡張（スコープ外だが意識しておく）

| 機能 | 概要 | 優先度 |
|------|------|--------|
| MIDI入力 | MIDI CC/Noteでパラメータを外部コントロール | P1 |
| Spout/NDI出力 | 映像出力を他VJソフト（Resolume等）に送信 | P1 |
| OSC受信 | TouchOSCなどからパラメータリモート操作 | P2 |
| シーンエディタ | GUI上でシェイプ配置・バインディング編集 | P2 |
| プリセット保存 | シーン+パラメータ+パレット設定をJSON保存/読込 | P1 |
| WebGPU移行 | Compute Shaderでパーティクル物理をGPU実行 | P2 |
| 録画機能 | WebCodecs APIでの映像エクスポート | P2 |
| プラグインシステム | 外部GLSLシェーダーのホットリロード | P3 |


## 7. 非機能要件

### 7.1 パフォーマンス
- 60fps @ 1920×1080 on Intel UHD 630相当のiGPU
- オーディオ解析レイテンシ < 20ms (入力→表示)
- メモリ使用量 < 512MB

### 7.2 対応プラットフォーム
- Windows 10/11（最優先）
- macOS 12+（WebGL2対応ブラウザエンジン）
- Linux（X11/Wayland、Tauri 2.x対応範囲）

### 7.3 対応オーディオフォーマット
- WAV, FLAC, MP3, OGG, AAC, AIFF
- サンプルレート: 44.1kHz–192kHz（内部で48kHzにリサンプル）
- チャンネル: モノ/ステレオ（ステレオはモノダウンミックスして解析）
