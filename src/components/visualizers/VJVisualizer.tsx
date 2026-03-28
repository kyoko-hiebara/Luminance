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

// ─── Helpers ──────────────────────────────────────────────────────────────────

mat2 rot2(float a) { float s=sin(a),c=cos(a); return mat2(c,-s,s,c); }

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(127.1, 311.7)));
}

float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

vec3 palette(float t) {
  vec3 a=vec3(0.24,0.58,0.58), b=vec3(0.24,0.48,0.38);
  vec3 c=vec3(1.0), d=vec3(0.52,0.80,0.55);
  return a + b * cos(6.28318*(c*t+d));
}

// ─── SDF Shapes ───────────────────────────────────────────────────────────────

float sdCircle(vec2 p, float r) { return length(p)-r; }
float sdRing(vec2 p, float r, float w) { return abs(length(p)-r)-w; }
float sdBox(vec2 p, vec2 b) { vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }

float sdTriangle(vec2 p, float r) {
  p.y += r * 0.3;
  float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r/k;
  if(p.x+k*p.y > 0.0) p = vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;
  p.x -= clamp(p.x,-2.0*r,0.0);
  return -length(p)*sign(p.y);
}

float sdDiamond(vec2 p, float r) {
  p = abs(p);
  return (p.x+p.y-r)*0.707;
}

float sdArrow(vec2 p, float size) {
  float shaft = sdBox(p - vec2(-size*0.2, 0.0), vec2(size*0.5, size*0.12));
  float head = sdTriangle(vec2(p.x - size*0.3, p.y) * vec2(-1.0, 1.0), size*0.35);
  return min(shaft, head);
}

float sdCross(vec2 p, float size, float w) {
  return min(sdBox(p, vec2(size, w)), sdBox(p, vec2(w, size)));
}

float sdStar(vec2 p, float r) {
  float a = atan(p.y, p.x) + 1.57;
  float seg = a / 1.2566; // 2pi/5
  a = (fract(seg)-0.5) * 1.2566;
  vec2 q = vec2(cos(a), abs(sin(a))) * length(p);
  return max(q.x - r*0.7, q.y - r*0.35);
}

// ─── Draw one shape by type index ─────────────────────────────────────────────

float drawShape(vec2 p, float shapeType, float size) {
  float s = shapeType * 7.0;
  if (s < 1.0) return sdCircle(p, size);
  if (s < 2.0) return sdTriangle(p, size);
  if (s < 3.0) return sdBox(p, vec2(size*0.8, size*0.8));
  if (s < 4.0) return sdDiamond(p, size);
  if (s < 5.0) return sdArrow(p, size);
  if (s < 6.0) return sdCross(p, size, size*0.2);
  return sdRing(p, size, size*0.15);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  float aspect = u_resolution.x / u_resolution.y;
  uv.x *= aspect;

  float t = u_time;
  float bass = clamp(u_bass, 0.0, 1.0);
  float mid  = clamp(u_mid,  0.0, 1.0);
  float high = clamp(u_high, 0.0, 1.0);
  float rms  = clamp(u_rms,  0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);

  // ─── Background: subtle gradient + noise ───────────────────────────
  float bgNoise = noise(uv * 2.0 + t * 0.1) * 0.15;
  vec3 bgCol = mix(
    vec3(0.02, 0.02, 0.06),
    vec3(0.06, 0.03, 0.10),
    uv.y * 0.5 + 0.5
  ) + bgNoise;

  // Subtle flow in background
  float flow = noise(uv * 3.0 + vec2(t*0.15, t*0.1));
  bgCol += palette(flow + t*0.02) * 0.06 * rms;

  // ─── Scattered shapes ──────────────────────────────────────────────
  vec3 col = bgCol;

  // 20 shapes via unrolled loop (each shape has unique random properties)
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    vec2 seed = vec2(fi * 7.31, fi * 13.17);
    vec2 rnd = hash2(seed);
    float rnd2 = hash(seed + 100.0);
    float rnd3 = hash(seed + 200.0);
    float rnd4 = hash(seed + 300.0);

    // Random position that drifts over time
    float speed = 0.05 + rnd3 * 0.15 + mid * 0.1;
    float angle = rnd4 * 6.28 + t * (rnd2 - 0.5) * 0.3;
    vec2 pos = vec2(
      sin(fi * 2.39 + t * speed) * (0.6 + rnd.x * 0.6) * aspect,
      cos(fi * 1.73 + t * speed * 0.8) * (0.5 + rnd.y * 0.5)
    );

    // Shape type from hash
    float shapeType = rnd2;

    // Size: bass pulses, plus individual variation
    float size = 0.04 + rnd.x * 0.06 + bass * 0.03 + beat * 0.02;

    // Rotation per shape
    vec2 lp = uv - pos;
    lp = rot2(angle + t * (rnd3 - 0.5) * 0.5) * lp;

    // SDF distance
    float d = drawShape(lp, shapeType, size);

    // Per-shape color from palette
    float palT = rnd4 + t * 0.05 + bass * 0.1;
    vec3 shapeCol = palette(palT) * (0.8 + high * 0.4);

    // Glow + edge + fill
    float glow = exp(-max(d, 0.0) * 12.0) * 0.3;
    float edge = smoothstep(0.008, 0.0, abs(d));
    float fill = smoothstep(0.003, -0.01, d) * 0.2;

    // Opacity: shapes fade based on distance from center
    float distFromCenter = length(pos) / (aspect * 0.8);
    float opacity = (0.5 + rms * 0.5) * (1.0 - distFromCenter * 0.4);

    col += shapeCol * (glow + fill) * opacity;
    col += vec3(0.5, 0.95, 0.9) * edge * opacity * 0.7;
  }

  // ─── Bass pulse (radial) ───────────────────────────────────────────
  float dist = length(uv / vec2(aspect, 1.0));
  col *= 1.0 + bass * 0.25 * (1.0 - smoothstep(0.0, 1.0, dist));

  // ─── Beat flash ────────────────────────────────────────────────────
  col += vec3(0.3, 0.85, 0.8) * beat * 0.35;

  // ─── Brightness ────────────────────────────────────────────────────
  col *= 0.6 + rms * 0.5;

  // ─── Vignette ──────────────────────────────────────────────────────
  col *= 1.0 - smoothstep(0.5, 1.8, dist);

  col = pow(clamp(col, 0.0, 1.0), vec3(0.92));
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
