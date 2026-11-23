/**
 * SCAFFOLD time bar for Graph Nexus. Original code.
 *
 * A canvas histogram (or area chart) of item timestamps with a draggable
 * range, wheel zoom, play/pause, marks, up to three selection lines, and a
 * control bar (pan, play, extend, zoom, fit). Honours locale, maxRange,
 * minScale and heightChange.
 */

import { cssFontFamily } from './fontFamily.js';
import { createEmitter } from './events.js';

const SEC = 1000;
const UNITS = [
  ['sec', SEC], ['min', 60 * SEC], ['hour', 3600 * SEC], ['day', 86400 * SEC],
  ['week', 7 * 86400 * SEC], ['month', 30.44 * 86400 * SEC], ['year', 365.25 * 86400 * SEC],
];
const UNIT_MS = Object.fromEntries(UNITS);
const AXIS_H = 18;
const CTRL_H = 26;
const unitMs = spec => (spec && UNIT_MS[spec.units] ? (spec.value ?? 1) * UNIT_MS[spec.units] : null);
const HANDLE = 6;
const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const toMs = d => (d instanceof Date ? d.getTime() : Number(d));

function floorTo(t, unit) {
  const d = new Date(t);
  switch (unit) {
    case 'year': return new Date(d.getFullYear(), 0, 1).getTime();
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'week': return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
    case 'day': return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    default: return Math.floor(t / UNIT_MS[unit]) * UNIT_MS[unit];
  }
}

function nextOf(t, unit) {
  const d = new Date(t);
  if (unit === 'year') return new Date(d.getFullYear() + 1, 0, 1).getTime();
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  if (unit === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  if (unit === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return t + UNIT_MS[unit];
}

function labelFor(t, unit, locale) {
  const d = new Date(t);
  if (locale) {
    // Custom locale: month names, day/month order and 12-hour clock.
    const short = locale.shortMonths || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = n => String(n).padStart(2, '0');
    if (unit === 'year') return String(d.getFullYear());
    if (unit === 'month') return `${(locale.longMonths && unit === 'month' && locale.longMonths[d.getMonth()]) || short[d.getMonth()]} ${d.getFullYear()}`;
    if (unit === 'day' || unit === 'week') return locale.order === 'mdy' ? `${short[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${short[d.getMonth()]}`;
    let h = d.getHours();
    let suffix = '';
    if (locale.h12) { suffix = ` ${(locale.ampm || ['am', 'pm'])[h < 12 ? 0 : 1]}`; h = h % 12 || 12; }
    return `${pad(h)}:${pad(d.getMinutes())}${unit === 'sec' ? `:${pad(d.getSeconds())}` : ''}${suffix}`;
  }
  if (unit === 'year') return String(d.getFullYear());
  if (unit === 'month') return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  if (unit === 'day' || unit === 'week') return d.toLocaleString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: unit === 'sec' ? '2-digit' : undefined });
}

/** Item -> list of { t1, t2, v } entries. */
function normaliseItem(item) {
  const dts = asList(item.dt);
  const vs = asList(item.v);
  return dts.map((dt, i) => {
    const period = dt && typeof dt === 'object' && !(dt instanceof Date);
    const t1 = toMs(period ? dt.dt1 ?? dt.dt2 : dt);
    const t2 = toMs(period ? dt.dt2 ?? dt.dt1 : dt);
    return { t1, t2, v: Number.isFinite(vs[i]) ? vs[i] : Number.isFinite(vs[0]) && vs.length === 1 ? vs[0] : 1 };
  }).filter(e => Number.isFinite(e.t1));
}

export function createTimebar(container, initialOptions = {}) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const events = createEmitter();

  let options = {
    backColour: '#ffffff', fontColour: '#444', fontFamily: 'sans-serif', fontSize: 11,
    histogram: { colour: '#8ba3c7', highlightColour: '#2f6db5', markColour: '#f5b041', markHiColour: '#d68910' },
    area: { colour: '#8ba3c7' }, type: 'histogram', playSpeed: 60, sliders: 'fixed',
    sliderColour: 'rgba(255,255,255,0.65)', sliderLineColour: '#666',
    ...initialOptions,
  };
  const items = new Map();
  let view = { t0: Date.now() - 86400 * SEC, t1: Date.now() };
  let range = { ...view };
  let marks = [];
  let selection = [];
  let hoverBin = -1;
  let playTimer = null;
  let destroyed = false;

  /* ---- data ---- */
  function extent() {
    let lo = Infinity; let hi = -Infinity;
    items.forEach(it => it.entries.forEach(e => { lo = Math.min(lo, e.t1); hi = Math.max(hi, e.t2); }));
    return lo <= hi ? { lo, hi: hi === lo ? lo + UNIT_MS.day : hi } : null;
  }

  function put(list) {
    asList(list).forEach(item => {
      if (!item || item.id == null) return;
      items.set(item.id, { id: item.id, d: item.d, entries: normaliseItem(item) });
    });
  }

  /* ---- geometry ---- */
  function size() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }
  const xOf = (t, w) => ((t - view.t0) / (view.t1 - view.t0)) * w;
  const tOf = (x, w) => view.t0 + (x / w) * (view.t1 - view.t0);

  function unit() {
    const span = view.t1 - view.t0;
    // minScale: bins never get finer than this unit.
    const floor = options.minScale && UNIT_MS[options.minScale.units] ? UNIT_MS[options.minScale.units] : 0;
    return (UNITS.find(([, ms]) => ms >= floor && span / ms <= 120) || UNITS[UNITS.length - 1])[0];
  }

  /* ---- control bar ---- */
  const showControls = () => options.showControlBar !== false;
  function controlButtons(w, h) {
    if (!showControls()) return [];
    const s = CTRL_H - 4;
    const y = h - CTRL_H + 2;
    const centre = ['back'];
    if (options.showPlay !== false) {
      centre.push('play');
      if (options.showExtend !== false) centre.push('extend');
    }
    centre.push('forward');
    const right = ['in', 'out'];
    if (options.showFit !== false) right.push('fit');
    const out = [];
    let x = w / 2 - (centre.length * (s + 4)) / 2;
    centre.forEach(id => { out.push({ id, x, y, w: s, h: s }); x += s + 4; });
    x = w - right.length * (s + 4) - 4;
    right.forEach(id => { out.push({ id, x, y, w: s, h: s }); x += s + 4; });
    return out;
  }
  function drawControls(w, h) {
    if (!showControls()) return;
    const dark = options.controlBarTheme === 'dark';
    ctx.fillStyle = dark ? '#303030' : '#f2f2f2';
    ctx.fillRect(0, h - CTRL_H, w, CTRL_H);
    const icon = { back: '◀', forward: '▶', play: playTimer ? '❚❚' : '►', extend: '►|', in: '+', out: '−', fit: '⤢' };
    controlButtons(w, h).forEach(b => {
      ctx.fillStyle = dark ? '#474747' : '#ffffff';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = dark ? '#5a5a5a' : '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      ctx.fillStyle = dark ? '#e0e0e0' : '#444444';
      ctx.font = `${b.h * 0.55}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon[b.id], b.x + b.w / 2, b.y + b.h / 2 + 1);
    });
  }
  function runControl(id) {
    if (id === 'back' || id === 'forward') api.pan(id, { animate: true });
    else if (id === 'play') { if (playTimer) api.pause(); else api.play(); }
    else if (id === 'extend') { if (playTimer) api.pause(); else api.play({ extend: true }); }
    else api.zoom(id, { animate: true });
    render();
  }

  // heightChange: displayed bar heights ease toward their targets.
  const shownHeights = new Map();
  let lastFrame = 0;
  let heightRaf = null;
  function easedHeight(key, target, now) {
    const hc = options.heightChange || {};
    if (hc.animate === false || !shownHeights.has(key)) { shownHeights.set(key, target); return target; }
    const time = hc.time ?? 200;
    const k = Math.min(1, (now - lastFrame) / time * 3);
    const cur = shownHeights.get(key);
    const next = Math.abs(target - cur) < 0.5 ? target : cur + (target - cur) * k;
    shownHeights.set(key, next);
    if (next !== target && !heightRaf) heightRaf = requestAnimationFrame(() => { heightRaf = null; render(); });
    return next;
  }

  /** Bins over the view: [{ t1, t2, total, groups[], lines[] }]. */
  function bins() {
    const u = unit();
    const out = [];
    for (let t = floorTo(view.t0, u); t < view.t1; t = nextOf(t, u)) out.push({ t1: t, t2: nextOf(t, u), total: 0, groups: [], lines: [] });
    const groupBy = options.groups && options.groups.groupBy;
    const categories = (options.groups && options.groups.categories) || [];
    const lineSets = selection.map(s => new Set(asList(s.id)));
    items.forEach(it => it.entries.forEach(e => {
      const idx = out.findIndex(b => e.t1 >= b.t1 && e.t1 < b.t2);
      if (idx < 0) return;
      const bin = out[idx];
      bin.total += e.v;
      if (groupBy) {
        const g = categories.indexOf(it.d && it.d[groupBy]);
        if (g >= 0) bin.groups[g] = (bin.groups[g] || 0) + e.v;
      }
      lineSets.forEach((set, li) => { if (set.has(it.id)) bin.lines[li] = (bin.lines[li] || 0) + e.v; });
    }));
    return out;
  }

  /* ---- drawing ---- */
  function render() {
    if (destroyed) return;
    const { w, h } = size();
    const ctrlH = showControls() ? CTRL_H : 0;
    const plotH = h - AXIS_H - ctrlH;
    const now = performance.now();
    if (!lastFrame) lastFrame = now;
    ctx.fillStyle = options.backColour;
    ctx.fillRect(0, 0, w, h);
    const bs = bins();
    const max = Math.max(1, ...bs.map(b => b.total), ...bs.flatMap(b => b.lines.filter(Boolean)));
    const hist = options.histogram || {};
    const inMark = b => marks.some(m => b.t1 < m.t2 && b.t2 > m.t1);
    const colours = (options.groups && options.groups.colours) || [];

    if (options.type === 'area') {
      ctx.beginPath();
      ctx.moveTo(0, plotH);
      bs.forEach(b => ctx.lineTo(xOf((b.t1 + b.t2) / 2, w), plotH - (b.total / max) * (plotH - 4)));
      ctx.lineTo(w, plotH);
      ctx.closePath();
      ctx.fillStyle = (options.area && options.area.colour) || hist.colour;
      ctx.fill();
    } else {
      bs.forEach((b, i) => {
        const x1 = xOf(b.t1, w) + 0.5;
        const bw = Math.max(1, xOf(b.t2, w) - xOf(b.t1, w) - 1);
        let base = plotH;
        if (b.groups.length) {
          b.groups.forEach((v, g) => {
            if (!v) return;
            const bh = (v / max) * (plotH - 4);
            ctx.fillStyle = colours[g] || hist.colour;
            ctx.fillRect(x1, base - bh, bw, bh);
            base -= bh;
          });
        } else {
          const bh = easedHeight(b.t1, (b.total / max) * (plotH - 4), now);
          const marked = inMark(b);
          ctx.fillStyle = i === hoverBin ? (marked ? hist.markHiColour : hist.highlightColour) : marked ? hist.markColour : hist.colour;
          ctx.fillRect(x1, plotH - bh, bw, bh);
        }
      });
    }

    // Selection lines.
    const lineColours = ['#e53935', '#43a047', '#1e88e5'];
    selection.forEach((s, li) => {
      ctx.beginPath();
      bs.forEach((b, i) => {
        const x = xOf((b.t1 + b.t2) / 2, w);
        const y = plotH - ((b.lines[li] || 0) / max) * (plotH - 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.c || lineColours[li % 3];
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Axis.
    ctx.fillStyle = options.fontColour;
    ctx.font = `${options.fontSize}px ${cssFontFamily(options.fontFamily)}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const u = unit();
    const labelUnit = UNITS[Math.min(UNITS.length - 1, UNITS.findIndex(([n]) => n === u) + 1)][0];
    let lastX = -Infinity;
    for (let t = floorTo(view.t0, labelUnit); t < view.t1; t = nextOf(t, labelUnit)) {
      const x = xOf(t, w);
      if (x < 0 || x - lastX < 60) continue;
      ctx.fillRect(x, plotH, 1, 4);
      ctx.fillText(labelFor(t, labelUnit, options.locale), x + 3, plotH + AXIS_H / 2 + 1);
      lastX = x;
    }

    // Sliders: shade outside the range, line at each edge.
    if (options.sliders !== 'none') {
      const a = xOf(range.t0, w);
      const b = xOf(range.t1, w);
      ctx.fillStyle = options.sliderColour;
      ctx.fillRect(0, 0, Math.max(0, a), plotH);
      ctx.fillRect(b, 0, Math.max(0, w - b), plotH);
      ctx.fillStyle = options.sliderLineColour;
      ctx.fillRect(a - 1, 0, 2, plotH);
      ctx.fillRect(b - 1, 0, 2, plotH);
      ctx.fillRect(a - HANDLE / 2, plotH / 2 - 10, HANDLE, 20);
      ctx.fillRect(b - HANDLE / 2, plotH / 2 - 10, HANDLE, 20);
    }
    drawControls(w, h);
    lastFrame = now;
  }

  /** Applies maxRange / minScale limits to a requested range width. */
  function limitRange(t0, t1, anchor = 'start') {
    const max = typeof options.maxRange === 'object' ? unitMs(options.maxRange) : null;
    const min = unitMs(options.minScale);
    let width = t1 - t0;
    if (max && width > max) width = max;
    if (min && width < min) width = min;
    if (width === t1 - t0) return { t0, t1 };
    if (anchor === 'end') return { t0: t1 - width, t1 };
    if (anchor === 'mid') { const m = (t0 + t1) / 2; return { t0: m - width / 2, t1: m + width / 2 }; }
    return { t0, t1: t0 + width };
  }

  /* ---- range / view changes ---- */
  function viewForRange() {
    const pad = options.sliders === 'none' ? 0 : (range.t1 - range.t0) * 0.2;
    view = { t0: range.t0 - pad, t1: range.t1 + pad };
  }

  let rangeToken = 0;
  function setRange(rawT0, rawT1, opts = {}, moveView = true) {
    if (!(rawT1 > rawT0)) return Promise.reject(new Error('range: dt2 must be after dt1'));
    const { t0, t1 } = limitRange(rawT0, rawT1, opts.anchor);
    const target = { t0, t1 };
    const finish = () => {
      range = target;
      if (moveView) viewForRange();
      render();
      events.emit('change', { type: 'range' });
    };
    // A newer range change cancels any animation still running.
    const token = ++rangeToken;
    if (!opts.animate) { finish(); return Promise.resolve(); }
    const from = { ...range };
    const time = opts.time ?? 200;
    const start = performance.now();
    return new Promise(resolve => {
      const frame = now => {
        if (token !== rangeToken) { resolve(); return; }
        const k = Math.min(1, Math.max(0, (now - start) / time));
        range = { t0: from.t0 + (t0 - from.t0) * k, t1: from.t1 + (t1 - from.t1) * k };
        if (moveView) viewForRange();
        render();
        if (k < 1) requestAnimationFrame(frame); else { finish(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  function fitRange(opts) {
    const ext = extent();
    if (!ext) return Promise.resolve();
    return setRange(ext.lo, ext.hi, opts);
  }

  /* ---- pointer interaction ---- */
  function hit(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const { w, h } = { w: rect.width, h: rect.height };
    const bs = bins();
    const a = xOf(range.t0, w);
    const b = xOf(range.t1, w);
    let type = 'none';
    let index;
    let bin;
    const ctrlH = showControls() ? CTRL_H : 0;
    if (ctrlH && y > h - ctrlH) type = 'controlbar';
    else if (y > h - AXIS_H - ctrlH) type = 'scale';
    else if (Math.abs(x - a) <= HANDLE) type = 'left';
    else if (Math.abs(x - b) <= HANDLE) type = 'right';
    else {
      index = bs.findIndex(bb => x >= xOf(bb.t1, w) && x < xOf(bb.t2, w));
      bin = bs[index];
      if (bin && bin.total > 0) type = 'bar';
    }
    return {
      x, y, w, type, index: bin ? index : undefined, value: bin ? bin.total : undefined,
      rangeStart: bin ? new Date(bin.t1) : undefined, rangeEnd: bin ? new Date(bin.t2) : undefined,
      tooltipX: x, tooltipY: y, button: evt.button,
    };
  }

  let drag = null;
  canvas.addEventListener('pointerdown', evt => {
    const info = hit(evt);
    if (events.emit('pointer-down', info)) return;
    if (info.type === 'controlbar') {
      const rect = canvas.getBoundingClientRect();
      const button = controlButtons(rect.width, rect.height).find(b => info.x >= b.x && info.x <= b.x + b.w && info.y >= b.y && info.y <= b.y + b.h);
      if (button) runControl(button.id);
      return;
    }
    const mode = info.type === 'left' || info.type === 'right' ? info.type
      : info.x > xOf(range.t0, info.w) && info.x < xOf(range.t1, info.w) ? 'move' : 'pan';
    if (options.sliders === 'none' && mode !== 'pan') return;
    if (events.emit('drag-start', { ...info, type: mode })) return;
    drag = { mode, startX: info.x, range: { ...range }, view: { ...view }, w: info.w, moved: false };
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener('pointermove', evt => {
    const info = hit(evt);
    if (!drag) {
      const idx = info.type === 'bar' ? info.index : -1;
      if (idx !== hoverBin) { hoverBin = idx; render(); events.emit('hover', info); }
      return;
    }
    drag.moved = true;
    const dt = ((info.x - drag.startX) / drag.w) * (drag.view.t1 - drag.view.t0);
    const min = (drag.view.t1 - drag.view.t0) / 200;
    if (drag.mode === 'pan') {
      view = { t0: drag.view.t0 - dt, t1: drag.view.t1 - dt };
      range = { t0: drag.range.t0 - dt, t1: drag.range.t1 - dt };
      render();
      events.emit('change', { type: 'range' });
      return;
    }
    let { t0, t1 } = drag.range;
    if (drag.mode === 'left') t0 = Math.min(t0 + dt, t1 - min);
    else if (drag.mode === 'right') t1 = Math.max(t1 + dt, t0 + min);
    else { t0 += dt; t1 += dt; }
    setRange(t0, t1, { anchor: drag.mode === 'left' ? 'end' : 'start' }, false);
  });

  const endDrag = evt => {
    if (!drag) return;
    const info = hit(evt);
    const wasClick = !drag.moved;
    drag = null;
    events.emit('drag-end', info);
    if (wasClick) events.emit('click', info);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', evt => {
    const info = hit(evt);
    if (!events.emit('double-click', info)) api.zoom('in', { animate: true });
  });
  canvas.addEventListener('wheel', evt => {
    const info = hit(evt);
    if (events.emit('wheel', { ...info, deltaY: evt.deltaY })) return;
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 1.2 : 1 / 1.2;
    const at = tOf(info.x, info.w);
    view = { t0: at - (at - view.t0) * factor, t1: at + (view.t1 - at) * factor };
    render();
  }, { passive: false });

  const onResize = () => render();
  window.addEventListener('resize', onResize);

  /* ---- public API ---- */
  const api = {
    load(data) {
      items.clear();
      put(data && data.items);
      events.emit('change', { type: 'data' });
      return fitRange();
    },
    merge(list) {
      put(Array.isArray(list) ? list : list && list.items);
      render();
      events.emit('change', { type: 'data' });
      return Promise.resolve();
    },
    removeItem(ids) {
      asList(ids).forEach(id => items.delete(id));
      render();
      events.emit('change', { type: 'data' });
    },
    clear() {
      items.clear();
      marks = [];
      selection = [];
      render();
      events.emit('change', { type: 'data' });
    },

    range(dt1, dt2, opts) {
      if (dt1 === undefined) return { dt1: new Date(range.t0), dt2: new Date(range.t1) };
      return setRange(toMs(dt1), toMs(dt2), opts);
    },

    getIds(dt1, dt2) {
      const a = toMs(dt1);
      const b = toMs(dt2);
      return [...items.values()].filter(it => it.entries.some(e => e.t1 <= b && e.t2 >= a)).map(it => it.id);
    },

    inRange(item) {
      const it = typeof item === 'string' ? items.get(item) : item && { entries: normaliseItem(item) };
      return !!it && it.entries.some(e => e.t1 <= range.t1 && e.t2 >= range.t0);
    },

    zoom(how = 'fit', opts = {}) {
      if (how === 'fit') {
        if (opts.id !== undefined) {
          const ents = asList(opts.id).flatMap(id => (items.get(id) || { entries: [] }).entries);
          if (ents.length) return setRange(Math.min(...ents.map(e => e.t1)), Math.max(...ents.map(e => e.t2)) || Math.min(...ents.map(e => e.t1)) + UNIT_MS.day, opts);
        }
        return fitRange(opts);
      }
      const mid = (range.t0 + range.t1) / 2;
      const half = ((range.t1 - range.t0) / 2) * (how === 'in' ? 0.5 : 2);
      return setRange(mid - half, mid + half, { ...opts, anchor: 'mid' });
    },

    pan(direction = 'forward', opts = {}) {
      const step = (range.t1 - range.t0) * (direction === 'back' ? -1 : 1);
      return setRange(range.t0 + step, range.t1 + step, opts);
    },

    play(opts = {}) {
      if (playTimer) return;
      const ext = extent();
      if (!ext) return;
      // Nothing left to play (e.g. right after load, when the range covers all data):
      // restart from the beginning with a tenth of the data span.
      if (range.t1 >= ext.hi) {
        const width = Math.min(range.t1 - range.t0, (ext.hi - ext.lo) / 10);
        setRange(ext.lo, ext.lo + width);
      }
      events.emit('play', { extend: !!opts.extend });
      events.emit('start', {});
      const tick = 50;
      playTimer = setInterval(() => {
        const width = range.t1 - range.t0;
        const step = (width / Math.max(1, options.playSpeed)) * (tick / 50);
        if (range.t1 >= ext.hi) {
          api.pause();
          events.emit('end', {});
          return;
        }
        if (opts.extend) setRange(range.t0, Math.min(ext.hi, range.t1 + step), {}, true);
        else setRange(range.t0 + step, range.t1 + step, {}, true);
      }, tick);
    },
    pause() {
      if (!playTimer) return;
      clearInterval(playTimer);
      playTimer = null;
      events.emit('pause', {});
    },

    mark(list) {
      if (list === undefined) return marks.map(m => (m.t1 === m.t2 ? new Date(m.t1) : { dt1: new Date(m.t1), dt2: new Date(m.t2) }));
      marks = asList(list).flatMap(m => normaliseItem({ dt: m })).map(({ t1, t2 }) => ({ t1, t2 }));
      render();
      return marks.length;
    },

    selection(lines) {
      if (lines !== undefined) {
        const list = asList(lines);
        const next = [];
        list.forEach((line, i) => {
          if (line == null) return;
          next[line.index ?? i] = { id: asList(line.id), c: line.c };
        });
        selection = next.slice(0, 3).filter(Boolean);
        render();
      }
      return [0, 1, 2].map(i => (selection[i] ? selection[i].id.slice() : null));
    },

    options(next) {
      if (next === undefined) return { ...options };
      options = { ...options, ...next, histogram: { ...options.histogram, ...(next.histogram || {}) } };
      if ('sliders' in next) viewForRange();
      render();
      return Promise.resolve();
    },

    setContainer(element) {
      const target = typeof element === 'string' ? document.getElementById(element) : element;
      if (!target) { canvas.remove(); return; }
      container = target;
      container.appendChild(canvas);
      render();
    },

    destroy() {
      api.pause();
      window.removeEventListener('resize', onResize);
      canvas.remove();
      events.clear();
      destroyed = true;
      Object.keys(api).forEach(k => {
        api[k] = () => { throw new Error('This time bar has been destroyed'); };
      });
    },

    on: events.on,
    off: events.off,
    bind: events.bind,
    unbind: events.unbind,
    toString: () => '[GraphNexus timebar]',
  };

  render();
  return api;
}
