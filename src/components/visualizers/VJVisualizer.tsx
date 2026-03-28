import { useRef, useEffect } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";

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

// ─── Math Helpers ─────────────────────────────────────────────────────────────

mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

// ─── Hash & Noise ─────────────────────────────────────────────────────────────

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm4(vec2 p) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 4; i++) { sum += noise(p * freq) * amp; freq *= 2.0; amp *= 0.5; }
  return sum;
}
float fbm6(vec2 p) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 6; i++) { sum += noise(p * freq) * amp; freq *= 2.0; amp *= 0.5; }
  return sum;
}

// ─── Inigo Quilez Palette ─────────────────────────────────────────────────────

vec3 palette(float t) {
  vec3 a = vec3(0.24, 0.58, 0.58);
  vec3 b = vec3(0.24, 0.48, 0.38);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.52, 0.80, 0.55);
  return a + b * cos(6.28318 * (c * t + d));
}

// ─── SDF Primitives ───────────────────────────────────────────────────────────

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  return sdBox(p, b - r) - r;
}

float sdCross(vec2 p, float size, float thick) {
  float d1 = sdBox(p, vec2(size, thick));
  float d2 = sdBox(p, vec2(thick, size));
  return min(d1, d2);
}

float sdRing(vec2 p, float r, float thick) {
  return abs(length(p) - r) - thick;
}

// Smooth min for metaball blending
float smin(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// ─── Domain Warp ──────────────────────────────────────────────────────────────

vec2 domainWarp(vec2 p, float amt, float t) {
  float n1 = fbm4(p + vec2(t * 0.15, t * 0.12));
  float n2 = fbm4(p + vec2(t * -0.1 + 5.2, t * 0.08 + 1.3));
  vec2 w1 = vec2(n1, n2) * amt;
  float n3 = fbm4(p + w1 + vec2(t * 0.07 + 1.7, t * -0.13 + 9.2));
  float n4 = fbm4(p + w1 + vec2(t * -0.06 + 8.3, t * 0.09 + 2.8));
  return w1 + vec2(n3, n4) * amt * 0.5;
}

// ─── Shape Layer (SDF composited) ─────────────────────────────────────────────

float shapeLayer(vec2 uv, float t, float bass, float mid, float high, float beat) {
  float d = 1e5;

  // Blob (metaball): 2-3 spheres merging, bass drives size
  float blobR = 0.18 + bass * 0.12;
  vec2 b1 = vec2(sin(t * 0.4) * 0.3, cos(t * 0.35) * 0.25);
  vec2 b2 = vec2(cos(t * 0.5) * 0.25, sin(t * 0.45 + 1.0) * 0.3);
  vec2 b3 = vec2(sin(t * 0.3 + 2.0) * 0.2, cos(t * 0.55 + 0.5) * 0.2);
  float blob = smin(sdCircle(uv - b1, blobR), sdCircle(uv - b2, blobR * 0.85), 0.2);
  blob = smin(blob, sdCircle(uv - b3, blobR * 0.7), 0.15);
  d = min(d, blob);

  // Rounded rectangle: mid drives corner radius, beat kicks rotation
  vec2 rp = uv - vec2(-0.15, 0.1);
  rp = rot2(t * 0.2 + beat * 1.5) * rp;
  float cornerR = 0.02 + mid * 0.06;
  float rbox = sdRoundBox(rp, vec2(0.15, 0.1), cornerR);
  d = min(d, rbox);

  // Cross marker: beat pulses scale
  vec2 cp = uv - vec2(-0.55, 0.45);
  cp = rot2(t * 0.15) * cp;
  float crossSize = 0.06 + beat * 0.04;
  float cross = sdCross(cp, crossSize, 0.012);
  d = min(d, cross);

  // Ring trails around blob center
  vec2 arcCenter = (b1 + b2) * 0.5;
  vec2 ap = uv - arcCenter;
  float ringR = 0.35 + mid * 0.1;
  float ring1 = sdRing(ap, ringR, 0.008);
  float ring2 = sdRing(ap, ringR * 0.75, 0.006);
  d = min(d, min(ring1, ring2));

  // Floating circles (small, scattered) — unrolled for compatibility
  d = min(d, sdCircle(uv - vec2(sin(0.0 + t*0.2)*0.7, cos(0.0 + t*0.15)*0.5), 0.02 + 0.01*sin(t*0.8)));
  d = min(d, sdCircle(uv - vec2(sin(2.1 + t*0.2)*0.7, cos(1.7 + t*0.15)*0.5), 0.02 + 0.01*sin(t*0.8+3.0)));
  d = min(d, sdCircle(uv - vec2(sin(4.2 + t*0.2)*0.7, cos(3.4 + t*0.15)*0.5), 0.02 + 0.01*sin(t*0.8+6.0)));
  d = min(d, sdCircle(uv - vec2(sin(6.3 + t*0.2)*0.7, cos(5.1 + t*0.15)*0.5), 0.02 + 0.01*sin(t*0.8+9.0)));
  d = min(d, sdCircle(uv - vec2(sin(8.4 + t*0.2)*0.7, cos(6.8 + t*0.15)*0.5), 0.02 + 0.01*sin(t*0.8+12.0)));

  // Dot grid (right area): high drives individual dot scale
  vec2 gp = uv - vec2(0.45, -0.3);
  gp = rot2(0.3) * gp;
  vec2 gridId = floor(gp * 8.0);
  vec2 gridUv = fract(gp * 8.0) - 0.5;
  float dotR = 0.08 + high * 0.12 * (0.5 + 0.5 * sin(gridId.x * 1.3 + gridId.y * 2.1 + t));
  float dots = sdCircle(gridUv, dotR);
  d = min(d, dots);

  return d;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time;
  float bass = clamp(u_bass, 0.0, 1.0);
  float mid  = clamp(u_mid,  0.0, 1.0);
  float high = clamp(u_high, 0.0, 1.0);
  float rms  = clamp(u_rms,  0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);

  // Beat zoom pulse
  uv *= 1.0 - beat * 0.06;

  // Slow rotation
  uv = rot2(t * (0.08 + mid * 0.12)) * uv;

  // ─── Background: domain warp flow ──────────────────────────────────
  vec2 p = uv * (1.5 + bass * 0.4);
  float warpAmt = 1.6 + bass * 2.0 + beat * 1.0;
  vec2 warp = domainWarp(p, warpAmt, t);
  vec2 warped = p + warp;

  float pattern = mix(fbm4(warped), fbm6(warped), high);
  float pattern2 = mix(fbm4(warped * 1.5 + vec2(3.7, 8.1) + t * 0.05), fbm6(warped * 1.5 + vec2(3.7, 8.1) + t * 0.05), high);
  float combined = pattern * 0.6 + pattern2 * 0.4;
  combined = clamp(pow(combined, 0.8) * 1.3, 0.0, 1.0);

  float palIdx = combined + length(warp) * 0.12 + t * 0.025;
  vec3 bgCol = palette(palIdx);
  vec3 bgCol2 = palette(palIdx + 0.33 + bass * 0.08);
  bgCol = mix(bgCol, bgCol2, pattern2 * 0.4);

  // ─── Shapes SDF layer ──────────────────────────────────────────────
  float shapeDist = shapeLayer(uv, t, bass, mid, high, beat);

  // Shape rendering: glow + edge
  float shapeGlow = exp(-max(shapeDist, 0.0) * 8.0) * 0.6;
  float shapeEdge = smoothstep(0.01, 0.0, abs(shapeDist)) * 0.8;
  float shapeFill = smoothstep(0.005, -0.02, shapeDist) * 0.35;

  // Shape color: brighter palette
  vec3 shapeCol = palette(palIdx + 0.5) * 1.4;
  vec3 edgeCol = vec3(0.6, 0.95, 0.95); // cyan-white for edges

  // Compose shape onto background
  vec3 col = bgCol;
  col += shapeCol * shapeFill;
  col += shapeCol * shapeGlow;
  col += edgeCol * shapeEdge;

  // ─── Bass radial pulse ─────────────────────────────────────────────
  float dist = length(uv);
  col *= 1.0 + bass * 0.35 * (1.0 - smoothstep(0.0, 1.8, dist));

  // ─── Brightness from RMS ───────────────────────────────────────────
  col *= 0.5 + rms * 0.6;

  // ─── Vignette ──────────────────────────────────────────────────────
  col *= 1.0 - smoothstep(0.6, 2.0, dist);

  // ─── Beat flash ────────────────────────────────────────────────────
  col += vec3(0.35, 0.9, 0.85) * beat * 0.4;

  // ─── Tone mapping & gamma ──────────────────────────────────────────
  col = pow(clamp(col, 0.0, 1.0), vec3(0.9));

  fragColor = vec4(col, 1.0);
}
`;

// ─── WebGL Helpers ────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
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

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
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
  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

interface Uniforms {
  u_time: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_bass: WebGLUniformLocation | null;
  u_mid: WebGLUniformLocation | null;
  u_high: WebGLUniformLocation | null;
  u_rms: WebGLUniformLocation | null;
  u_beat: WebGLUniformLocation | null;
}

function dbToNorm(db: number, floor = -60, ceil = 0): number {
  return Math.max(0, Math.min(1, (Math.max(floor, Math.min(ceil, db)) - floor) / (ceil - floor)));
}

interface Props {
  width: number;
  height: number;
}

export function VJVisualizer({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Uniforms | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const dataRef = useRef<AudioData | null>(null);
  const startTimeRef = useRef(performance.now() / 1000);

  const beatRef = useRef(0);
  const prevBassRef = useRef(0);
  const smoothBassRef = useRef(0);
  const smoothMidRef = useRef(0);
  const smoothHighRef = useRef(0);
  const smoothRmsRef = useRef(0);

  useAudioData("audio-data", (payload) => { dataRef.current = payload; });

  // WebGL init
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return;
    glRef.current = gl;
    const program = createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) return;
    programRef.current = program;
    uniformsRef.current = {
      u_time: gl.getUniformLocation(program, "u_time"),
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_bass: gl.getUniformLocation(program, "u_bass"),
      u_mid: gl.getUniformLocation(program, "u_mid"),
      u_high: gl.getUniformLocation(program, "u_high"),
      u_rms: gl.getUniformLocation(program, "u_rms"),
      u_beat: gl.getUniformLocation(program, "u_beat"),
    };

    const verts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vaoRef.current = vao;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    bufferRef.current = buf;
    const pos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    startTimeRef.current = performance.now() / 1000;

    return () => {
      if (programRef.current) gl.deleteProgram(programRef.current);
      if (vaoRef.current) gl.deleteVertexArray(vaoRef.current);
      if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
      glRef.current = null;
    };
  }, []);

  useAnimationFrame(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const u = uniformsRef.current;
    const vao = vaoRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !u || !vao || !canvas) return;

    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.floor(width * dpr);
    const ph = Math.floor(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      gl.viewport(0, 0, pw, ph);
    }

    const data = dataRef.current;
    let bass = 0, mid = 0, high = 0, rms = 0;
    if (data) {
      const wf = data.waveform;
      bass = (wf.band_l[0] + wf.band_r[0]) * 0.5;
      mid = (wf.band_l[1] + wf.band_r[1]) * 0.5;
      high = (wf.band_l[2] + wf.band_r[2]) * 0.5;
      rms = dbToNorm((data.levels.rms_l + data.levels.rms_r) * 0.5);
    }

    const a = 0.18;
    smoothBassRef.current += (bass - smoothBassRef.current) * a;
    smoothMidRef.current += (mid - smoothMidRef.current) * a;
    smoothHighRef.current += (high - smoothHighRef.current) * a;
    smoothRmsRef.current += (rms - smoothRmsRef.current) * a;

    const delta = bass - prevBassRef.current;
    if (delta > 0.1 && bass > 0.2) beatRef.current = 1.0;
    else beatRef.current *= 0.92;
    prevBassRef.current = bass;

    const elapsed = performance.now() / 1000 - startTimeRef.current;
    gl.useProgram(program);
    gl.uniform1f(u.u_time, elapsed);
    gl.uniform2f(u.u_resolution, pw, ph);
    gl.uniform1f(u.u_bass, smoothBassRef.current);
    gl.uniform1f(u.u_mid, smoothMidRef.current);
    gl.uniform1f(u.u_high, smoothHighRef.current);
    gl.uniform1f(u.u_rms, smoothRmsRef.current);
    gl.uniform1f(u.u_beat, beatRef.current);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  });

  return <canvas ref={canvasRef} style={{ width: width, height: height, display: "block" }} />;
}
