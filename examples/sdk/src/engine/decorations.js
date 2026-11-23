/**
 * Graph Nexus drawing helpers: donuts, bubbles, glyphs, label objects, link
 * end labels, chart background (gradient, bands), watermark, logo, navigation
 * controls and the overview window. Original code written against the
 * documented properties; not derived from the vendor build.
 *
 * Every helper draws into a CanvasRenderingContext2D-like `g` (the screen,
 * an offscreen canvas, or the SVG/PDF recorders in exporters.js).
 */

export const COMPASS = { n: [0, -1], ne: [0.7071, -0.7071], e: [1, 0], se: [0.7071, 0.7071], s: [0, 1], sw: [-0.7071, 0.7071], w: [-1, 0], nw: [-0.7071, -0.7071] };
const DONUT_COLOURS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'];
const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

/* ---------------------------------------------------------------------------
 * Box model helpers
 * ------------------------------------------------------------------------- */

/** Margin / padding: number | 'a b c d' | [a,b,c,d] | {top,right,bottom,left} -> {top,right,bottom,left}. */
export function boxSpacing(value, fallback = 0) {
  if (value == null) return { top: fallback, right: fallback, bottom: fallback, left: fallback };
  if (typeof value === 'number') return { top: value, right: value, bottom: value, left: value };
  const list = typeof value === 'string' ? value.trim().split(/\s+/).map(Number) : Array.isArray(value) ? value : null;
  if (list) {
    // CSS order: 1 = all, 2 = vertical horizontal, 3 = top horizontal bottom, 4 = t r b l.
    const [a, b = a, c = a, d = b] = list.map(v => v ?? 0);
    return { top: a, right: b, bottom: c, left: d };
  }
  return { top: value.top ?? fallback, right: value.right ?? fallback, bottom: value.bottom ?? fallback, left: value.left ?? fallback };
}

/** borderRadius: number | 'tl tr br bl' | [..] | {topLeft,..} -> [tl, tr, br, bl]. */
export function cornerRadii(value) {
  if (value == null) return [0, 0, 0, 0];
  if (typeof value === 'number') return [value, value, value, value];
  const list = typeof value === 'string' ? value.trim().split(/\s+/).map(Number) : Array.isArray(value) ? value : null;
  if (list) {
    const [a, b = a, c = a, d = b] = list.map(v => v ?? 0);
    return [a, b, c, d];
  }
  return [value.topLeft || 0, value.topRight || 0, value.bottomRight || 0, value.bottomLeft || 0];
}

/** Adds a rounded-rectangle subpath (radii clamped to half the side). */
export function roundRectPath(g, x, y, w, h, radii = [0, 0, 0, 0]) {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map(r => Math.max(0, Math.min(r, max)));
  const k = 0.5523; // cubic-bezier quarter-circle constant
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y);
  if (tr) g.bezierCurveTo(x + w - tr + tr * k, y, x + w, y + tr - tr * k, x + w, y + tr);
  g.lineTo(x + w, y + h - br);
  if (br) g.bezierCurveTo(x + w, y + h - br + br * k, x + w - br + br * k, y + h, x + w - br, y + h);
  g.lineTo(x + bl, y + h);
  if (bl) g.bezierCurveTo(x + bl - bl * k, y + h, x, y + h - bl + bl * k, x, y + h - bl);
  g.lineTo(x, y + tl);
  if (tl) g.bezierCurveTo(x, y + tl - tl * k, x + tl - tl * k, y, x + tl, y);
  g.closePath();
}

export function truncate(text, opts) {
  const max = opts && opts.maxLength;
  if (!max || typeof text !== 'string' || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

const font = (px, family, bold) => `${bold ? 'bold ' : ''}${px}px ${family || 'sans-serif'}`;

/* ---------------------------------------------------------------------------
 * Donut
 * ------------------------------------------------------------------------- */

/** Segmented ring around a circle node of screen radius `r`; `scale` = world -> px. */
export function drawDonut(g, donut, p, r, scale) {
  const values = asList(donut.v).filter(v => v > 0);
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  const width = (donut.w ?? 10) * scale;
  const gap = (donut.bw ?? 2) * scale;
  const ringR = r + gap + width / 2;
  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    const span = (v / total) * Math.PI * 2;
    g.beginPath();
    g.arc(p.x, p.y, ringR, a, a + span);
    g.strokeStyle = (donut.c && donut.c[i]) || DONUT_COLOURS[i % DONUT_COLOURS.length];
    g.lineWidth = width;
    g.stroke();
    a += span;
  });
  // Separators between segments and the gap ring, in the border colour.
  if (gap > 0) {
    g.strokeStyle = donut.b || '#ffffff';
    g.lineWidth = gap;
    g.beginPath();
    g.arc(p.x, p.y, r + gap / 2, 0, Math.PI * 2);
    g.stroke();
    if (values.length > 1) {
      let s = -Math.PI / 2;
      values.forEach(v => {
        g.beginPath();
        g.moveTo(p.x + Math.cos(s) * r, p.y + Math.sin(s) * r);
        g.lineTo(p.x + Math.cos(s) * (r + gap + width), p.y + Math.sin(s) * (r + gap + width));
        g.stroke();
        s += (v / total) * Math.PI * 2;
      });
    }
  }
  return gap + width;
}

/* ---------------------------------------------------------------------------
 * Glyphs
 * ------------------------------------------------------------------------- */

/** Screen position for glyph `i` on a node: compass point, degrees clockwise from north, or default ne/se/sw/nw. */
export function glyphPosition(glyph, i, p, r, scale) {
  if (typeof glyph.p === 'number') {
    const a = ((glyph.p - 90) * Math.PI) / 180;
    const dist = glyph.r != null ? glyph.r * scale : r;
    return { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
  }
  const dir = COMPASS[glyph.p] || [COMPASS.ne, COMPASS.se, COMPASS.sw, COMPASS.nw][i % 4];
  return { x: p.x + dir[0] * r, y: p.y + dir[1] * r };
}

/**
 * One glyph centred at (x, y) with radius gr. Supports fill/border colours,
 * text (4 chars, or 25 when wide), font icons, images, and pulsing animation.
 */
export function drawGlyph(g, glyph, x, y, gr, env) {
  if (!glyph) return;
  let radius = gr;
  if (glyph.a) { radius *= 1 + 0.15 * Math.sin((env.now || 0) / 180); if (env.onAnimated) env.onAnimated(); }
  const text = glyph.t != null ? String(glyph.t).slice(0, glyph.w ? 25 : 4) : '';
  const fb = glyph.fb !== false;
  const fontPx = radius * (text.length > 2 && !glyph.w ? 0.9 : 1.2);
  const family = glyph.ff || env.fontFamily;
  const img = glyph.u ? env.imageFor(glyph.u) : null;
  const iconOnly = !glyph.c && (glyph.u || glyph.fi);
  let half = radius;
  if (glyph.w && text) {
    g.font = font(fontPx, family, fb);
    half = Math.max(radius, g.measureText(text).width / 2 + radius * 0.6);
  }
  if (!iconOnly) {
    g.beginPath();
    if (half > radius) roundRectPath(g, x - half, y - radius, half * 2, radius * 2, [radius, radius, radius, radius]);
    else g.arc(x, y, radius, 0, Math.PI * 2);
    g.fillStyle = glyph.c || '#e53935';
    g.fill();
    if (glyph.b) { g.strokeStyle = glyph.b; g.lineWidth = Math.max(1, radius * 0.15); g.stroke(); }
  }
  const inner = iconOnly ? radius : radius * 0.7;
  if (img && typeof g.drawImage === 'function') {
    g.drawImage(img, x - inner, y - inner, inner * 2, inner * 2);
  } else if (glyph.fi && glyph.fi.t != null) {
    const ch = typeof glyph.fi.t === 'number' ? String.fromCodePoint(glyph.fi.t) : String(glyph.fi.t);
    g.fillStyle = glyph.fi.c || (iconOnly ? '#000' : '#fff');
    g.font = `${inner * 1.6}px ${glyph.fi.ff || env.iconFontFamily || 'sans-serif'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, x, y);
  } else if (text) {
    g.fillStyle = glyph.fc || '#ffffff';
    g.font = font(fontPx, family, fb);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }
}

/* ---------------------------------------------------------------------------
 * Bubbles
 * ------------------------------------------------------------------------- */

/** Speech bubble attached at anchor (x, y) pointing toward `p` ('ne' | 'se' | 'sw' | 'nw'). */
export function drawBubble(g, bubble, ax, ay, scale, env) {
  if (!bubble || bubble.t == null) return;
  const fs = (bubble.fs || 14) * scale;
  if (fs < 2) return;
  const text = String(bubble.t);
  g.font = font(fs, bubble.ff || env.fontFamily, bubble.fb);
  const pad = fs * 0.5;
  const glyphW = bubble.g ? fs * 1.2 : 0;
  const w = g.measureText(text).width + pad * 2 + glyphW;
  const h = fs * 1.6;
  const dir = bubble.p || 'ne';
  const right = dir === 'ne' || dir === 'se';
  const up = dir === 'ne' || dir === 'nw';
  const tail = fs * 0.8;
  const bx = right ? ax + tail * 0.3 : ax - tail * 0.3 - w;
  const by = up ? ay - tail - h : ay + tail;
  g.beginPath();
  roundRectPath(g, bx, by, w, h, [h / 3, h / 3, h / 3, h / 3]);
  g.fillStyle = bubble.c || '#ffffff';
  g.fill();
  g.strokeStyle = bubble.b || '#9e9e9e';
  g.lineWidth = Math.max(1, scale);
  g.stroke();
  // Tail from the box edge to the anchor.
  const tx = right ? bx + h / 3 : bx + w - h / 3;
  const ty = up ? by + h : by;
  g.beginPath();
  g.moveTo(tx - tail * 0.3, ty);
  g.lineTo(ax, ay);
  g.lineTo(tx + tail * 0.3, ty);
  g.fillStyle = bubble.c || '#ffffff';
  g.fill();
  g.stroke();
  if (bubble.g) drawGlyph(g, bubble.g, bx + pad + glyphW / 2 - fs * 0.1, by + h / 2, fs * 0.5, env);
  g.fillStyle = bubble.fc || '#000000';
  g.font = font(fs, bubble.ff || env.fontFamily, bubble.fb);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, bx + pad + glyphW, by + h / 2);
}

/* ---------------------------------------------------------------------------
 * Node label objects (t: NodeLabel | NodeLabel[])
 * ------------------------------------------------------------------------- */

/** Text lines for a label: '\n' breaks always; textWrap 'normal' wraps on spaces at maxWidth. */
function labelLines(g, text, maxWidth, wrap) {
  const hard = String(text).split(/\r\n|\r|\n/);
  if (wrap !== 'normal' || !maxWidth) return hard;
  const out = [];
  hard.forEach(line => {
    let cur = '';
    line.split(' ').forEach(word => {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && g.measureText(next).width > maxWidth) { out.push(cur); cur = word; } else cur = next;
    });
    out.push(cur);
  });
  return out;
}

/**
 * Measures one label object at `scale` (world -> px). Returns the content box
 * size and the drawing closure.
 */
function measureLabel(g, label, node, scale, env, nodeW, nodeH) {
  const fsWorld = label.fs === 'auto' ? null : label.fs ?? node.fs ?? 14;
  const family = label.ff || node.ff || env.fontFamily;
  const bold = label.fb ?? node.fb;
  // Documented default padding for labels with content: '2 2 0 2'.
  const pad = label.padding == null && (label.fi || label.t != null) ? { top: 2, right: 2, bottom: 0, left: 2 } : boxSpacing(label.padding, 0);
  const margin = boxSpacing(label.margin, 0);
  const maxW = label.maxWidth != null ? label.maxWidth : null;
  let fs;
  let lines;
  if (label.fi) {
    fs = (fsWorld ?? Math.min(nodeW, nodeH) * 0.5) * scale;
    lines = [typeof label.fi.t === 'number' ? String.fromCodePoint(label.fi.t) : String(label.fi.t)];
  } else {
    const text = env.truncate(String(label.t ?? ''));
    if (fsWorld == null) {
      // 'auto': largest font that fits maxWidth/maxHeight (or the node).
      const boxW = (maxW ?? nodeW * 0.8) * scale;
      const boxH = (label.maxHeight ?? nodeH * 0.6) * scale;
      g.font = font(100, family, bold);
      const widest = Math.max(...text.split(/\n/).map(l => g.measureText(l).width / 100), 0.01);
      const count = text.split(/\n/).length;
      fs = Math.max(1, Math.min(boxW / widest, boxH / (count * 1.2)));
    } else fs = fsWorld * scale;
    g.font = font(fs, family, bold);
    lines = labelLines(g, text, maxW != null ? maxW * scale : label.minWidth && label.minWidth !== 'stretch' ? label.minWidth * scale : null, label.textWrap);
  }
  if (!label.fi) g.font = font(fs, family, bold);
  else g.font = `${fs}px ${label.fi.ff || env.iconFontFamily || 'sans-serif'}`;
  const textW = Math.max(...lines.map(l => g.measureText(l).width), 0);
  const textH = label.fi ? fs : lines.length * fs * 1.2;
  let w = textW + (pad.left + pad.right) * scale;
  let h = textH + (pad.top + pad.bottom) * scale;
  if (label.minWidth === 'stretch') w = Math.max(w, nodeW * scale);
  else if (label.minWidth) w = Math.max(w, label.minWidth * scale);
  if (label.minHeight === 'stretch') h = Math.max(h, nodeH * scale);
  else if (label.minHeight) h = Math.max(h, label.minHeight * scale);
  if (maxW != null) w = Math.min(w, maxW * scale);
  if (label.maxHeight != null) h = Math.min(h, label.maxHeight * scale);

  const draw = (x, y) => {
    const fbc = label.fbc ?? node.fbc;
    const bw = label.b ? (label.bw ?? 4) * scale : 0;
    if (fbc || label.b) {
      g.beginPath();
      roundRectPath(g, x, y, w, h, cornerRadii(label.borderRadius).map(r => r * scale));
      if (fbc) { g.fillStyle = fbc; g.fill(); }
      if (label.b) { g.strokeStyle = label.b; g.lineWidth = bw; g.stroke(); }
    }
    const align = (label.textAlignment && label.textAlignment.horizontal) || 'centre';
    const valign = (label.textAlignment && label.textAlignment.vertical) || 'middle';
    const innerX = x + pad.left * scale;
    const innerW = w - (pad.left + pad.right) * scale;
    const innerY = y + pad.top * scale;
    const innerH = h - (pad.top + pad.bottom) * scale;
    let ty = valign === 'top' ? innerY : valign === 'bottom' ? innerY + innerH - textH : innerY + (innerH - textH) / 2;
    ty += (env.labelOffset || 0) * scale;
    g.fillStyle = label.fi ? label.fi.c || label.fc || node.fc || '#000' : label.fc || node.fc || '#000';
    g.textBaseline = 'middle';
    g.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
    const tx = align === 'left' ? innerX : align === 'right' ? innerX + innerW : innerX + innerW / 2;
    if (label.fi) g.font = `${fs}px ${label.fi.ff || env.iconFontFamily || 'sans-serif'}`;
    else g.font = font(fs, family, bold);
    const lineH = label.fi ? fs : fs * 1.2;
    lines.forEach((line, i) => g.fillText(line, tx, ty + (i + 0.5) * lineH));
  };
  return { w, h, margin, draw, fs };
}

/**
 * Inside labels in rows. 'inherit' joins the previous label's row; a set
 * vertical ('top', 'bottom', 'middle', a number) joins the row with that same
 * vertical; no vertical starts a new row.
 */
function insideRows(entries) {
  const rows = [];
  const byVertical = new Map();
  let last = null;
  entries.forEach(e => {
    const v = e.label.position && e.label.position.vertical;
    let row;
    if (v === 'inherit' && last) row = last;
    else if (v != null && v !== 'inherit' && byVertical.has(v)) row = byVertical.get(v);
    else {
      row = { v: v === 'inherit' ? undefined : v, items: [] };
      rows.push(row);
      if (row.v != null) byVertical.set(row.v, row);
    }
    row.items.push(e);
    last = row;
  });
  return rows;
}

const outerW = (m, scale) => m.w + (m.margin.left + m.margin.right) * scale;
const outerH = (m, scale) => m.h + (m.margin.top + m.margin.bottom) * scale;
const rowHeight = (row, scale) => Math.max(0, ...row.items.map(e => outerH(e.m, scale)));

/**
 * Places inside labels in a W x H px box (origin top-left). Rows anchored
 * 'top' / 'bottom' / 'middle' / at a number sit there; rows without a vertical
 * flow below the previous label, and the ones before any anchored row form a
 * block centred in the node. Within a row, a label with a horizontal starts a
 * segment anchored 'left' / 'right' / 'centre' (default) / at a number, and the
 * labels after it follow inline. Returns [{ e, x, y }].
 */
function placeInside(entries, W, H, scale) {
  const out = [];
  const placeRow = (row, top) => {
    const height = rowHeight(row, scale);
    const segments = [];
    row.items.forEach((e, i) => {
      const h = e.label.position && e.label.position.horizontal;
      if (i === 0 || h != null) segments.push({ h, items: [] });
      segments[segments.length - 1].items.push(e);
    });
    let bottom = top + height;
    segments.forEach(seg => {
      const width = seg.items.reduce((sum, e) => sum + outerW(e.m, scale), 0);
      let x = seg.h === 'left' ? 0 : seg.h === 'right' ? W - width : typeof seg.h === 'number' ? seg.h * scale : (W - width) / 2;
      seg.items.forEach(e => {
        const { m } = e;
        const mg = m.margin;
        let y;
        if (row.v === 'bottom') y = top + height - mg.bottom * scale - m.h;
        else if (row.v === 'top' || typeof row.v === 'number') y = top + mg.top * scale;
        else y = top + (height - m.h) / 2 + ((mg.top - mg.bottom) * scale) / 2;
        out.push({ e, x: x + mg.left * scale, y });
        x += outerW(m, scale);
        bottom = y + m.h + mg.bottom * scale; // the next flow row goes below the last label
      });
    });
    return bottom;
  };
  const lead = [];
  let cursor = null;
  insideRows(entries).forEach(row => {
    const { v } = row;
    if (v === 'top') cursor = placeRow(row, 0);
    else if (v === 'bottom') placeRow(row, H - rowHeight(row, scale));
    else if (v === 'middle') cursor = placeRow(row, (H - rowHeight(row, scale)) / 2);
    else if (typeof v === 'number') cursor = placeRow(row, v * scale);
    else if (cursor != null) cursor = placeRow(row, cursor);
    else lead.push(row);
  });
  let top = (H - lead.reduce((sum, row) => sum + rowHeight(row, scale), 0)) / 2;
  lead.forEach(row => { placeRow(row, top); top += rowHeight(row, scale); });
  return out;
}

/** World-unit size of a node's inside labels, for `w` / `h: 'auto'`. */
export function labelsSize(g, node, env) {
  const labels = asList(node.t).map(l => (typeof l === 'string' ? { t: l } : l)).filter(l => l && typeof l.position !== 'string');
  const entries = labels.map(l => ({ label: l, m: measureLabel(g, { ...l, fs: l.fs === 'auto' ? 14 : l.fs }, node, 1, env, 56, 56) }));
  // Rows at a fixed number are absolute and do not grow the node.
  const rows = insideRows(entries).filter(row => typeof row.v !== 'number');
  const w = Math.max(0, ...rows.map(row => row.items.reduce((sum, e) => sum + outerW(e.m, 1), 0)));
  const h = rows.reduce((sum, row) => sum + rowHeight(row, 1), 0);
  return { w: Math.max(node.minWidth ?? 56, w + 8), h: Math.max(node.minHeight ?? 56, h + 8) };
}

/**
 * Draws a node's label objects: inside labels in rows (see placeInside),
 * compass positions outside the node edge. `edgePad` (screen px) is the room
 * outside the body that the border takes, so outside labels start beyond it.
 * Returns each drawn label's screen box as { index, x, y, w, h } (index into
 * node.t) for hit testing.
 */
export function drawLabelObjects(g, node, p, half, scale, env, edgePad = 0) {
  const nodeW = (half.w * 2) / scale;
  const nodeH = (half.h * 2) / scale;
  const measured = asList(node.t)
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => label && typeof label === 'object')
    .map(e => ({ ...e, m: measureLabel(g, e.label, node, scale, env, nodeW, nodeH) }));
  const inside = measured.filter(({ label }) => typeof label.position !== 'string');
  const outside = measured.filter(({ label }) => typeof label.position === 'string');
  // Empty labels (bars, backgrounds) have no font size to be too small.
  const readable = ({ label, m }) => !(label.t != null || label.fi) || m.fs >= env.minLabelPx;
  const boxes = [];
  const draw = (e, x, y) => { e.m.draw(x, y); boxes.push({ index: e.index, x, y, w: e.m.w, h: e.m.h }); };

  placeInside(inside, half.w * 2, half.h * 2, scale)
    .sort((a, b) => a.e.index - b.e.index) // later labels draw on top
    .forEach(({ e, x, y }) => { if (readable(e)) draw(e, p.x - half.w + x, p.y - half.h + y); });

  // Outside: stack outward from the named edge.
  const offsets = {};
  outside.forEach(e => {
    const { label, m } = e;
    if (!readable(e)) return;
    const dir = COMPASS[label.position] || COMPASS.s;
    const key = label.position;
    const extra = offsets[key] || 0;
    const gapX = dir[0] * (m.margin.left + m.margin.right) * scale;
    const gapY = dir[1] * (m.margin.top + m.margin.bottom) * scale;
    let x = p.x + dir[0] * (half.w + edgePad) + gapX - m.w / 2 + (dir[0] * m.w) / 2;
    let y = p.y + dir[1] * (half.h + edgePad) + gapY - m.h / 2 + (dir[1] * m.h) / 2;
    if (dir[0] === 0) y += dir[1] * extra; else x += dir[0] * extra;
    draw(e, x, y);
    offsets[key] = extra + (dir[0] === 0 ? m.h : m.w);
  });
  return boxes;
}

/* ---------------------------------------------------------------------------
 * Link labels
 * ------------------------------------------------------------------------- */

/** A label box centred at (x, y); `base` supplies inherited fc / fbc / fs / ff / fb. */
export function drawTextBox(g, text, x, y, style, scale, env, angle = 0) {
  const str = env.truncate(String(text));
  const fs = (style.fs || 14) * scale;
  if (!str || fs < env.minLabelPx) return;
  g.font = font(fs, style.ff || env.fontFamily, style.fb);
  const lines = str.split(/\r\n|\r|\n/);
  const w = Math.max(...lines.map(l => g.measureText(l).width));
  const h = lines.length * fs * 1.2;
  const rotate = angle && typeof g.rotate === 'function';
  if (rotate) { g.save(); g.translate(x, y); g.rotate(angle); x = 0; y = 0; }
  g.fillStyle = style.fbc || 'rgba(255,255,255,0.85)';
  g.fillRect(x - w / 2 - 2, y - h / 2, w + 4, h);
  g.fillStyle = style.fc || '#333';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => g.fillText(line, x, y - h / 2 + (i + 0.5) * fs * 1.2));
  if (rotate) g.restore();
}

/* ---------------------------------------------------------------------------
 * Chart background, watermark, logo
 * ------------------------------------------------------------------------- */

export function drawBackground(g, size, options) {
  const stops = options.gradient && asList(options.gradient.stops);
  if (stops && stops.length) {
    const grad = typeof g.createLinearGradient === 'function' ? g.createLinearGradient(0, 0, 0, size.h) : null;
    if (grad) {
      stops.forEach(s => grad.addColorStop(Math.min(1, Math.max(0, s.r)), s.c));
      g.fillStyle = grad;
    } else g.fillStyle = stops[0].c;
  } else g.fillStyle = options.backColour || options.backgroundColour || '#ffffff';
  g.fillRect(0, 0, size.w, size.h);
}

/** Vertical bands in world coordinates, with labels at the top and/or bottom. */
export function drawBands(g, size, options, worldToScreenX, scale, env) {
  const config = options.bands;
  if (!config || !config.bands) return;
  config.bands.forEach((band, i) => {
    const w = (band.w ?? 100) * scale;
    const x = worldToScreenX(band.x ?? 0) - w / 2;
    g.fillStyle = band.c || (i % 2 ? '#f0f0f0' : '#e6e6e6');
    g.fillRect(x, 0, w, size.h);
    if (!band.t) return;
    let fs = band.fs ?? 20;
    g.font = font(fs, band.ff || env.fontFamily, band.fb);
    const tw = g.measureText(band.t).width;
    if (tw > w * 0.9) { fs *= (w * 0.9) / tw; g.font = font(fs, band.ff || env.fontFamily, band.fb); }
    g.fillStyle = band.fc || '#bdbdbd';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (config.top !== false) g.fillText(band.t, x + w / 2, fs);
    if (config.bottom) g.fillText(band.t, x + w / 2, size.h - fs);
  });
}

export function drawWatermark(g, size, wm, env) {
  if (!wm || (!wm.t && !wm.u)) return;
  const valign = wm.a || 'centre';
  if (wm.u) {
    const img = env.imageFor(wm.u);
    if (img && typeof g.drawImage === 'function') {
      const s = Math.min(1, (size.w * 0.8) / img.naturalWidth, (size.h * 0.8) / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const y = valign === 'top' ? 10 : valign === 'bottom' ? size.h - h - 10 : (size.h - h) / 2;
      g.drawImage(img, (size.w - w) / 2, y, w, h);
    }
  }
  if (wm.t) {
    let fs = wm.fs ?? 80;
    g.font = font(fs, wm.ff || env.fontFamily, wm.fb);
    const tw = g.measureText(wm.t).width;
    if (tw > size.w * 0.9) { fs *= (size.w * 0.9) / tw; g.font = font(fs, wm.ff || env.fontFamily, wm.fb); }
    const y = valign === 'top' ? fs : valign === 'bottom' ? size.h - fs : size.h / 2;
    if (wm.fbc) {
      const w = g.measureText(wm.t).width;
      g.fillStyle = wm.fbc;
      g.fillRect((size.w - w) / 2 - 8, y - fs * 0.6, w + 16, fs * 1.2);
    }
    g.fillStyle = wm.fc || 'rgba(0,0,0,0.12)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(wm.t, size.w / 2, y);
  }
}

function corner(size, p, w, h, x = 0, y = 0, margin = 10) {
  const right = p === 'ne' || p === 'se';
  const bottom = p === 'se' || p === 'sw';
  return { x: (right ? size.w - w - margin : margin) + x, y: (bottom ? size.h - h - margin : margin) + y };
}

export function drawLogo(g, size, logo, env) {
  if (!logo || !logo.u) return;
  const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  // Retina: prefer path@2x.ext when it loads.
  const hi = ratio > 1 ? env.imageFor(logo.u.replace(/(\.\w+)$/, '@2x$1'), true) : null;
  const img = hi || env.imageFor(logo.u);
  if (!img || typeof g.drawImage !== 'function') return;
  const w = img.naturalWidth / (hi ? 2 : 1);
  const h = img.naturalHeight / (hi ? 2 : 1);
  const at = corner(size, logo.p || 'ne', w, h, logo.x, logo.y);
  g.drawImage(img, at.x, at.y, w, h);
}

/* ---------------------------------------------------------------------------
 * Navigation controls and overview window
 * ------------------------------------------------------------------------- */

const theme = (options) => {
  const dark = options.controlTheme === 'dark';
  return {
    bg: dark ? 'rgba(48,48,48,0.9)' : 'rgba(255,255,255,0.9)',
    fg: options.controlColour || (dark ? '#e0e0e0' : '#455a64'),
    border: dark ? '#616161' : '#cfd8dc',
  };
};

/** Button rectangles for the navigation controls (screen px). */
export function navigationLayout(size, options) {
  const nav = options.navigation || {};
  if (nav.shown === false) return [];
  const s = 26;
  const ids = ['up', 'left', 'right', 'down', 'in', 'out', 'fit'];
  const w = s * 3;
  const h = s * 3 + 8 + s * 3;
  const at = corner(size, nav.p || 'nw', w, h, nav.x, nav.y);
  const rects = {
    up: [at.x + s, at.y], left: [at.x, at.y + s], right: [at.x + 2 * s, at.y + s], down: [at.x + s, at.y + 2 * s],
    in: [at.x + s, at.y + 3 * s + 8], out: [at.x + s, at.y + 4 * s + 8], fit: [at.x + s, at.y + 5 * s + 8],
  };
  return ids.map(id => ({ id, x: rects[id][0], y: rects[id][1], w: s, h: s }));
}

export function drawNavigation(g, size, options) {
  const buttons = navigationLayout(size, options);
  if (!buttons.length) return;
  const t = theme(options);
  const glyph = { up: '▲', down: '▼', left: '◀', right: '▶', in: '+', out: '−', fit: '⤢' };
  buttons.forEach(b => {
    g.beginPath();
    roundRectPath(g, b.x + 1, b.y + 1, b.w - 2, b.h - 2, [5, 5, 5, 5]);
    g.fillStyle = t.bg;
    g.fill();
    g.strokeStyle = t.border;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = t.fg;
    g.font = `${b.w * 0.5}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph[b.id], b.x + b.w / 2, b.y + b.h / 2 + 1);
  });
}

export const hitButton = (buttons, x, y) => buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;

/** Overview window rect (or its collapsed icon). */
export function overviewLayout(size, options, open) {
  const ov = options.overview || {};
  if (ov.icon === false && !open) return null;
  const s = open ? ov.size ?? 100 : 22;
  const at = corner(size, ov.p || 'se', s, s);
  return { x: at.x, y: at.y, w: s, h: s, open };
}

/**
 * Draws the overview: a miniature of every node plus a rectangle for the
 * current view. `world` is { minX, minY, maxX, maxY }; `viewRect` the visible
 * world rectangle.
 */
export function drawOverview(g, size, options, open, world, viewRect, points) {
  const box = overviewLayout(size, options, open);
  if (!box) return null;
  const ov = options.overview || {};
  const t = theme(options);
  g.beginPath();
  roundRectPath(g, box.x, box.y, box.w, box.h, [4, 4, 4, 4]);
  g.fillStyle = ov.backColour || options.backColour || '#ffffff';
  g.fill();
  g.strokeStyle = ov.borderColour || t.border;
  g.lineWidth = 1;
  g.stroke();
  if (!open) {
    g.fillStyle = t.fg;
    g.font = '13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('▣', box.x + box.w / 2, box.y + box.h / 2 + 1);
    return box;
  }
  const pad = 6;
  const ww = Math.max(world.maxX - world.minX, viewRect.maxX - viewRect.minX, 1);
  const wh = Math.max(world.maxY - world.minY, viewRect.maxY - viewRect.minY, 1);
  const minX = Math.min(world.minX, viewRect.minX);
  const minY = Math.min(world.minY, viewRect.minY);
  const s = Math.min((box.w - pad * 2) / ww, (box.h - pad * 2) / wh);
  const toX = x => box.x + pad + (x - minX) * s;
  const toY = y => box.y + pad + (y - minY) * s;
  points.forEach(pt => {
    g.fillStyle = pt.c || '#90a4ae';
    g.fillRect(toX(pt.x) - 1, toY(pt.y) - 1, 2, 2);
  });
  g.strokeStyle = ov.borderColour || t.fg;
  g.lineWidth = 1.5;
  g.beginPath();
  g.rect(toX(viewRect.minX), toY(viewRect.minY), (viewRect.maxX - viewRect.minX) * s, (viewRect.maxY - viewRect.minY) * s);
  g.stroke();
  // Inverse mapping so a click can recentre the view.
  box.toWorld = (x, y) => ({ x: (x - box.x - pad) / s + minX, y: (y - box.y - pad) / s + minY });
  return box;
}
