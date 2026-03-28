import { useRef, useEffect } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";

interface Props {
  width: number;
  height: number;
}

// ─── Shader Sources ───────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_rms;
uniform float u_beat;

// ─── Hash & Noise ─────────────────────────────────────────────────────────────

// Simple 2D hash for value noise
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ─── FBM (Fractal Brownian Motion) ────────────────────────────────────────────

float fbm(vec2 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += noise(p * freq) * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

// ─── Inigo Quilez Cosine Palette ──────────────────────────────────────────────
// palette(t) = a + b * cos(2pi * (c*t + d))
// Tuned for Cyan (#00F5D4) to Purple (#7B2FBE)

vec3 palette(float t) {
  // a = brightness center, b = amplitude, c = frequency, d = phase
  vec3 a = vec3(0.24, 0.58, 0.58);
  vec3 b = vec3(0.24, 0.48, 0.38);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.52, 0.80, 0.55);
  return a + b * cos(6.28318 * (c * t + d));
}

// ─── Domain Warp ──────────────────────────────────────────────────────────────

vec2 domainWarp(vec2 p, float warpAmt, float t) {
  // First warp layer — large scale organic motion
  float n1 = fbm(p + vec2(t * 0.15, t * 0.12), 4, 2.0, 0.5);
  float n2 = fbm(p + vec2(t * -0.1 + 5.2, t * 0.08 + 1.3), 4, 2.0, 0.5);
  vec2 warp1 = vec2(n1, n2) * warpAmt;

  // Second warp layer — feeds back on itself for complexity
  float n3 = fbm(p + warp1 + vec2(t * 0.07 + 1.7, t * -0.13 + 9.2), 3, 2.0, 0.5);
  float n4 = fbm(p + warp1 + vec2(t * -0.06 + 8.3, t * 0.09 + 2.8), 3, 2.0, 0.5);
  vec2 warp2 = vec2(n3, n4) * warpAmt * 0.5;

  return warp1 + warp2;
}

// ─── Rotation ─────────────────────────────────────────────────────────────────

mat2 rot2(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = v_uv;
  uv = uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time;

  // Audio parameters (clamped for safety)
  float bass = clamp(u_bass, 0.0, 1.0);
  float mid  = clamp(u_mid,  0.0, 1.0);
  float high = clamp(u_high, 0.0, 1.0);
  float rms  = clamp(u_rms,  0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);

  // ─── Beat zoom pulse ───────────────────────────────────────────────
  float zoomPulse = 1.0 - beat * 0.08;
  uv *= zoomPulse;

  // ─── Rotation driven by mid frequencies ─────────────────────────────
  float rotSpeed = 0.1 + mid * 0.25;
  uv = rot2(t * rotSpeed) * uv;

  // ─── Scale / zoom ──────────────────────────────────────────────────
  vec2 p = uv * (1.5 + bass * 0.5);

  // ─── Domain warp amplitude driven by bass ───────────────────────────
  float warpAmt = 1.8 + bass * 2.5 + beat * 1.2;

  vec2 warp = domainWarp(p, warpAmt, t);
  vec2 warped = p + warp;

  // ─── Detail octaves driven by high frequencies ──────────────────────
  int octaves = 4 + int(high * 4.0); // 4-8 octaves
  float lacunarity = 2.0 + high * 0.5;

  // ─── Main pattern ──────────────────────────────────────────────────
  float pattern = fbm(warped, octaves, lacunarity, 0.5);

  // Second layer for more depth
  float pattern2 = fbm(warped * 1.5 + vec2(3.7, 8.1) + t * 0.05, octaves, lacunarity, 0.5);

  // Combine layers
  float combined = pattern * 0.6 + pattern2 * 0.4;

  // ─── Edge sharpness from high frequencies ───────────────────────────
  float sharp = 1.0 + high * 3.0;
  combined = pow(combined, 0.8 / sharp) * sharp * 0.5;
  combined = clamp(combined, 0.0, 1.0);

  // ─── Palette coloring ──────────────────────────────────────────────
  // Shift palette over time and with warp displacement
  float palIdx = combined + length(warp) * 0.15 + t * 0.03;
  vec3 col = palette(palIdx);

  // Add a secondary color layer for more richness
  vec3 col2 = palette(palIdx + 0.33 + bass * 0.1);
  col = mix(col, col2, pattern2 * 0.5);

  // ─── Bass pulse (radial darken/brighten) ────────────────────────────
  float dist = length(uv);
  float pulse = 1.0 + bass * 0.4 * (1.0 - smoothstep(0.0, 2.0, dist));
  col *= pulse;

  // ─── Overall brightness from RMS ────────────────────────────────────
  float brightness = 0.55 + rms * 0.55;
  col *= brightness;

  // ─── Vignette ──────────────────────────────────────────────────────
  float vig = 1.0 - smoothstep(0.5, 2.2, dist);
  col *= vig;

  // ─── Beat flash ────────────────────────────────────────────────────
  // White-cyan additive flash on beat
  vec3 flashColor = vec3(0.4, 0.95, 0.9);
  col += flashColor * beat * 0.45;

  // ─── Final ─────────────────────────────────────────────────────────
  // Subtle gamma / tone mapping
  col = pow(col, vec3(0.92));
  col = clamp(col, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

// ─── WebGL Helpers ────────────────────────────────────────────────────────────

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  // Shaders can be detached after linking
  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  return program;
}

interface UniformLocations {
  u_time: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_bass: WebGLUniformLocation | null;
  u_mid: WebGLUniformLocation | null;
  u_high: WebGLUniformLocation | null;
  u_rms: WebGLUniformLocation | null;
  u_beat: WebGLUniformLocation | null;
}

function getUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): UniformLocations {
  return {
    u_time: gl.getUniformLocation(program, "u_time"),
    u_resolution: gl.getUniformLocation(program, "u_resolution"),
    u_bass: gl.getUniformLocation(program, "u_bass"),
    u_mid: gl.getUniformLocation(program, "u_mid"),
    u_high: gl.getUniformLocation(program, "u_high"),
    u_rms: gl.getUniformLocation(program, "u_rms"),
    u_beat: gl.getUniformLocation(program, "u_beat"),
  };
}

// ─── Audio Processing Helpers ─────────────────────────────────────────────────

/** Convert dB value (typically -60..0 range) to normalized 0..1 */
function dbToNorm(db: number, floor: number = -60, ceiling: number = 0): number {
  const clamped = Math.max(floor, Math.min(ceiling, db));
  return (clamped - floor) / (ceiling - floor);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VJVisualizer({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<UniformLocations | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const dataRef = useRef<AudioData | null>(null);
  const startTimeRef = useRef<number>(performance.now() / 1000);
  const prevSizeRef = useRef({ w: 0, h: 0 });

  // Beat detection state
  const beatRef = useRef(0);
  const prevBassRef = useRef(0);
  const smoothBassRef = useRef(0);
  const smoothMidRef = useRef(0);
  const smoothHighRef = useRef(0);
  const smoothRmsRef = useRef(0);

  // Listen to audio data
  useAudioData("audio-data", (payload) => {
    dataRef.current = payload;
  });

  // Initialize WebGL2
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      console.error("WebGL2 not supported");
      return;
    }
    glRef.current = gl;

    // Compile and link shaders
    const program = createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) {
      console.error("Failed to create shader program");
      return;
    }
    programRef.current = program;
    uniformsRef.current = getUniformLocations(gl, program);

    // Create fullscreen quad geometry
    // Two triangles covering clip space [-1, 1]
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vaoRef.current = vao;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    bufferRef.current = buffer;

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    startTimeRef.current = performance.now() / 1000;

    // Cleanup
    return () => {
      if (programRef.current) gl.deleteProgram(programRef.current);
      if (vaoRef.current) gl.deleteVertexArray(vaoRef.current);
      if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
      programRef.current = null;
      vaoRef.current = null;
      bufferRef.current = null;
      uniformsRef.current = null;
      glRef.current = null;
    };
  }, []);

  // Render loop
  useAnimationFrame(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const uniforms = uniformsRef.current;
    const vao = vaoRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !uniforms || !vao || !canvas) return;

    // Handle canvas resize with devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const displayW = Math.floor(width * dpr);
    const displayH = Math.floor(height * dpr);

    if (prevSizeRef.current.w !== displayW || prevSizeRef.current.h !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, displayW, displayH);
      prevSizeRef.current = { w: displayW, h: displayH };
    }

    // ─── Extract audio parameters ─────────────────────────────────────
    const data = dataRef.current;
    let bass = 0;
    let mid = 0;
    let high = 0;
    let rms = 0;

    if (data) {
      const wf = data.waveform;
      // band_l and band_r are [low, mid, high] in dB
      bass = dbToNorm((wf.band_l[0] + wf.band_r[0]) * 0.5, -60, 0);
      mid = dbToNorm((wf.band_l[1] + wf.band_r[1]) * 0.5, -60, 0);
      high = dbToNorm((wf.band_l[2] + wf.band_r[2]) * 0.5, -60, 0);

      // RMS from levels (already in dB)
      rms = dbToNorm((data.levels.rms_l + data.levels.rms_r) * 0.5, -60, 0);
    }

    // ─── Smoothing (EMA) ──────────────────────────────────────────────
    const smoothAlpha = 0.15;
    smoothBassRef.current += (bass - smoothBassRef.current) * smoothAlpha;
    smoothMidRef.current += (mid - smoothMidRef.current) * smoothAlpha;
    smoothHighRef.current += (high - smoothHighRef.current) * smoothAlpha;
    smoothRmsRef.current += (rms - smoothRmsRef.current) * smoothAlpha;

    const sBass = smoothBassRef.current;
    const sMid = smoothMidRef.current;
    const sHigh = smoothHighRef.current;
    const sRms = smoothRmsRef.current;

    // ─── Beat detection ───────────────────────────────────────────────
    // Detect sudden bass spikes relative to recent average
    const bassThreshold = 0.12;
    const bassDelta = bass - prevBassRef.current;
    if (bassDelta > bassThreshold && bass > 0.25) {
      beatRef.current = 1.0;
    } else {
      beatRef.current *= 0.92; // decay
    }
    prevBassRef.current = bass;

    // ─── Set uniforms and draw ────────────────────────────────────────
    const now = performance.now() / 1000;
    const elapsed = now - startTimeRef.current;

    gl.useProgram(program);

    gl.uniform1f(uniforms.u_time, elapsed);
    gl.uniform2f(uniforms.u_resolution, displayW, displayH);
    gl.uniform1f(uniforms.u_bass, sBass);
    gl.uniform1f(uniforms.u_mid, sMid);
    gl.uniform1f(uniforms.u_high, sHigh);
    gl.uniform1f(uniforms.u_rms, sRms);
    gl.uniform1f(uniforms.u_beat, beatRef.current);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  });

  return <canvas ref={canvasRef} />;
}
