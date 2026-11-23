/**
 * Graph Nexus WebGL layer. Original code.
 *
 * Sits under the 2D canvas and draws the bulk geometry — link lines and node
 * bodies (circles and boxes with an optional border, anti-aliased in the
 * fragment shader). Everything else (arrowheads, labels, glyphs, halos,
 * decorations) stays on the 2D canvas above it. Instance buffers are refilled
 * each frame, which is fine for tens of thousands of items.
 *
 * Instanced drawing (ANGLE_instanced_arrays): each disc / segment uploads one
 * 16-float record and a shared six-corner quad expands it on the GPU, instead of
 * six full vertices (102 / 36 floats). No extension: no GL layer (the chart
 * draws on the 2D canvas, as when WebGL is missing).
 *
 * Ordered mode (the 3D view): primitives draw in submission order instead of
 * halos / lines / discs passes, so a depth-sorted scene interleaves correctly.
 * One program handles both kinds, so that is a single draw call.
 */

// One program draws both primitives, so ordered mode (3D) is a single draw call in
// submission order. Per instance, 16 floats:
//   disc: a_a (cx, cy, hw, hh), a_b fill, a_c border, a_d (bw, box, alpha, 0)
//   line: a_a (x1, y1, x2, y2), a_b colour at start, a_c colour at end, a_d (width, 0, 0, 1)
// a_corner: (disc corner x, y; line t along 0..1, side -1 / 1), six per quad.
const VS = `
attribute vec4 a_corner; attribute vec4 a_a; attribute vec4 a_b; attribute vec4 a_c; attribute vec4 a_d;
uniform vec2 u_size;
varying vec2 v_local; varying vec2 v_half; varying vec4 v_fill; varying vec4 v_border; varying vec3 v_extra;
varying float v_line;
void main() {
  vec2 pos;
  if (a_d.w > 0.5) {
    vec2 d = a_a.zw - a_a.xy;
    float len = length(d);
    vec2 n = len > 0.0 ? vec2(-d.y, d.x) / len * (a_d.x / 2.0) : vec2(0.0);
    pos = mix(a_a.xy, a_a.zw, a_corner.z) + n * a_corner.w;
    v_fill = mix(a_b, a_c, a_corner.z);
    v_line = 1.0;
    v_local = vec2(0.0); v_half = vec2(0.0); v_border = vec4(0.0); v_extra = vec3(0.0);
  } else {
    vec2 grown = a_a.zw + 1.0;
    pos = a_a.xy + a_corner.xy * grown;
    v_local = a_corner.xy * grown; v_half = a_a.zw; v_fill = a_b; v_border = a_c; v_extra = a_d.xyz;
    v_line = 0.0;
  }
  gl_Position = vec4(pos / u_size * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform float u_shade; // 1: light round bodies like spheres (3D view)
varying vec2 v_local; varying vec2 v_half; varying vec4 v_fill; varying vec4 v_border; varying vec3 v_extra;
varying float v_line;
void main() {
  if (v_line > 0.5) { gl_FragColor = v_fill; return; }
  float outer = v_extra.y > 0.5
    ? max(abs(v_local.x) - v_half.x, abs(v_local.y) - v_half.y)
    : length(v_local) - v_half.x;
  float coverage = clamp(0.5 - outer, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  bool border = v_extra.x > 0.0 && outer > -v_extra.x;
  vec4 col = border ? v_border : v_fill;
  if (u_shade > 0.5 && v_extra.y < 0.5 && !border) {
    // Same look as the canvas path: top-left highlight, darker rim.
    vec2 q = v_local / max(v_half.x - v_extra.x, 1.0);
    float glow = 1.0 - smoothstep(0.0, 0.95, length(q - vec2(-0.35, -0.4)));
    float rim = smoothstep(0.6, 1.0, length(q));
    col.rgb = mix(col.rgb, vec3(1.0), glow * 0.5) * (1.0 - rim * 0.38);
  }
  gl_FragColor = vec4(col.rgb, col.a * coverage * v_extra.z);
}`;

function compile(gl, vs, fs) {
  const prog = gl.createProgram();
  [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  });
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

/** CSS colour -> [r, g, b, a] in 0..1, normalised through a 2D context and cached. */
const colourCache = new Map();
let probe = null;
export function parseColour(css) {
  if (css == null) return [0, 0, 0, 0];
  if (Array.isArray(css)) return css;
  if (colourCache.has(css)) return colourCache.get(css);
  if (!probe) probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000000';
  probe.fillStyle = css;
  const v = probe.fillStyle;
  let out;
  if (v[0] === '#') out = [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
  else {
    const m = v.match(/[\d.]+/g).map(Number);
    out = [m[0] / 255, m[1] / 255, m[2] / 255, m[3] ?? 1];
  }
  colourCache.set(css, out);
  return out;
}

/** A growable float buffer: `a` holds the data, `n` how many floats are in use. */
const stream = () => ({ a: new Float32Array(4096), n: 0 });
/** Ensures room for `k` more floats; returns the (possibly new) backing array. */
function reserve(s, k) {
  if (s.n + k > s.a.length) {
    const next = new Float32Array(Math.max(s.a.length * 2, s.n + k));
    next.set(s.a.subarray(0, s.n));
    s.a = next;
  }
  return s.a;
}
const used = s => s.a.subarray(0, s.n);
const NO_FILL = [0, 0, 0, 0];
// Two triangles per quad, in the order the old per-vertex path used: disc corner, line corner.
const CORNERS = new Float32Array([
  -1, -1, 0, 1, 1, -1, 0, -1, 1, 1, 1, -1,
  -1, -1, 0, 1, 1, 1, 1, -1, -1, 1, 1, 1,
]);
const STRIDE = 16;

/**
 * @returns {object|null} { canvas, begin(size, background), disc(..), line(..), flush(), destroy() }
 *   or null when WebGL (or instanced drawing) is unavailable.
 */
export function createGLLayer(container, overlay) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const inst = gl.getExtension('ANGLE_instanced_arrays');
  if (!inst) return null;
  let prog;
  try {
    prog = compile(gl, VS, FS);
  } catch {
    return null;
  }
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none' });
  container.insertBefore(canvas, overlay);
  Object.assign(overlay.style, { position: 'relative', zIndex: '1' });

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
  const buffer = gl.createBuffer();
  // Instance streams: grow-only Float32Arrays reused across frames (no per-frame garbage).
  // Ordered mode puts everything in `discs`, in submission order.
  const rings = stream(); // halos: drawn first, under links
  const discs = stream();
  const lines = stream();
  let size = { w: 1, h: 1 };
  let ordered = false;
  let shade = 0;
  const uSize = gl.getUniformLocation(prog, 'u_size');
  const uShade = gl.getUniformLocation(prog, 'u_shade');
  const aCorner = gl.getAttribLocation(prog, 'a_corner');
  const aInst = ['a_a', 'a_b', 'a_c', 'a_d'].map(name => gl.getAttribLocation(prog, name));

  /** Appends one instance record. */
  function put(out, a0, a1, a2, a3, b, c, d0, d1, d2, d3, alpha = 1) {
    const a = reserve(out, STRIDE);
    let i = out.n;
    a[i++] = a0; a[i++] = a1; a[i++] = a2; a[i++] = a3;
    a[i++] = b[0]; a[i++] = b[1]; a[i++] = b[2]; a[i++] = b[3] * alpha;
    a[i++] = c[0]; a[i++] = c[1]; a[i++] = c[2]; a[i++] = c[3] * alpha;
    a[i++] = d0; a[i++] = d1; a[i++] = d2; a[i++] = d3;
    out.n = i;
  }
  /** Uploads a stream and draws all its instances in order. */
  function draw(s) {
    if (!s.n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, used(s), gl.STREAM_DRAW);
    aInst.forEach((loc, k) => { if (loc >= 0) gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, k * 16); });
    inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, s.n / STRIDE);
  }

  return {
    canvas,
    gl,
    /** `inOrder`: draw primitives in submission order (3D depth sort) rather than in passes. */
    begin(viewSize, background, inOrder = false, sphereShading = false) {
      size = viewSize;
      ordered = inOrder;
      shade = sphereShading ? 1 : 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(viewSize.w * dpr);
      const h = Math.round(viewSize.h * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      const bg = parseColour(background || '#ffffff');
      gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      rings.n = 0;
      discs.n = 0;
      lines.n = 0;
    },
    /** A node body: centre, half extents (px), box?, fill, border colour, border width (px), alpha. */
    disc(x, y, hw, hh, box, fill, border, bw, alpha = 1) {
      put(discs, x, y, hw + bw, hh + bw, parseColour(fill), parseColour(border || fill), bw, box ? 1 : 0, alpha, 0);
    },
    /** A halo ring centred at (x, y): radius to the ring's centre line, width w (px). */
    ring(x, y, radius, w, colour, alpha = 1) {
      const half = radius + w / 2;
      // Ordered mode keeps halos in the one stream so they stay in sequence.
      put(ordered ? discs : rings, x, y, half, half, NO_FILL, parseColour(colour), w, 0, alpha, 0);
    },
    /** A straight segment of width `w` px, colour c1 at the start fading to c2 at the end. */
    line(x1, y1, x2, y2, w, c1, c2, alpha = 1) {
      put(ordered ? discs : lines, x1, y1, x2, y2, parseColour(c1), parseColour(c2 || c1), w, 0, 0, 1, alpha);
    },
    flush() {
      gl.useProgram(prog);
      gl.uniform1f(uShade, shade);
      gl.uniform2f(uSize, size.w, size.h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 4, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(aCorner, 0);
      aInst.forEach(loc => { if (loc >= 0) { gl.enableVertexAttribArray(loc); inst.vertexAttribDivisorANGLE(loc, 1); } });
      // Ordered: everything is in `discs`, one call. Otherwise halos, then links, then bodies.
      draw(rings);
      draw(lines);
      draw(discs);
    },
    /** Counts from the last frame, for tests (ordered mode counts links among discs). */
    stats: () => ({ rings: rings.n / STRIDE, discs: discs.n / STRIDE, segments: lines.n / STRIDE }),
    destroyed: false,
    destroy() {
      this.destroyed = true;
      canvas.remove();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}
