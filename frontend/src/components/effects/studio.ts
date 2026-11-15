/**
 * "Studio look": real-time camera enhancement on the GPU (WebGL2), in the browser, per frame.
 *
 * One fragment pass per frame does, in order:
 *   1. edge-preserving denoise (3×3 bilateral; stronger in low light, where sensors are noisiest)
 *   2. clarity: unsharp mask on the denoised luma (detail without re-adding the noise)
 *   3. white balance (grey-world, gentle and clamped so a yellow wall isn't "corrected" to grey)
 *   4. exposure gain + shadow lift (a curve that brightens dark tones, keeps black and white fixed)
 *   5. soft highlight roll-off (bright windows don't clip) and a little vibrance
 *
 * Exposure and colour come from a tiny 32×18 sample of the frame (a mip level of the uploaded
 * texture) read back every 8th frame, then eased toward their targets so nothing flickers when
 * the light changes. Everything stays on the device; nothing is uploaded anywhere.
 *
 * Cost: one texture upload + one 9-tap pass at the camera resolution (≈1 ms on integrated GPUs at
 * 720p) and a 576-pixel readback every 8 frames.
 */

export type StudioLevel = "off" | "natural" | "strong";

export const STUDIO_LEVELS: { id: StudioLevel; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "natural", label: "Natural" },
  { id: "strong", label: "Strong" },
];

export const isStudioLevel = (v: unknown): v is StudioLevel => v === "off" || v === "natural" || v === "strong";

const STRENGTH: Record<Exclude<StudioLevel, "off">, number> = { natural: 0.6, strong: 1 };
const STATS_W = 32;
const STATS_H = 18;
const STATS_EVERY = 8;
const EASE = 0.2;
const TARGET_LUMA = 0.46;

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // VideoFrames upload top row first; flip so the output isn't upside down.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const ENHANCE = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec3 u_wb;
uniform float u_gain;
uniform float u_lift;
uniform float u_denoise;
uniform float u_sharp;
uniform float u_vib;
uniform float u_black;
uniform float u_contrast;
in vec2 v_uv;
out vec4 o;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 rolloff(vec3 x) {
  // Linear up to 0.82, then eases into 1.0 instead of clipping.
  vec3 over = max(x - 0.82, 0.0);
  return min(x, 0.82) + over / (1.0 + over / 0.18);
}

void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  float lc = luma(c);
  vec3 sum = vec3(0.0);
  vec3 box = vec3(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = texture(u_tex, v_uv + vec2(float(x), float(y)) * u_texel * 1.5).rgb;
      float d = luma(s) - lc;
      float w = exp(-d * d * 220.0);
      sum += s * w;
      wsum += w;
      box += s;
    }
  }
  vec3 col = mix(c, sum / wsum, u_denoise);
  col += (luma(col) - luma(box / 9.0)) * u_sharp;
  // Black point first (dim cameras turn black into murky grey), then white balance and exposure.
  col = max(col - u_black, 0.0) / (1.0 - u_black);
  col *= u_wb * u_gain;
  col = clamp(col, 0.0, 4.0);
  vec3 inv = 1.0 - min(col, 1.0);
  col += u_lift * 2.6 * col * inv * inv;
  col = rolloff(col);
  // Gentle S-curve around mid-grey brings back the contrast that brightening flattens.
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), u_contrast);
  float l = luma(col);
  float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  col = mix(vec3(l), col, 1.0 + u_vib * (1.0 - sat));
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const STATS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform float u_lod;
in vec2 v_uv;
out vec4 o;
void main() { o = vec4(textureLod(u_tex, v_uv, u_lod).rgb, 1.0); }`;

type Params = {
  gain: number;
  lift: number;
  wb: [number, number, number];
  denoise: number;
  sharp: number;
  vib: number;
  black: number;
  contrast: number;
};

const NEUTRAL: Params = { gain: 1, lift: 0, wb: [1, 1, 1], denoise: 0, sharp: 0, vib: 0, black: 0, contrast: 0 };

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = make(gl.VERTEX_SHADER, VERT);
  const fs = make(gl.FRAGMENT_SHADER, frag);
  const p = gl.createProgram();
  if (!vs || !fs || !p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "a_pos");
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Enhances VideoFrames. `process` returns null when WebGL2 isn't available (caller passes through). */
export class StudioEnhancer {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private enhance: WebGLProgram | null = null;
  private stats: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private statsFbo: WebGLFramebuffer | null = null;
  private statsPixels = new Uint8Array(STATS_W * STATS_H * 4);
  private frameNo = 0;
  private broken = false;
  private params: Params = { ...NEUTRAL, wb: [1, 1, 1] };
  private target: Params = { ...NEUTRAL, wb: [1, 1, 1] };
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(private level: StudioLevel) {}

  setLevel(level: StudioLevel) {
    this.level = level;
  }

  get active() {
    return this.level !== "off" && !this.broken;
  }

  private setup(): boolean {
    if (this.gl) return true;
    if (this.broken || typeof OffscreenCanvas === "undefined") return false;
    const canvas = new OffscreenCanvas(2, 2);
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
    const enhance = gl && compile(gl, ENHANCE);
    const stats = gl && compile(gl, STATS);
    if (!gl || !enhance || !stats) {
      this.broken = true;
      return false;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    const statsTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, statsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STATS_W, STATS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, statsTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    for (const name of ["u_tex", "u_texel", "u_wb", "u_gain", "u_lift", "u_denoise", "u_sharp", "u_vib", "u_black", "u_contrast"]) {
      this.uniforms[name] = gl.getUniformLocation(enhance, name);
    }
    this.uniforms.s_tex = gl.getUniformLocation(stats, "u_tex");
    this.uniforms.s_lod = gl.getUniformLocation(stats, "u_lod");
    Object.assign(this, { canvas, gl, enhance, stats, tex, statsFbo: fbo });
    return true;
  }

  /** Measures the frame and sets new targets (eased in over ~1 s). */
  private measure(width: number, height: number) {
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statsFbo);
    gl.viewport(0, 0, STATS_W, STATS_H);
    gl.useProgram(this.stats);
    gl.uniform1i(this.uniforms.s_tex, 0);
    gl.uniform1f(this.uniforms.s_lod, Math.max(0, Math.log2(Math.max(width / STATS_W, height / STATS_H))));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, STATS_W, STATS_H, gl.RGBA, gl.UNSIGNED_BYTE, this.statsPixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const px = this.statsPixels;
    const n = STATS_W * STATS_H;
    let r = 0;
    let g = 0;
    let b = 0;
    const lumas = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pr = px[i * 4] / 255;
      const pg = px[i * 4 + 1] / 255;
      const pb = px[i * 4 + 2] / 255;
      r += pr;
      g += pg;
      b += pb;
      lumas[i] = 0.299 * pr + 0.587 * pg + 0.114 * pb;
    }
    r /= n;
    g /= n;
    b /= n;
    const mean = Math.max(0.02, 0.299 * r + 0.587 * g + 0.114 * b);
    lumas.sort();
    const p95 = Math.max(0.05, lumas[Math.floor(n * 0.95)]);
    const p02 = lumas[Math.floor(n * 0.02)];

    const s = STRENGTH[this.level as Exclude<StudioLevel, "off">] ?? 0;
    const dark = Math.min(1, Math.max(0, (0.38 - mean) / 0.26));
    // Lift the darkest 2% to true black (capped, so a dark shirt stays a dark shirt).
    const black = Math.min(0.12, Math.max(0, p02 - 0.02)) * s;
    const m = (mean - black) / (1 - black);
    const top = (p95 - black) / (1 - black);
    // Brighten toward a pleasant mid-grey, never pushing the brightest 5% past white.
    const gain = Math.min(TARGET_LUMA / Math.max(0.02, m), 1 + 1.5 * s, 1.08 / Math.max(0.05, top));
    // Grey-world white balance, clamped so a strongly coloured room isn't flattened to grey.
    const wb = [r, g, b].map((c) => {
      const raw = Math.min(1.28, Math.max(0.8, mean / Math.max(0.02, c)));
      return 1 + (raw - 1) * 0.8 * s;
    }) as [number, number, number];
    this.target = {
      gain: Math.max(1, 1 + (gain - 1) * s),
      lift: dark * 0.55 * s,
      wb,
      denoise: Math.min(1, 0.45 * s + 0.4 * dark * s),
      sharp: 0.32 * s,
      vib: 0.16 * s,
      black,
      contrast: (0.12 + 0.18 * dark) * s,
    };
  }

  private ease() {
    const p = this.params;
    const t = this.target;
    const k = EASE;
    p.gain += (t.gain - p.gain) * k;
    p.lift += (t.lift - p.lift) * k;
    p.denoise += (t.denoise - p.denoise) * k;
    p.sharp += (t.sharp - p.sharp) * k;
    p.vib += (t.vib - p.vib) * k;
    p.black += (t.black - p.black) * k;
    p.contrast += (t.contrast - p.contrast) * k;
    p.wb = p.wb.map((v, i) => v + (t.wb[i] - v) * k) as [number, number, number];
  }

  /** A new, enhanced frame (the caller still owns and closes `frame`), or null to pass through. */
  process(frame: VideoFrame): VideoFrame | null {
    if (this.level === "off" || !this.setup()) return null;
    const gl = this.gl!;
    const canvas = this.canvas!;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (!w || !h) return null;
    try {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      if (this.frameNo++ % STATS_EVERY === 0) {
        // The first measurement applies at once; later ones ease in.
        this.measure(w, h);
        if (this.frameNo === 1) this.params = { ...this.target, wb: [...this.target.wb] as [number, number, number] };
      }
      this.ease();
      const p = this.params;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.enhance);
      const u = this.uniforms;
      gl.uniform1i(u.u_tex, 0);
      gl.uniform2f(u.u_texel, 1 / w, 1 / h);
      gl.uniform3f(u.u_wb, p.wb[0], p.wb[1], p.wb[2]);
      gl.uniform1f(u.u_gain, p.gain);
      gl.uniform1f(u.u_lift, p.lift);
      gl.uniform1f(u.u_denoise, p.denoise);
      gl.uniform1f(u.u_sharp, p.sharp);
      gl.uniform1f(u.u_vib, p.vib);
      gl.uniform1f(u.u_black, p.black);
      gl.uniform1f(u.u_contrast, p.contrast);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
    } catch {
      // Lost context or an unsupported frame format: stop trying, keep the camera working.
      this.broken = true;
      return null;
    }
  }

  destroy() {
    const gl = this.gl;
    if (gl) {
      gl.deleteTexture(this.tex);
      gl.deleteFramebuffer(this.statsFbo);
      gl.deleteProgram(this.enhance);
      gl.deleteProgram(this.stats);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
    this.canvas = null;
  }
}
