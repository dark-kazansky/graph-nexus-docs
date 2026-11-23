/**
 * Graph Nexus export recorders. Original code.
 *
 * Both recorders implement the subset of CanvasRenderingContext2D that the
 * chart renderer uses, so one `drawScene(ctx)` path produces PNG/JPEG (real
 * canvas), SVG and vector PDF:
 *
 *  - createSvgContext(w, h, measurer)  -> ctx with toSvg()
 *  - createPdfContext(w, h, measurer)  -> ctx with toPdf(): Promise<Uint8Array>
 *
 * Supported: paths (moveTo/lineTo/quadratic/bezier/arc/rect/closePath),
 * fill/stroke, line width and dashes, global alpha, linear gradients, text
 * (fillText with alignment), save/restore, translate/rotate, clip, drawImage.
 */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => Math.round(v * 100) / 100;

/* ---------------------------------------------------------------------------
 * Shared: 2D affine transform and arcs as cubic beziers
 * ------------------------------------------------------------------------- */

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Arc from a0 to a1 (clockwise when a1 > a0) as cubic segments: [[x1,y1,x2,y2,x,y], ...] plus start point. */
function arcToCubics(cx, cy, r, a0, a1) {
  const out = [];
  let sweep = a1 - a0;
  if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  let a = a0;
  for (let i = 0; i < n; i++) {
    const b = a + step;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    out.push([cx + r * (ca - k * sa), cy + r * (sa + k * ca), cx + r * (cb + k * sb), cy + r * (sb - k * cb), cx + r * cb, cy + r * sb]);
    a = b;
  }
  return { start: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], segments: out };
}

/** Base recorder: tracks state and builds a path of absolute, transformed commands. */
function createRecorder(measurer) {
  let path = [];
  let cur = [0, 0];
  let lineDash = [];
  const stack = [];
  const state = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineDashOffset: 0,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', matrix: IDENTITY.slice(),
  };
  const ctx = state;
  const pt = (x, y) => apply(state.matrix, x, y);
  Object.assign(ctx, {
    setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { state.matrix = typeof a === 'object' ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]; },
    translate(x, y) { state.matrix = multiply(state.matrix, [1, 0, 0, 1, x, y]); },
    rotate(t) { state.matrix = multiply(state.matrix, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]); },
    scale(x, y) { state.matrix = multiply(state.matrix, [x, 0, 0, y, 0, 0]); },
    save() { stack.push({ ...state, matrix: state.matrix.slice(), lineDash: lineDash.slice() }); ctx._onSave && ctx._onSave(); },
    restore() {
      const s = stack.pop();
      if (!s) return;
      const { lineDash: ld, ...rest } = s;
      Object.assign(state, rest);
      lineDash = ld;
      ctx._onRestore && ctx._onRestore();
    },
    setLineDash(d) { lineDash = (d || []).slice(); },
    getLineDash() { return lineDash.slice(); },
    beginPath() { path = []; },
    moveTo(x, y) { cur = pt(x, y); path.push(['M', ...cur]); },
    lineTo(x, y) { cur = pt(x, y); path.push(['L', ...cur]); },
    quadraticCurveTo(cx, cy, x, y) {
      // Elevate to cubic so both outputs share one curve type.
      const [qx, qy] = pt(cx, cy);
      const [ex, ey] = pt(x, y);
      const [sx, sy] = cur;
      path.push(['C', sx + (2 / 3) * (qx - sx), sy + (2 / 3) * (qy - sy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
      cur = [ex, ey];
    },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      const a = pt(x1, y1); const b = pt(x2, y2); const c = pt(x, y);
      path.push(['C', ...a, ...b, ...c]);
      cur = c;
    },
    closePath() { path.push(['Z']); },
    rect(x, y, w, h) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); },
    arc(x, y, r, a0, a1, ccw) {
      let end = a1;
      if (ccw && end > a0) end -= Math.PI * 2;
      if (!ccw && end < a0) end += Math.PI * 2;
      const { start, segments } = arcToCubics(x, y, r, a0, end);
      const s = pt(...start);
      path.push([path.length ? 'L' : 'M', ...s]);
      segments.forEach(seg => {
        const a = pt(seg[0], seg[1]); const b = pt(seg[2], seg[3]); const c = pt(seg[4], seg[5]);
        path.push(['C', ...a, ...b, ...c]);
        cur = c;
      });
    },
    measureText(text) { measurer.font = state.font; return measurer.measureText(text); },
    createLinearGradient(x0, y0, x1, y1) {
      const [ax, ay] = pt(x0, y0);
      const [bx, by] = pt(x1, y1);
      const grad = { gradient: true, x0: ax, y0: ay, x1: bx, y1: by, stops: [], addColorStop(o, c) { grad.stops.push([o, c]); } };
      return grad;
    },
  });
  return { ctx, state, getPath: () => path, getDash: () => lineDash, pt };
}

/** Normalises any CSS colour to [r, g, b, a] (0..255, 0..1) via the measurer context. */
function rgba(measurer, css) {
  measurer.fillStyle = '#000000';
  measurer.fillStyle = css;
  const v = measurer.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const m = v.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}

/** Image -> data URL (PNG) through a canvas; null when the image taints the canvas. */
function imageDataUrl(img, type = 'image/png') {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL(type, 0.92);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * SVG
 * ------------------------------------------------------------------------- */

export function createSvgContext(width, height, measurer) {
  const { ctx, state, getPath, getDash } = createRecorder(measurer);
  const parts = [];
  const defs = [];
  const warnings = [];
  let clipId = null;
  const clipStack = [];
  let idSeq = 0;
  const d = () => getPath().map(([op, ...v]) => op + v.map(num).join(' ')).join('');
  const paint = style => {
    if (style && style.gradient) {
      const id = `g${++idSeq}`;
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(style.x0)}" y1="${num(style.y0)}" x2="${num(style.x1)}" y2="${num(style.y1)}">${
        style.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${esc(c)}"/>`).join('')}</linearGradient>`);
      return `url(#${id})`;
    }
    return esc(style);
  };
  const common = () => `${state.globalAlpha < 1 ? ` opacity="${num(state.globalAlpha)}"` : ''}${clipId ? ` clip-path="url(#${clipId})"` : ''}`;
  ctx._onSave = () => clipStack.push(clipId);
  ctx._onRestore = () => { clipId = clipStack.pop() ?? null; };
  Object.assign(ctx, {
    clearRect() {},
    fillRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); },
    strokeRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke(); },
    fill() { parts.push(`<path d="${d()}" fill="${paint(state.fillStyle)}"${common()}/>`); },
    stroke() {
      const dash = getDash().length ? ` stroke-dasharray="${getDash().map(num).join(' ')}"` : '';
      parts.push(`<path d="${d()}" fill="none" stroke="${paint(state.strokeStyle)}" stroke-width="${num(state.lineWidth)}"${dash}${common()}/>`);
    },
    clip() {
      const id = `c${++idSeq}`;
      defs.push(`<clipPath id="${id}"><path d="${d()}"/></clipPath>`);
      clipId = id;
    },
    fillText(text, x, y) {
      const anchor = { center: 'middle', centre: 'middle', right: 'end', end: 'end' }[state.textAlign] || 'start';
      const baseline = { middle: 'central', top: 'hanging', bottom: 'text-after-edge' }[state.textBaseline] || 'auto';
      const m = state.matrix;
      const transform = m.every((v, i) => v === IDENTITY[i]) ? '' : ` transform="matrix(${m.map(num).join(' ')})"`;
      parts.push(`<text x="${num(x)}" y="${num(y)}" fill="${paint(state.fillStyle)}" style="font:${esc(state.font)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${transform}${common()}>${esc(text)}</text>`);
    },
    drawImage(img, x, y, w, h) {
      const url = img && img.src && img.src.startsWith('data:') ? img.src : img && imageDataUrl(img);
      if (!url) { warnings.push({ type: 'image', message: `Image could not be embedded (cross-origin): ${img && img.src}` }); return; }
      const [ax, ay] = apply(state.matrix, x, y);
      parts.push(`<image href="${esc(url)}" x="${num(ax)}" y="${num(ay)}" width="${num(w * state.matrix[0])}" height="${num(h * state.matrix[3])}" preserveAspectRatio="none"${common()}/>`);
    },
    toSvg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${
        defs.length ? `<defs>${defs.join('')}</defs>` : ''}${parts.join('')}</svg>`;
    },
    warnings,
  });
  return ctx;
}

/* ---------------------------------------------------------------------------
 * Vector PDF
 * ------------------------------------------------------------------------- */

/** String -> one byte per character (Latin-1). */
const latin1 = str => Uint8Array.from(str, c => c.charCodeAt(0) & 0xff);

/** WinAnsi-safe PDF string literal; characters outside Latin-1 become '?'. */
const pdfString = text => `(${String(text).replace(/[^\x20-\xff]/g, '?').replace(/([\\()])/g, '\\$1')})`;

export function createPdfContext(width, height, measurer) {
  const { ctx, state, getPath, getDash } = createRecorder(measurer);
  const ops = [];
  const alphas = new Map(); // alpha -> ExtGState name
  const images = []; // { name, img, w, h }
  const warnings = [];
  const f = v => num(v);
  // Page space is y-up; flip once so recorded (y-down) coordinates map directly.
  ops.push(`1 0 0 -1 0 ${height} cm`);
  const pathOps = () => getPath().map(([op, ...v]) => {
    if (op === 'M') return `${f(v[0])} ${f(v[1])} m`;
    if (op === 'L') return `${f(v[0])} ${f(v[1])} l`;
    if (op === 'C') return `${v.map(f).join(' ')} c`;
    return 'h';
  }).join('\n');
  const alphaOp = a => {
    const key = Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;
    if (!alphas.has(key)) alphas.set(key, `GS${alphas.size}`);
    return `/${alphas.get(key)} gs`;
  };
  /** Colour op; gradients fall back to their midpoint stop. */
  const colourOp = (style, stroke) => {
    let css = style;
    if (style && style.gradient) css = (style.stops[Math.floor(style.stops.length / 2)] || style.stops[0] || [0, '#000'])[1];
    const [r, g, b, a] = rgba(measurer, css);
    return { op: `${f(r / 255)} ${f(g / 255)} ${f(b / 255)} ${stroke ? 'RG' : 'rg'}`, a };
  };
  ctx._onSave = () => ops.push('q');
  ctx._onRestore = () => ops.push('Q');
  Object.assign(ctx, {
    clearRect() {},
    fillRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); },
    strokeRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke(); },
    fill() {
      if (!getPath().length) return;
      const { op, a } = colourOp(state.fillStyle, false);
      ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op}\n${pathOps()}\nf Q`);
    },
    stroke() {
      if (!getPath().length) return;
      const { op, a } = colourOp(state.strokeStyle, true);
      const dash = getDash().length ? `[${getDash().map(f).join(' ')}] 0 d` : '[] 0 d';
      ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op} ${f(state.lineWidth)} w ${dash} 1 J 1 j\n${pathOps()}\nS Q`);
    },
    clip() { ops.push(`${pathOps()}\nW n`); },
    fillText(text, x, y) {
      const size = parseFloat((state.font.match(/([\d.]+)px/) || [0, 10])[1]);
      const bold = /\bbold\b/.test(state.font);
      measurer.font = state.font;
      const w = measurer.measureText(text).width;
      let dx = 0;
      if (state.textAlign === 'center' || state.textAlign === 'centre') dx = -w / 2;
      else if (state.textAlign === 'right' || state.textAlign === 'end') dx = -w;
      let dy = 0;
      if (state.textBaseline === 'middle') dy = size * 0.35;
      else if (state.textBaseline === 'top' || state.textBaseline === 'hanging') dy = size * 0.8;
      else if (state.textBaseline === 'bottom') dy = -size * 0.2;
      const [px, py] = apply(state.matrix, x + dx, y + dy);
      const m = state.matrix;
      const { op, a } = colourOp(state.fillStyle, false);
      // Text matrix flips y back so glyphs are upright on the flipped page.
      ops.push(`q ${alphaOp(a * state.globalAlpha)} ${op} BT /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(m[0])} ${f(m[1])} ${f(-m[2])} ${f(-m[3])} ${f(px)} ${f(py)} Tm ${pdfString(text)} Tj ET Q`);
    },
    drawImage(img, x, y, w, h) {
      const name = `Im${images.length}`;
      images.push({ name, img });
      const [ax, ay] = apply(state.matrix, x, y);
      const sw = w * state.matrix[0];
      const sh = h * state.matrix[3];
      // Image space is y-up: place at the bottom-left and flip.
      ops.push(`q ${alphaOp(state.globalAlpha)} ${f(sw)} 0 0 ${f(-sh)} ${f(ax)} ${f(ay + sh)} cm /${name} Do Q`);
    },
    warnings,
    /** Assembles the PDF. Images are re-encoded as JPEG (DCTDecode). */
    async toPdf() {
      const enc = new TextEncoder();
      const imageObjs = [];
      for (const { name, img } of images) {
        const url = imageDataUrl(img, 'image/jpeg');
        if (!url) { warnings.push({ type: 'image', message: `Image could not be embedded (cross-origin): ${img && img.src}` }); continue; }
        const bytes = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
        imageObjs.push({ name, bytes, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      }
      const content = ops.filter(o => !imageObjs.length || !/\/Im\d+ Do/.test(o) || imageObjs.some(io => o.includes(`/${io.name} Do`))).join('\n');
      // Object numbering: 1 catalog, 2 pages, 3 page, 4 content, 5 F1, 6 F2, 7.. images
      const objects = [];
      objects.push(enc.encode('<< /Type /Catalog /Pages 2 0 R >>'));
      objects.push(enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
      const gs = [...alphas].map(([a, n]) => `/${n} << /Type /ExtGState /ca ${a} /CA ${a} >>`).join(' ');
      const xobj = imageObjs.map((io, i) => `/${io.name} ${7 + i} 0 R`).join(' ');
      objects.push(enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << ${gs} >> /XObject << ${xobj} >> >> >>`));
      // Content streams are WinAnsi (Latin-1) bytes, not UTF-8, so 'café' stays 'café'.
      const contentBytes = latin1(content);
      objects.push({ head: enc.encode(`<< /Length ${contentBytes.length} >>\nstream\n`), body: contentBytes });
      objects.push(enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
      objects.push(enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
      imageObjs.forEach(io => objects.push({
        head: enc.encode(`<< /Type /XObject /Subtype /Image /Width ${io.w} /Height ${io.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${io.bytes.length} >>\nstream\n`),
        body: io.bytes,
      }));
      const chunks = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
      let offset = chunks[0].length;
      const offsets = [];
      objects.forEach((obj, i) => {
        offsets.push(offset);
        const parts = obj.head
          ? [enc.encode(`${i + 1} 0 obj\n`), obj.head, obj.body, enc.encode('\nendstream\nendobj\n')]
          : [enc.encode(`${i + 1} 0 obj\n`), obj, enc.encode('\nendobj\n')];
        parts.forEach(p => { chunks.push(p); offset += p.length; });
      });
      const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
      chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
      const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let at = 0;
      chunks.forEach(c => { out.set(c, at); at += c.length; });
      return out;
    },
  });
  return ctx;
}
