/**
 * Graph Nexus browser entry point.
 *
 * ## What is here
 *
 *   - This file: the chart (2D canvas, plus a WebGL layer in 'webgl' mode or
 *     for large charts in 'auto'), interaction, view, export and the public
 *     `GraphNexus` object.
 *   - `engine/`: graph engine (+ web worker), layouts, combos, time bar, map
 *     mode, drawing helpers (decorations.js), SVG/PDF export recorders, WebGL layer.
 *   - Types: `graph-nexus.d.ts`. Framework wrappers: `../integrations/`.
 *
 * All of it is ORIGINAL code written against the documented public API. It is
 * not derived from the vendor build in `references/` or from `test.js`, and
 * must stay that way.
 *
 * ## Design notes
 *
 *   - Map mode uses the app's Leaflet if given, else the bundled assets/vendor/leaflet.
 *   - Combo links are drawn by rerouting child links; there are no combo-link objects.
 */

import { createGraphEngine } from './engine/graphEngine.js';
import { wasmActive } from './engine/wasmCore.js';
import { DEFAULT_NODE_RADIUS, DEFAULT_BORDER_WIDTH, runLayout, arrangeNodes } from './engine/layouts.js';
import { createEmitter } from './engine/events.js';
import { createSvgContext, createPdfContext } from './engine/exporters.js';
import {
  createComboApi, comboOffset, isComboNode, isNodeVisible, visibleEnd, descendants, openRadius, syncChildren,
} from './engine/combos.js';
import { createMapMode } from './engine/map.js';
import {
  COMPASS, cornerRadii, roundRectPath, truncate, drawDonut, glyphPosition, drawGlyph, drawBubble,
  drawLabelObjects, labelsSize, drawTextBox, drawBackground, drawBands, drawWatermark, drawLogo,
  navigationLayout, drawNavigation, hitButton, overviewLayout, drawOverview,
} from './engine/decorations.js';
import { createTimebar } from './engine/timebar.js';
import {
  ChronoGraphValidationError, createTimeline as createTimelineEngine, createTimelineWithController, isTimeline,
} from './engine/timeline.js';
import { createGLLayer, parseColour } from './engine/webgl.js';
import { createCamera3D, coneOutline } from './engine/camera3d.js';

const VERSION = 'GraphNexus 1.0';

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Library-wide settings shared by every chart. */
const globals = { corsAdapter: null, paths: {}, mode: 'auto', renderers: new Set() };
/** In 'auto' mode, charts with more visible nodes than this switch to WebGL. */
const GL_AUTO_NODES = 3000;

/* ============================================================================
 * Graph analysis facade  (chart.graph())
 * ==========================================================================*/

/** Graphs above this many items run betweenness / closeness in a web worker. */
const WORKER_MIN_ITEMS = 600;

/** Layouts of at least this many nodes run in a web worker (smaller ones stay synchronous). */
const LAYOUT_WORKER_MIN_NODES = 1000;

/**
 * Runs `message` in the module worker (an engine measure, or a layout); rejects if workers are
 * unavailable or the message cannot be cloned.
 * ponytail: Vite / webpack 5 / native ESM emit this worker from the `new URL(…, import.meta.url)`
 * pattern; esbuild bundles and dist/ CJS+UMD have no import.meta.url, so the caller falls back to
 * the main thread (correct, just slower on big graphs). Inline a Blob worker if that matters.
 */
function runInWorker(message, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./engine/graphWorker.js', import.meta.url), { type: 'module' });
    } catch (err) { reject(err); return; }
    worker.onmessage = ({ data }) => {
      if ('progress' in data) { onProgress(data.progress); return; }
      worker.terminate();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    worker.onerror = err => { worker.terminate(); reject(err); };
    try {
      worker.postMessage(message);
    } catch (err) { worker.terminate(); reject(err); }
  });
}

function createGraphFacade(getItems, onProgress = () => {}, engineOptions = {}) {
  const engine = createGraphEngine(engineOptions);
  // reload() only marks the graph stale; it is rebuilt from the items on the next query,
  // so a burst of edits costs one rebuild instead of one per edit.
  let stale = true;
  const reload = () => { stale = true; };
  const graph = () => {
    if (stale) { stale = false; engine.load({ items: getItems() }); }
    return engine;
  };
  // Slow measures report progress and, for large graphs, run off the main thread.
  const heavy = method => (opts = {}) => {
    const report = p => { onProgress(method, p); if (typeof opts.onProgress === 'function') opts.onProgress(p); };
    const local = () => graph()[method]({ ...opts, onProgress: report });
    const items = getItems();
    if (typeof Worker === 'undefined' || items.length < WORKER_MIN_ITEMS) return local();
    const { onProgress: _ignored, ...plain } = opts;
    let message;
    try { message = { items: JSON.parse(JSON.stringify(items)), method, opts: plain }; } catch { return local(); }
    return runInWorker(message, report).catch(() => local());
  };
  return {
    reload,
    load: data => { stale = false; return engine.load(data); },
    clear: () => { stale = false; return engine.clear(); },
    neighbours: (ids, opts) => graph().neighbours(ids, opts),
    degrees: opts => graph().degrees(opts),
    pageRank: opts => graph().pageRank(opts),
    eigenCentrality: opts => graph().eigenCentrality(opts),
    closeness: heavy('closeness'),
    betweenness: heavy('betweenness'),
    distances: (source, opts) => graph().distances(source, opts),
    components: opts => graph().components(opts),
    clusters: opts => graph().clusters(opts),
    kCores: opts => graph().kCores(opts),
    shortestPaths: (from, to, opts) => graph().shortestPaths(from, to, opts),
  };
}

/* ============================================================================
 * Item helpers
 * ==========================================================================*/

/** Labels whose font would be smaller than this (screen px) are not drawn; measured against the reference (3.69 hidden, 3.89 shown). */
const MIN_LABEL_PX = 3.8;
/** zoom('in') / zoom('out') factor about the view centre, as in the reference. */
const ZOOM_STEP = 1.4;

/*
 * Auto-sized node labels, calibrated against the reference demo by measuring
 * rendered text. For a node of body radius r (screen px) the label must fit a
 * box LABEL_BOX_WIDTH * r wide, with one line never taller than
 * LABEL_MAX_FONT * r. Among all ways of breaking the label at spaces, the one
 * that allows the largest font wins.
 */
const LABEL_BOX_WIDTH = 1.28; // fitted to 72 reference measurements, ~0.4px mean error per edge
const LABEL_MAX_FONT = 1.24;
/** Baseline-to-baseline distance, in font sizes. */
const LABEL_LINE_ADVANCE = 1.08;
/** Height per line used to centre the block (taller than the advance). */
const LABEL_BLOCK_LINE = 1.04;
/** Alphabetic baseline of the first line below the block's top, in font sizes. */
const LABEL_BASELINE = 0.84;

/**
 * fitLabel's choice of lines does not depend on r (both limits scale with it), so it is
 * cached per (family, text) with its widest line; fontPx is recomputed for each r.
 * Cleared when web fonts finish loading, since widths measured earlier used a fallback font.
 * ponytail: cleared wholesale at 20k entries; an LRU if label churn makes that thrash.
 */
const labelFits = new Map();
if (typeof document !== 'undefined' && document.fonts) document.fonts.addEventListener('loadingdone', () => labelFits.clear());

/** Best line breaking and font size for `text` inside a node of radius `r`. */
function fitLabel(g, text, r, family) {
  const key = `${family}\u0000${text}`;
  let fit = labelFits.get(key);
  if (!fit) {
    fit = searchLabelFit(g, text, family);
    if (labelFits.size >= 20000) labelFits.clear();
    labelFits.set(key, fit);
  }
  if (!fit.widest) return { lines: [text], fontPx: 0 };
  return { lines: fit.lines, fontPx: Math.min((LABEL_BOX_WIDTH * r) / fit.widest, (LABEL_MAX_FONT * r) / fit.lines.length) };
}

/** The line split fitLabel uses, with its widest line in em units (widest 0: nothing to draw). */
function searchLabelFit(g, text, family) {
  const words = text.split(/\s+/).filter(Boolean);
  g.font = `100px ${family}`;
  const width = line => g.measureText(line).width / 100; // em units
  // Scored at r = 1: the winner is the same for every r.
  const r = 1;
  let best = { lines: [text], fontPx: 0, widest: 0 };
  // ponytail: tries every split for up to 10 words (512 options); longer labels
  // fall back to one word per line.
  const n = words.length;
  if (n === 0) return best; // whitespace only: nothing to draw
  const splits = n <= 10 ? 1 << Math.max(0, n - 1) : 0;
  const consider = (lines) => {
    const widest = Math.max(...lines.map(width)) || 1;
    const fontPx = Math.min((LABEL_BOX_WIDTH * r) / widest, (LABEL_MAX_FONT * r) / lines.length);
    if (fontPx > best.fontPx) best = { lines, fontPx, widest };
  };
  for (let mask = 0; mask < splits; mask++) {
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) { lines.push(cur); cur = words[i]; } else cur += ` ${words[i]}`;
    }
    lines.push(cur);
    consider(lines);
  }
  if (splits === 0) consider(words.length ? words : [text]);
  return best;
}

/** A node's label as a plain string (`t` may be a string or a label object). */
function labelText(node) {
  if (!node) return '';
  const t = node.t;
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return labelText({ t: t[0] });
  if (typeof t === 'object') return typeof t.t === 'string' ? t.t : typeof t.text === 'string' ? t.text : '';
  return String(t);
}

/** Accepts ChartData or a plain item array. */
const itemsOf = data => asList(data && !Array.isArray(data) && data.items ? data.items : data);

function indexItems(items) {
  const nodes = {};
  const links = {};
  itemsOf(items).forEach(item => {
    if (!item || typeof item !== 'object' || item.id == null) return;
    if (item.type === 'link') links[item.id] = { ...item };
    else nodes[item.id] = { type: 'node', ...item };
  });
  return { nodes, links };
}

const imageCache = new Map();
const NOOP = () => {};
/** Final URL for an image: images path prefix, then the CORS adapter. */
function imageSrc(url) {
  let src = url;
  if (globals.paths.images && !/^(data:|blob:|https?:|\/)/.test(src)) src = globals.paths.images.replace(/\/?$/, '/') + src;
  if (globals.corsAdapter) src = globals.corsAdapter(src);
  return src;
}

/**
 * Starts loading every image the chart draws and resolves once they have
 * loaded or failed (or after `timeout` ms). Returns the URLs still not drawable.
 */
function waitForImages(urls, timeout = 3000) {
  const unique = [...new Set(urls.filter(Boolean))];
  const waits = unique.map(url => {
    imageFor(url, NOOP);
    const { img } = imageCache.get(imageSrc(url));
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  });
  const limit = new Promise(resolve => setTimeout(resolve, timeout));
  return Promise.race([Promise.all(waits), limit]).then(() => unique.filter(url => {
    const { img } = imageCache.get(imageSrc(url));
    return !(img.complete && img.naturalWidth);
  }));
}

function imageFor(url, onLoad) {
  const src = imageSrc(url);
  if (!imageCache.has(src)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => imageCache.get(src).waiters.splice(0).forEach(fn => fn());
    img.src = src;
    imageCache.set(src, { img, waiters: [] });
  }
  const entry = imageCache.get(src);
  if (entry.img.complete && entry.img.naturalWidth) return entry.img;
  if (!entry.waiters.includes(onLoad)) entry.waiters.push(onLoad);
  return null;
}


/* ============================================================================
 * Chart
 * ==========================================================================*/

function createChart(container, initialOptions, onDestroy) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none', outline: 'none' });
  canvas.tabIndex = 0;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const events = createEmitter();
  let chartOptions = { ...initialOptions };
  let nodes = {};
  let links = {};
  let selection = [];
  let locked = false;
  let destroyed = false;
  // World -> screen: screen = (world + pan) * zoom + centre.
  const view = { zoom: 1, panX: 0, panY: 0 };
  // 3D view (options.view3d): orbit camera layered on `view`. See docs/superpowers/specs/2026-11-18-3d-view-design.md.
  const camera = createCamera3D();
  let baseFocal = camera.state.focal; // the focal last asked for; fit may move further out, never closer
  const is3D = () => !!chartOptions.view3d && !mapMode.isShown();
  /** Sphere shading on round node bodies: off by default (flat discs with a rim); options.view3d = { shading: true }. */
  const shading3D = () => is3D() && !!(chartOptions.view3d && chartOptions.view3d.shading);
  /** 3D: hide labels on discs smaller than this many px in radius (view3d.labelMinRadius; default 0, every label). */
  const labelMin3D = () => {
    const v = chartOptions.view3d && chartOptions.view3d.labelMinRadius;
    return Number.isFinite(v) ? v : 0;
  };
  /**
   * options.view3d = { fog: true }: opacity falls linearly from 1 on the nearest visible
   * node to 0.2 on the farthest. The range is measured each frame (drawOrder), so the
   * fade spans the drawing whatever the camera distance.
   */
  let fogRange = null;
  function depthFog(depth) {
    if (!fogRange || !(chartOptions.view3d && chartOptions.view3d.fog)) return 1;
    const t = (depth - fogRange.min) / (fogRange.max - fogRange.min || 1);
    return 1 - 0.8 * Math.min(1, Math.max(0, t));
  }
  let pings = [];
  let gesture = null; // active drag: node | pan | marquee | createLink
  let hoverId = null;
  let pendingLink = null; // createLink() waiting for a gesture
  let aggregates = new Map(); // aggregate id -> { id1, id2, children }
  const aggStyles = new Map(); // aggregate id -> props set on it with setProperties
  const labelBoxes = new Map(); // node id -> screen boxes of its label objects, from the last screen draw
  let holdRender = false; // link-aggregation handlers run mid-draw; their re-renders wait
  let heldRender = false;
  let animating = false; // set by drawScene when flowing links / animated glyphs are visible
  let animatedFlag = false; // set by per-item draws (whose env may be a copy)
  let animRaf = null;
  let overviewOpen = !!(initialOptions.overview && initialOptions.overview.shown);
  let overviewBox = null;
  let gl = null; // WebGL layer while active
  let glFailed = false; // WebGL could not start (or lost its context): 2D only from then on
  let glBatch = null; // the layer during a screen draw, so drawNode / strokeLink can batch into it

  const underlying = () => [
    ...Object.values(nodes).filter(n => !isComboNode(n)),
    ...Object.values(links),
  ];
  const graphFacade = createGraphFacade(underlying, (task, progress) => events.emit('progress', { task, progress }), { selfLinks: !!initialOptions.selfLinks });

  /**
   * Data changed: mark the analysis graph stale and redraw once at the end of the current
   * task (a microtask), so a loop of API calls costs one frame, not one per call. Awaiting
   * any API promise runs after it; only synchronous reads of the live canvas in the same
   * task see the previous frame (toDataURL / export render their own copy, unaffected).
   */
  let renderQueued = false;
  function changed() {
    graphFacade.reload();
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { if (renderQueued) render(); });
  }

  const combos = createComboApi({
    nodes: () => nodes,
    links: () => links,
    render: () => render(),
    select: ids => { selection = ids.slice(); },
    changed,
    comboShape: () => (chartOptions.combos && chartOptions.combos.shape) || 'circle',
  });

  const mapMode = createMapMode({
    get container() { return container; },
    canvas,
    nodes: () => nodes,
    render: () => render(),
    emit: (name, props) => events.emit(name, props),
    fit: (transition = {}) => fitTo(Object.keys(nodes), transition),
    assets: () => globals.paths.assets,
    saveView: () => ({ ...view }),
    restoreView: (saved, transition = {}) => setView(saved, transition),
    isDestroyed: () => destroyed,
  });

  /* ---- geometry ---- */
  function viewSize() {
    const rect = container.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }

  const baseRadius = node => (node.e || 1) * DEFAULT_NODE_RADIUS;

  /* ---- style resolution ---- */
  const bgAlpha = () => chartOptions.backgroundAlpha ?? 0.2;
  const selColour = () => chartOptions.selectionColour || 'rgb(114, 179, 0)';
  const selFont = () => chartOptions.selectionFontColour || 'rgb(255, 255, 255)';
  /** Items stop growing past `maxItemZoom`; positions still use the real zoom. */
  const itemZoom = z => Math.min(z, chartOptions.maxItemZoom ?? Infinity);
  function decoEnv() {
    return {
      fontFamily: chartOptions.fontFamily || 'sans-serif',
      iconFontFamily: chartOptions.iconFontFamily,
      imageFor: url => imageFor(url, render),
      truncate: t => truncate(t, chartOptions.truncateLabels),
      minLabelPx: MIN_LABEL_PX,
      labelOffset: chartOptions.labelOffset || 0,
      now: performance.now(),
      animated: false,
      onAnimated: () => { animatedFlag = true; },
    };
  }
  /** A node as drawn: `selectedNode` merged over it, or the selectionColour fallback. */
  function styledNode(node, selected) {
    if (!selected) return node;
    const sel = chartOptions.selectedNode;
    if (sel) return { ...node, ...sel };
    return { ...node, b: selColour(), bw: node.bw ?? DEFAULT_BORDER_WIDTH, fbc: selColour(), fc: selFont() };
  }
  /** Rectangular when sh is 'box', or when w and h are both given (unless sh is 'circle'). */
  const isBox = node => !isComboNode(node) && (node.sh === 'box' || (node.sh !== 'circle' && node.w != null && node.h != null));
  /** Half extents in world units. */
  function worldHalf(node) {
    if (isComboNode(node) && node._combo.open) { const r = openRadius(nodes, node); return { w: r, h: r }; }
    let { w, h } = node;
    if (w === 'auto' || h === 'auto') {
      const m = labelsSize(ctx, node, decoEnv());
      if (w === 'auto') w = m.w;
      if (h === 'auto') h = m.h;
    }
    if (isBox(node) && typeof w === 'number' && typeof h === 'number') {
      return { w: Math.max(w, node.minWidth ?? 0) / 2, h: Math.max(h, node.minHeight ?? 0) / 2 };
    }
    if (typeof h === 'number') return { w: h / 2, h: h / 2 };
    const r = baseRadius(node);
    return { w: r, h: r };
  }
  const worldRadius = node => { const half = worldHalf(node); return Math.max(half.w, half.h); };

  function toScreen(x, y, v = view, size = viewSize()) {
    return { x: (x + v.panX) * v.zoom + size.w / 2, y: (y + v.panY) * v.zoom + size.h / 2 };
  }
  function toWorld(sx, sy, v = view, size = viewSize()) {
    return { x: (sx - size.w / 2) / v.zoom - v.panX, y: (sy - size.h / 2) / v.zoom - v.panY };
  }
  /**
   * True when a placed node (or a link between placed ends a and b, bowed by `pad` px)
   * lies wholly outside the frame plus a margin, so drawing it cannot touch a pixel.
   * Used by drawScene only; placeNode and hit testing are unaffected.
   * ponytail: fixed margin (half the larger side, plus 4x the node extent) covers labels,
   * glyphs and halos; a label wider than that on an off-frame node would clip.
   */
  function offFrame(size, a, b = a, pad = 0) {
    const m = Math.max(size.w, size.h) / 2 + pad;
    const ra = 4 * Math.max(a.r || 0, a.hw || 0, a.hh || 0);
    const rb = 4 * Math.max(b.r || 0, b.hw || 0, b.hh || 0);
    return Math.max(a.x + ra, b.x + rb) < -m || Math.min(a.x - ra, b.x - rb) > size.w + m
      || Math.max(a.y + ra, b.y + rb) < -m || Math.min(a.y - ra, b.y - rb) > size.h + m;
  }

  /** Screen position and radius of a node, or null when not placed (map mode, no pos). */
  function placeNode(node, v = view, size = viewSize()) {
    const half = worldHalf(node);
    let p;
    let s;
    let fog = 1;
    if (mapMode.isShown()) {
      p = mapMode.project(node);
      if (!p) return null;
      s = 1;
    } else if (is3D()) {
      p = camera.project(node.x || 0, node.y || 0, node.z || 0, v, size);
      if (!p) return null; // behind the eye
      s = itemZoom(v.zoom) * p.s;
      fog = depthFog(p.depth);
    } else {
      p = toScreen(node.x || 0, node.y || 0, v, size);
      s = itemZoom(v.zoom);
      // Adaptive styling: tiny nodes are enlarged so they stay visible far out.
      const minPx = 1.5;
      if (!(chartOptions.zoom && chartOptions.zoom.adaptiveStyling === false) && Math.max(half.w, half.h) * s < minPx) {
        s = minPx / Math.max(half.w, half.h, 1e-6);
      }
    }
    return { x: p.x, y: p.y, r: Math.max(half.w, half.h) * s, hw: half.w * s, hh: half.h * s, s, depth: p.depth ?? 0, fog };
  }

  const visibleIds = () => Object.keys(nodes).filter(id => isNodeVisible(nodes, id));
  /** Visible ids, far to near in 3D so nearer nodes paint over (painter's algorithm). */
  function drawOrder(ids, v, size) {
    fogRange = null;
    if (!is3D()) return ids;
    const depth = new Map(ids.map(id => [id, placeNode(nodes[id], v, size)?.depth ?? 0]));
    if (depth.size) {
      // A loop, not Math.min(...all): spreading 100k+ values overflows the call stack.
      let min = Infinity; let max = -Infinity;
      depth.forEach(d => { if (d < min) min = d; if (d > max) max = d; });
      fogRange = { min, max };
    }
    return [...ids].sort((a, b) => depth.get(b) - depth.get(a));
  }

  function boundsOf(ids) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    ids.forEach(id => {
      const n = nodes[id];
      if (!n) return;
      // Full drawn extent: body plus the outside border.
      const half = worldHalf(n);
      const border = n.b && !isComboNode(n) ? (n.bw ?? DEFAULT_BORDER_WIDTH) * (n.e || 1) : 0;
      minX = Math.min(minX, (n.x || 0) - half.w - border); maxX = Math.max(maxX, (n.x || 0) + half.w + border);
      minY = Math.min(minY, (n.y || 0) - half.h - border); maxY = Math.max(maxY, (n.y || 0) + half.h + border);
    });
    return minX <= maxX ? { minX, minY, maxX, maxY } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  }

  /**
   * View that fits `ids` (or only their height): the extents fill 87.5% of the
   * view and fitting never zooms in past 1, matching the reference's fit.
   */
  function fitView(ids, size = viewSize(), heightOnly = false, retarget = false) {
    if (is3D()) return fitView3D(ids, size, heightOnly, retarget);
    const b = boundsOf(ids);
    const pad = 0.875;
    const zx = (size.w / (b.maxX - b.minX || 1)) * pad;
    const zy = (size.h / (b.maxY - b.minY || 1)) * pad;
    return { zoom: Math.min(heightOnly ? zy : Math.min(zx, zy), 1), panX: -(b.minX + b.maxX) / 2, panY: -(b.minY + b.maxY) / 2 };
  }

  /**
   * 3D fit: frame the projected extents. With `retarget` the orbit pivot moves to the
   * centre of the 3D bounds first (returned as `camera`, applied by setView), so
   * orbiting afterwards turns the drawing about its middle.
   */
  function fitView3D(ids, size, heightOnly, retarget) {
    const list = ids.map(id => nodes[id]).filter(Boolean);
    if (!list.length) return { zoom: view.zoom, panX: view.panX, panY: view.panY };
    let target;
    if (retarget) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      list.forEach(n => [n.x || 0, n.y || 0, n.z || 0].forEach((c, i) => { lo[i] = Math.min(lo[i], c); hi[i] = Math.max(hi[i], c); }));
      target = { targetX: (lo[0] + hi[0]) / 2, targetY: (lo[1] + hi[1]) / 2, targetZ: (lo[2] + hi[2]) / 2 };
      // Keep the eye outside the drawing: focal at least twice its bounding-sphere radius,
      // else big 3D graphs put the camera among the nodes and near ones blow up.
      let reach = 0;
      list.forEach(n => {
        reach = Math.max(reach, Math.hypot((n.x || 0) - target.targetX, (n.y || 0) - target.targetY, (n.z || 0) - target.targetZ) + worldRadius(n));
      });
      target.focal = Math.max(baseFocal, reach * 2);
    }
    const probe = createCamera3D({ ...camera.state, ...target });
    const flat = { zoom: 1, panX: 0, panY: 0 };
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    list.forEach(n => {
      const p = probe.project(n.x || 0, n.y || 0, n.z || 0, flat, { w: 0, h: 0 });
      if (!p) return;
      const r = (worldRadius(n) + (n.b && !isComboNode(n) ? (n.bw ?? DEFAULT_BORDER_WIDTH) * (n.e || 1) : 0)) * p.s;
      minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
      minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
    });
    if (!(minX <= maxX)) return { zoom: view.zoom, panX: view.panX, panY: view.panY, camera: target };
    const pad = 0.875;
    const zx = (size.w / (maxX - minX || 1)) * pad;
    const zy = (size.h / (maxY - minY || 1)) * pad;
    return { zoom: Math.min(heightOnly ? zy : Math.min(zx, zy), 1), panX: -(minX + maxX) / 2, panY: -(minY + maxY) / 2, camera: target };
  }

  /* ---- drawing ---- */
  function sizeCanvas() {
    const { w, h } = viewSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  /** WebGL when asked for (or in 'auto' for big charts), unless a feature needs the 2D path. */
  function wantGL() {
    if (mapMode.isShown() || chartOptions.gradient || chartOptions.bands) return false;
    if (globals.mode === 'webgl') return true;
    return globals.mode === 'auto' && Object.keys(nodes).length > GL_AUTO_NODES;
  }

  function render() {
    renderQueued = false; // a direct render supersedes a queued one
    if (destroyed) return;
    if (holdRender) { heldRender = true; return; }
    animating = false;
    if (wantGL() && !gl && !glFailed) {
      gl = createGLLayer(container, canvas);
      if (!gl) glFailed = true; // stay on 2D instead of retrying every frame
      else {
        // A genuine context loss (not our own destroy()) falls back to 2D.
        const layer = gl;
        layer.canvas.addEventListener('webglcontextlost', () => {
          if (layer.destroyed || gl !== layer) return;
          layer.destroy();
          gl = null;
          glFailed = true;
          render();
        });
      }
    }
    else if (!wantGL() && gl) { gl.destroy(); gl = null; }
    const size = sizeCanvas();
    if (gl) {
      gl.begin(size, chartOptions.backColour || chartOptions.backgroundColour || '#ffffff', is3D(), shading3D());
      glBatch = gl;
    }
    try {
      labelBoxes.clear();
      drawScene(ctx, size, view, { selection: true, overlays: true });
    } finally {
      glBatch = null;
    }
    if (gl) gl.flush();
    // Flowing links and animated glyphs keep redrawing while visible.
    if (animating && !animRaf) animRaf = requestAnimationFrame(() => { animRaf = null; render(); });
  }

  /**
   * Draws the chart into any 2D context (screen, offscreen canvas or SVG/PDF recorder).
   * @param {object} flags  selection: style selected items; overlays: pings, marquee,
   *   rubber band and on-screen controls; watermark / logo: include those (default true)
   */
  function drawScene(g, size, v, flags) {
    const sel = new Set(flags.selection ? selection : []);
    const env = decoEnv();
    g.clearRect(0, 0, size.w, size.h);
    // With a WebGL layer underneath, the 2D canvas stays transparent.
    if ((!mapMode.isShown() || !flags.overlays) && !glBatch) drawBackground(g, size, chartOptions);
    if (!mapMode.isShown()) {
      drawBands(g, size, chartOptions, x => toScreen(x, 0, v, size).x, v.zoom, env);
      if (flags.watermark !== false) drawWatermark(g, size, chartOptions.watermark, env);
    }
    const place = node => placeNode(node, v, size);
    const ids = visibleIds();
    const visible = drawOrder(ids, v, size);
    // 3D: world -> screen for this frame, so links can draw 3D arrowheads.
    if (is3D()) env.project = (x, y, z) => camera.project(x, y, z, v, size);

    // Legacy shape nodes (w and h set) sit behind everything else.
    const shapes = chartOptions.legacyShapeNodeBehaviour
      ? new Set(visible.filter(id => !isComboNode(nodes[id]) && typeof nodes[id].w === 'number' && typeof nodes[id].h === 'number'))
      : new Set();
    shapes.forEach(id => { const p = place(nodes[id]); if (p) drawNode(g, nodes[id], p, v, sel.has(id), env); });

    // Open combos first, as translucent shapes behind their contents.
    const rectCombos = chartOptions.combos && chartOptions.combos.shape === 'rectangle';
    const openCombos = visible.filter(id => isComboNode(nodes[id]) && nodes[id]._combo.open);
    const drawOpenCombo = id => {
      const node = nodes[id];
      const p = place(node);
      if (!p) return;
      const os = { ...((chartOptions.defaultStyles && chartOptions.defaultStyles.openCombos) || {}), ...(node._combo.openStyle || {}), ...(node.oc || {}) };
      g.globalAlpha = node.bg || node._bg ? bgAlpha() : 1;
      g.beginPath();
      if (rectCombos) roundRectPath(g, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, cornerRadii(os.borderRadius ?? 8).map(x => x * p.s));
      else g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fillStyle = os.c || 'rgba(207,216,220,0.35)';
      g.fill();
      g.strokeStyle = sel.has(id) ? selColour() : os.b || '#90a4ae';
      g.lineWidth = Math.max(1, (os.bw ?? 1) * p.s);
      if (os.bs === 'dashed') g.setLineDash([6 * p.s, 4 * p.s]);
      g.stroke();
      g.setLineDash([]);
      // Label objects (e.g. a styled pill at position 's') draw like node labels; plain text is a title.
      const title = typeof os.t === 'object' && os.t !== null ? '' : os.t != null ? os.t : labelText(node);
      if (title === '') drawLabelObjects(g, { ...node, ...os, t: asList(os.t) }, p, { w: p.r, h: p.r }, p.s, env);
      else if (title) drawTextBox(g, title, p.x, p.y - p.r + 14 * p.s, { fs: 14, fc: '#37474f', fbc: 'rgba(0,0,0,0)', fb: true }, p.s, env);
      asList(os.g).forEach((gl, i) => { const at = glyphPosition(gl, i, p, p.r, p.s); drawGlyph(g, gl, at.x, at.y, DEFAULT_NODE_RADIUS * 0.32 * (gl.e || 1) * p.s, env); });
      const counter = comboCounterGlyph(node);
      if (counter && chartOptions.defaultStyles && chartOptions.defaultStyles.comboGlyphOnOpen) {
        const at = glyphPosition(counter, 0, p, p.r, p.s);
        drawGlyph(g, counter, at.x, at.y, DEFAULT_NODE_RADIUS * 0.32 * (counter.e || 1) * p.s, env);
      }
      g.globalAlpha = 1;
    };
    if (!is3D()) openCombos.forEach(drawOpenCombo);

    // Halos sit underneath links and nodes, as in the reference: an arrow into
    // a haloed node stays visible right up to the node's edge.
    if (!is3D()) visible.forEach(id => {
      const node = nodes[id];
      if (shapes.has(id) || (isComboNode(node) && node._combo.open)) return;
      const p = place(node);
      if (p && !offFrame(size, p)) drawHalos(g, styledNode(node, sel.has(id)), p, v);
    });

    const nodeDraws = [];
    visible.forEach(id => {
      const node = nodes[id];
      if (shapes.has(id) || (isComboNode(node) && node._combo.open)) return;
      const p = place(node);
      if (!p || offFrame(size, p)) return;
      nodeDraws.push({
        // 3D: sorted as if the disc sat on the node's camera side (one radius nearer), as in
        // the ECP engine, so a node covers the ends and arrowheads of its own links.
        depth: is3D() ? p.depth - edgeRadius(node) : p.depth,
        draw: () => {
          if (is3D()) drawHalos(g, styledNode(node, sel.has(id)), p, v);
          drawNode(g, node, p, v, sel.has(id), env);
        },
      });
    });
    if (is3D()) {
      // One far-to-near pass so a near link crosses over a far node and vice versa.
      // Open combos sort one radius behind their centre, i.e. behind their contents.
      // The WebGL layer follows this order too (ordered mode, see webgl.js).
      const comboDraws = openCombos.map(id => ({ depth: (place(nodes[id])?.depth ?? 0) + worldRadius(nodes[id]), draw: () => drawOpenCombo(id) }));
      [...comboDraws, ...drawLinks(g, size, v, sel, place, env, true), ...nodeDraws]
        .sort((p, q) => q.depth - p.depth)
        .forEach(item => item.draw());
    } else {
      drawLinks(g, size, v, sel, place, env);
      nodeDraws.forEach(item => item.draw());
    }

    // Revealed links draw over closed combos between the real end nodes.
    combos.revealed().forEach(lid => {
      const link = links[lid];
      if (!link || !nodes[link.id1] || !nodes[link.id2]) return;
      [link.id1, link.id2].forEach(nid => syncChildrenUp(nid));
      const a = place(nodes[link.id1]);
      const b = place(nodes[link.id2]);
      if (!a || !b) return;
      strokeLink(g, link, a, b, 0, v, sel.has(lid), nodes[link.id1], nodes[link.id2], env, false);
      [[nodes[link.id1], a], [nodes[link.id2], b]].forEach(([n, p]) => drawNode(g, n, p, v, sel.has(n.id), env));
    });

    if (flags.logo !== false) drawLogo(g, size, chartOptions.logo, env);
    if (env.animated || animatedFlag) animating = true;
    animatedFlag = false;
    if (!flags.overlays) return;

    const now = performance.now();
    pings.forEach(ping => {
      const node = nodes[ping.id];
      if (!node) return;
      const p = place(node);
      if (!p) return;
      const t = ((now - ping.start) % ping.time) / ping.time;
      g.globalAlpha = 1 - t;
      g.beginPath();
      g.arc(p.x, p.y, p.r + (ping.r * t + ping.w) * v.zoom, 0, Math.PI * 2);
      g.strokeStyle = ping.c;
      g.lineWidth = ping.lw * v.zoom;
      g.stroke();
      g.globalAlpha = 1;
    });

    if (gesture && gesture.kind === 'marquee' && gesture.moved) {
      const { x0, y0, x1, y1 } = gesture;
      g.fillStyle = 'rgba(66,165,245,0.12)';
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeStyle = '#42a5f5';
      g.lineWidth = 1;
      g.beginPath();
      g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.stroke();
    }
    if (gesture && gesture.kind === 'createLink') {
      const src = place(nodes[gesture.source]);
      if (src) {
        g.setLineDash([6, 4]);
        g.strokeStyle = (pendingLink && pendingLink.style && pendingLink.style.c) || '#555';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(src.x, src.y);
        g.lineTo(gesture.x1, gesture.y1);
        g.stroke();
        g.setLineDash([]);
      }
    }

    // On-screen controls (not in exports).
    if (!mapMode.isShown()) {
      drawNavigation(g, size, chartOptions);
      const all = ids; // this frame's visible nodes (a later edit queues another frame)
      const viewRect = (() => {
        const tl = toWorld(0, 0, v, size);
        const br = toWorld(size.w, size.h, v, size);
        return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
      })();
      const ov = overviewScene(all);
      overviewBox = drawOverview(g, size, chartOptions, overviewOpen, ov.bounds, viewRect, ov.points);
    }
  }

  /**
   * Overview contents. 2D: world positions. 3D: the projected scene in pivot-plane
   * coordinates (screen before pan / zoom), the space toWorld and pan use, so the
   * view rectangle and click-to-pan stay the same code as 2D.
   */
  function overviewScene(ids) {
    if (!is3D()) return { bounds: boundsOf(ids), points: ids.map(id => ({ x: nodes[id].x || 0, y: nodes[id].y || 0, c: nodes[id].c })) };
    const flat = { zoom: 1, panX: 0, panY: 0 };
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const points = [];
    ids.forEach(id => {
      const n = nodes[id];
      const p = camera.project(n.x || 0, n.y || 0, n.z || 0, flat, { w: 0, h: 0 });
      if (!p) return;
      const r = worldRadius(n) * p.s;
      minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
      minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
      points.push({ x: p.x, y: p.y, c: n.c, depth: p.depth });
    });
    points.sort((a, b) => b.depth - a.depth);
    const bounds = minX <= maxX ? { minX, minY, maxX, maxY } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    return { bounds, points };
  }

  /** Puts a node inside closed combos at its stored offset, for revealed links. */
  function syncChildrenUp(id) {
    const chain = [];
    let n = nodes[id];
    while (n && n.parentId != null && nodes[n.parentId]) { chain.unshift(n.parentId); n = nodes[n.parentId]; }
    if (chain.length) syncChildren(nodes, chain[0]);
  }

  /** Arrow direction of a link for aggregation: 'from' (id1->id2), 'to', 'both' or 'none'. */
  const linkDirection = l => (l.a1 && l.a2 ? 'both' : l.a2 ? 'from' : l.a1 ? 'to' : 'none');

  /** Draws the links, or with `collect` returns [{ depth, draw }] for a 3D depth sort. */
  function drawLinks(g, size, v, sel, place, env, collect = false) {
    // Resolve each link to the nodes it is drawn between (combos reroute).
    const drawn = [];
    Object.values(links).forEach(link => {
      if (link.hi || !nodes[link.id1] || !nodes[link.id2]) return;
      const e1 = visibleEnd(nodes, link.id1);
      const e2 = visibleEnd(nodes, link.id2);
      if (e1 === e2 || !isNodeVisible(nodes, e1) || !isNodeVisible(nodes, e2)) return;
      drawn.push({ link, e1, e2, rerouted: e1 !== link.id1 || e2 !== link.id2 });
    });

    // Aggregation: one drawn link per node pair, optionally split by a data
    // value (`aggregateBy`) and by arrow direction (`aggregateByDirection`).
    const before = aggregates;
    aggregates = new Map();
    let list = drawn;
    const agg = chartOptions.aggregateLinks;
    if (agg) {
      const by = typeof agg === 'object' ? agg.aggregateBy : undefined;
      const byDir = typeof agg === 'object' && agg.aggregateByDirection;
      const groups = new Map();
      list = [];
      drawn.forEach(d => {
        const value = by ? d.link.d && d.link.d[by] : undefined;
        if (by && value === undefined) { list.push(d); return; }
        const [id1, id2] = d.e1 < d.e2 ? [d.e1, d.e2] : [d.e2, d.e1];
        let dir = byDir ? linkDirection(d.link) : undefined;
        // Direction is relative to id1 -> id2 of the aggregate.
        if (dir && d.e1 !== id1) dir = dir === 'from' ? 'to' : dir === 'to' ? 'from' : dir;
        const key = `${id1}|${id2}|${by ? String(value) : ''}|${dir || ''}`;
        if (!groups.has(key)) groups.set(key, { id1, id2, value, dir, members: [] });
        groups.get(key).members.push(d);
      });
      groups.forEach((group, key) => {
        const id = `_agg:${key}`;
        const children = group.members.map(m => m.link.id);
        const fwd = group.members.some(m => m.link.a2 || m.link.a1);
        aggregates.set(id, { id, id1: group.id1, id2: group.id2, children, directed: fwd, value: group.value, dir: group.dir, by, members: group.members });
      });
    }
    // Tell listeners which aggregate links appeared, changed or went away.
    // Handlers usually style the aggregate (setProperties), so draw after them.
    if (agg || before.size) {
      const emitAgg = (a, change) => events.emit('link-aggregation', {
        id: a.id, id1: a.id1, id2: a.id2, links: a.children.slice(), change,
        aggregateByValue: a.by ? a.value : undefined, aggregateByDirection: a.dir,
      });
      holdRender = true;
      try {
        aggregates.forEach((a, id) => {
          const old = before.get(id);
          if (!old) emitAgg(a, 'created');
          else if (old.children.join() !== a.children.join()) emitAgg(a, 'updated');
        });
        before.forEach((a, id) => { if (!aggregates.has(id)) { aggStyles.delete(id); emitAgg(a, 'deleted'); } });
      } finally {
        holdRender = false;
        heldRender = false; // this draw already includes whatever the handlers set
        renderQueued = false; // ...including edits made through changed()
      }
    }
    aggregates.forEach((a, id) => {
      const first = a.members[0];
      list.push({
        link: { ...first.link, id, t: undefined, w: a.members.reduce((w, m) => Math.max(w, m.link.w || 1), -Infinity) + Math.log2(a.members.length), ...aggStyles.get(id) },
        e1: first.e1,
        e2: first.e2,
        rerouted: first.rerouted,
        aggregateOf: a.children,
      });
    });

    // Links sharing a node pair fan out symmetrically (two links bow 40 apart,
    // more step 40 apart); the sign is relative to the unordered pair so links
    // drawn in opposite directions still spread to opposite sides.
    const pairKey = d => (d.e1 < d.e2 ? `${d.e1}\u0000${d.e2}` : `${d.e2}\u0000${d.e1}`);
    const keys = list.map(pairKey);
    const pairCount = new Map();
    keys.forEach(key => pairCount.set(key, (pairCount.get(key) || 0) + 1));
    const pairSeen = new Map();
    const queue = [];
    list.forEach(({ link, e1, e2, aggregateOf, rerouted }, i) => {
      const a = place(nodes[e1]);
      const b = place(nodes[e2]);
      const key = keys[i];
      const k = pairCount.get(key);
      const idx = pairSeen.get(key) || 0;
      pairSeen.set(key, idx + 1);
      if (!a || !b) return;
      const bend = (idx - (k - 1) / 2) * (k === 2 ? 80 : 40) * (e1 < e2 ? 1 : -1);
      if (offFrame(size, a, b, Math.abs(link.off ?? bend) * v.zoom)) return;
      const selected = sel.has(link.id) || (aggregateOf && aggregateOf.some(id => sel.has(id)));
      const draw = () => strokeLink(g, link, a, b, bend, v, selected, nodes[e1], nodes[e2], env, rerouted);
      if (collect) queue.push({ depth: (a.depth + b.depth) / 2, draw });
      else draw();
    });
    return queue;
  }

  const ARROW_SCALE = { normal: 1, small: 0.7, large: 1.4, xlarge: 1.8 };
  /** 3D arrowheads shorter than this on screen (px) skip the projected cone. */
  const CONE_MIN_PX = 3;

  /** World radius of a node's outer edge (body plus outside border), as drawn. */
  const edgeRadius = node => worldRadius(node) + (node.b && !(node.donut && node.donut.v) ? (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) : 0);

  /**
   * 3D: where a link's visible part begins at the n2 (sign 1) or n1 (sign -1) end. Walks
   * the 3D centre line from that node toward the other one and returns the first point
   * that is both outside the node (its edge radius) and outside its disc on screen
   * (`outside(q)` tests a projected point). A link that leaves toward the camera exits
   * the sphere inside the drawn disc; going on to the disc's rim keeps the line and
   * arrowhead off the node and its label. Returns { at: [x, y, z], q: screen point,
   * dir: unit vector from base to tip for an arrowhead there }, or null if no point of
   * the link shows outside the disc.
   */
  function linkExit(n1, n2, sign, project, outside) {
    const A = [n1.x || 0, n1.y || 0, n1.z || 0];
    const B = [n2.x || 0, n2.y || 0, n2.z || 0];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    if (len < 1e-6) return null;
    const [centre, node, other] = sign > 0 ? [B, n2, A] : [A, n1, B];
    const away = centre.map((c, i) => (other[i] - c) / len); // from this end toward the other
    const point = d => centre.map((c, i) => c + away[i] * d);
    // Same maths as project(...point(d)), without an array per bisection step.
    const projectAt = d => project(centre[0] + away[0] * d, centre[1] + away[1] * d, centre[2] + away[2] * d);
    let lo = edgeRadius(node);
    if (lo >= len) return null;
    let q = projectAt(lo);
    if (!q) return null;
    if (!outside(q)) {
      // Bisect for the disc rim; nothing to draw if even the far end is inside the disc.
      let hi = len;
      const far = projectAt(hi);
      if (!far || !outside(far)) return null;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const m = projectAt(mid);
        if (!m || outside(m)) hi = mid; else lo = mid;
      }
      lo = hi;
      q = projectAt(lo);
      if (!q) return null;
    }
    return { at: point(lo), q, dir: away.map(c => -c), d: lo, len, point };
  }

  /**
   * 3D arrowheads. Returns cone(sign, outside): the screen outline of a cone whose tip sits
   * where the link first shows (linkExit: off the node and its disc; sign 1: the n2 end, -1: n1),
   * with length (8 + 1.556 w) and base diameter equal to the length (world units): the
   * 2D head's size rule, so side-on it draws the same triangle. Null when the link has no length or the cone is behind the eye.
   */
  function coneHead(link, n1, n2, w, project) {
    const length = (8 + 1.556 * w) * (ARROW_SCALE[chartOptions.arrows] || 1);
    return (sign, outside) => {
      const exit = linkExit(n1, n2, sign, project, outside);
      if (!exit) return null;
      // Seen nearly end-on a cone is a disc around its axis, so a tip on the rim still
      // overlaps the node: slide it out until the whole outline is clear of the disc.
      const coneAt = d => coneOutline(project, exit.point(d), exit.dir, length, length * 0.5);
      const clear = c => c && c.outline.every(outside);
      const first = coneAt(exit.d);
      if (clear(first)) return first;
      let lo = exit.d;
      let hi = exit.len;
      if (!clear(coneAt(hi))) return null;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (clear(coneAt(mid))) hi = mid; else lo = mid;
      }
      return coneAt(hi);
    };
  }

  function strokeLink(g, rawLink, a, b, bow, v, selected, n1, n2, outerEnv, rerouted) {
    const env = fullOnHover(rawLink.id, outerEnv);
    let link = rawLink;
    if (rerouted && chartOptions.defaultStyles && chartOptions.defaultStyles.comboLinks) link = { ...link, ...chartOptions.defaultStyles.comboLinks };
    if (selected) link = chartOptions.selectedLink ? { ...link, ...chartOptions.selectedLink } : { ...link, c: selColour(), fbc: selColour(), fc: selFont() };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return;
    const s = a.s ?? v.zoom;
    const w = link.w || 1;

    // Path. Links sharing a node pair bow apart as quadratics whose control point
    // sits `bow` world units off the centre line (40 for a pair, apex 20);
    // `off` overrides the offset. 'horizontal' and
    // 'vertical' paths are cubics that leave and enter the nodes along that axis.
    const path = link._path || (chartOptions.linkStyle && chartOptions.linkStyle.path) || 'direct';
    let at;
    let straight = false;
    if (path === 'horizontal' || path === 'vertical') {
      const h = path === 'horizontal';
      const c1 = h ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 };
      const c2 = h ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 };
      at = t => {
        const u = 1 - t;
        return {
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        };
      };
    } else {
      const bend = (link.off != null ? link.off : bow) * v.zoom;
      straight = bend === 0;
      const cx = (a.x + b.x) / 2 + ((b.y - a.y) / len) * bend;
      const cy = (a.y + b.y) / 2 - ((b.x - a.x) / len) * bend;
      at = t => ({
        x: (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * cx + t * t * b.x,
        y: (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * cy + t * t * b.y,
      });
    }
    // Sample the curve once; everything below works on arc length. A straight
    // link is exact with one segment; a curve gets one sample per ~6 screen px
    // (4..64), so a zoomed-out 10k-link chart is not 64 segments per link.
    const N = straight ? 1 : Math.min(64, Math.max(4, Math.ceil(len / 6)));
    const pts = [];
    const cum = [0];
    for (let i = 0; i <= N; i++) {
      pts.push(at(i / N));
      if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const total = cum[N];
    const atArc = d => {
      const t = Math.min(total, Math.max(0, d));
      let i = 1;
      while (i < N && cum[i] < t) i++;
      const f = (t - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, ux: (p1.x - p0.x) / dl, uy: (p1.y - p0.y) / dl };
    };
    // Arc position where the curve is `dist` (straight line) from an end centre.
    const arcAtDistance = (fromB, dist) => {
      const end = fromB ? b : a;
      if (fromB) {
        for (let i = N; i > 0; i--) {
          if (Math.hypot(pts[i - 1].x - end.x, pts[i - 1].y - end.y) > dist) {
            const d0 = Math.hypot(pts[i].x - end.x, pts[i].y - end.y);
            const d1 = Math.hypot(pts[i - 1].x - end.x, pts[i - 1].y - end.y);
            return cum[i] - ((dist - d0) / ((d1 - d0) || 1)) * (cum[i] - cum[i - 1]);
          }
        }
        return 0;
      }
      for (let i = 0; i < N; i++) {
        if (Math.hypot(pts[i + 1].x - end.x, pts[i + 1].y - end.y) > dist) {
          const d0 = Math.hypot(pts[i].x - end.x, pts[i].y - end.y);
          const d1 = Math.hypot(pts[i + 1].x - end.x, pts[i + 1].y - end.y);
          return cum[i] + ((dist - d0) / ((d1 - d0) || 1)) * (cum[i + 1] - cum[i]);
        }
      }
      return total;
    };
    // Distance from a node centre to its outer edge along direction (ux, uy),
    // border included; 'loose' link ends leave a small gap.
    const loose = chartOptions.linkEnds && chartOptions.linkEnds.spacing === 'loose' ? 4 * s : 0;
    const outerOf = (end, node, ux, uy) => {
      const base = isBox(node) && end.hw != null
        ? Math.min(end.hw / Math.max(Math.abs(ux), 1e-6), end.hh / Math.max(Math.abs(uy), 1e-6))
        : end.r;
      const border = node.b && !(node.donut && node.donut.v) ? (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) * s : 0;
      // avoidLabels (default true): a link leaving downward clears a label drawn below the node.
      const labelBelow = labelText(node) && (node.tc === false || (node.tc === undefined && node.u));
      const avoid = labelBelow && !(chartOptions.linkEnds && chartOptions.linkEnds.avoidLabels === false) && uy > 0.7;
      const labelDrop = avoid ? (node.fs || 14) * 1.8 * s : 0;
      return base + border + loose + labelDrop;
    };

    let alpha = link.bg || link._bg || n1.bg || n1._bg || n2.bg || n2._bg ? bgAlpha() : 1;
    alpha *= ((a.fog ?? 1) + (b.fog ?? 1)) / 2;
    // Adaptive styling: links fade when zoomed far out.
    if (!(chartOptions.zoom && chartOptions.zoom.adaptiveStyling === false) && v.zoom < 0.1) alpha *= Math.max(0.25, v.zoom / 0.1);
    g.globalAlpha = alpha;

    const arrows = chartOptions.arrows !== 'none';
    // Measured against the reference: an isosceles head whose length equals its
    // base, 8 + 1.556 * width (world units), tip on the node's outer edge.
    const head = (8 + 1.556 * w) * s * (ARROW_SCALE[chartOptions.arrows] || 1);
    // Back-off (b1/b2) moves an end inward by a fraction of the whole length.
    const startBack = (link.b1 || 0) * total;
    const endBack = (link.b2 || 0) * total;
    let from = startBack;
    let to = total - endBack;
    const heads = [];
    // 3D, straight links: each head is a cone along the link's 3D direction, projected, so it
    // foreshortens and shrinks with depth (null: fall back to the flat 2D head).
    // 3D: true when a projected point lies outside an end node's drawn disc (border included).
    const outsideDisc = fromB => {
      const end = fromB ? b : a;
      const at = atArc(fromB ? total : 0);
      const r = outerOf(end, fromB ? n2 : n1, fromB ? -at.ux : at.ux, fromB ? -at.uy : at.uy);
      return q => Math.hypot(q.x - end.x, q.y - end.y) >= r;
    };
    // ponytail: heads under CONE_MIN_PX draw as the flat 2D head; a cone that small is a
    // few pixels either way and costs ~20 projections plus a hull. Lower it if tiny 3D heads matter.
    const cone = arrows && straight && env.project && (link.a1 || link.a2) && head >= CONE_MIN_PX ? coneHead(link, n1, n2, w, env.project) : null;
    if (arrows && link.a2) {
      const c3 = !link.b2 && cone && cone(1, outsideDisc(true));
      if (c3) {
        heads.push({ outline: c3.outline, colour: link.c2 || link.c });
        to = Math.hypot(c3.base.x - a.x, c3.base.y - a.y) + 0.5;
      } else {
        const tipArc = link.b2 ? to : arcAtDistance(true, outerOf(b, n2, -atArc(total).ux, -atArc(total).uy));
        heads.push({ tip: atArc(tipArc), base: atArc(tipArc - head), colour: link.c2 || link.c });
        to = tipArc - head + 0.5;
      }
    }
    if (arrows && link.a1) {
      const c3 = !link.b1 && cone && cone(-1, outsideDisc(false));
      if (c3) {
        heads.push({ outline: c3.outline, colour: link.c });
        from = Math.hypot(c3.base.x - a.x, c3.base.y - a.y) - 0.5;
      } else {
        const tipArc = link.b1 ? from : arcAtDistance(false, outerOf(a, n1, atArc(0).ux, atArc(0).uy));
        heads.push({ tip: atArc(tipArc), base: atArc(tipArc + head), colour: link.c });
        from = tipArc + head - 0.5;
      }
    }

    // 3D: an end without a head still starts at the node's edge, not its centre. A nearer
    // link draws over the node there, so a line from the centre would cross its label.
    if (env.project) {
      const edgeArc = (node, fromB) => {
        const exit = straight && linkExit(n1, n2, fromB ? 1 : -1, env.project, outsideDisc(fromB));
        if (exit) return Math.hypot(exit.q.x - a.x, exit.q.y - a.y);
        const at = atArc(fromB ? total : 0);
        return arcAtDistance(fromB, outerOf(fromB ? b : a, node, fromB ? -at.ux : at.ux, fromB ? -at.uy : at.uy));
      };
      if (!(arrows && link.a1) && !link.b1) from = edgeArc(n1, false);
      if (!(arrows && link.a2) && !link.b2) to = edgeArc(n2, true);
    }

    // Stroke style: solid colour, or a c -> c2 gradient around the midpoint.
    const colour = link.c || '#bcced8';
    let stroke = colour;
    if (link.c2 && typeof g.createLinearGradient === 'function') {
      const tr = Math.min(1, Math.max(0, (chartOptions.linkStyle && chartOptions.linkStyle.transition) ?? 1));
      const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, colour);
      grad.addColorStop(Math.max(0, 0.5 - tr / 2), colour);
      grad.addColorStop(Math.min(1, 0.5 + tr / 2), link.c2);
      grad.addColorStop(1, link.c2);
      stroke = grad;
    }
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(0.5, w * s);
    const flow = link.flow ? (typeof link.flow === 'object' ? link.flow.velocity ?? 2 : 2) : 0;
    if (flow) {
      g.setLineDash([10 * s, 6 * s]);
      g.lineDashOffset = -((env.now / 1000) * flow * 30 * s) % (16 * s);
      animatedFlag = true;
    } else if (link.ls === 'dashed') g.setLineDash([8 * s, 6 * s]);
    else if (link.ls === 'dotted') g.setLineDash([2 * s, 4 * s]);
    if (to > from && glBatch && !flow && !link.ls) {
      const c1 = parseColour(colour);
      const c2 = parseColour(link.c2 || colour);
      const tr = Math.min(1, Math.max(0, (chartOptions.linkStyle && chartOptions.linkStyle.transition) ?? 1));
      const mix = f => {
        const k = link.c2 ? Math.min(1, Math.max(0, (f - (0.5 - tr / 2)) / (tr || 1e-6))) : 0;
        return c1.map((v, i) => v + (c2[i] - v) * k);
      };
      const stops = [from, ...cum.filter(c => c > from && c < to), to];
      for (let i = 1; i < stops.length; i++) {
        const q0 = atArc(stops[i - 1]);
        const q1 = atArc(stops[i]);
        glBatch.line(q0.x, q0.y, q1.x, q1.y, g.lineWidth, mix(stops[i - 1] / total), mix(stops[i] / total), g.globalAlpha);
      }
    } else if (to > from) {
      g.beginPath();
      const p0 = atArc(from);
      g.moveTo(p0.x, p0.y);
      for (let i = 1; i < N; i++) if (cum[i] > from && cum[i] < to) g.lineTo(pts[i].x, pts[i].y);
      const p1 = atArc(to);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.lineDashOffset = 0;

    heads.forEach(({ tip, base, outline, colour: c }) => {
      g.fillStyle = link.c2 ? c || colour : colour;
      if (outline) {
        g.beginPath();
        outline.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.fill();
        return;
      }
      const hl = Math.hypot(tip.x - base.x, tip.y - base.y) || 1;
      const ux = (tip.x - base.x) / hl;
      const uy = (tip.y - base.y) / hl;
      const bx = tip.x - ux * head;
      const by = tip.y - uy * head;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(bx - uy * head * 0.5, by + ux * head * 0.5);
      g.lineTo(bx + uy * head * 0.5, by - ux * head * 0.5);
      g.closePath();
      g.fillStyle = link.c2 ? c || colour : colour;
      g.fill();
    });

    // Labels: centre (with glyphs and bubble), and t1 / t2 near the ends.
    const style = { fs: link.fs || 14, fc: link.fc, fbc: link.fbc, ff: link.ff, fb: link.fb };
    const inline = chartOptions.linkStyle && chartOptions.linkStyle.inline;
    const mid = atArc(total / 2);
    const angleOf = p => {
      if (!inline) return 0;
      let ang = Math.atan2(p.uy, p.ux);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      return ang;
    };
    const label = labelText(link);
    if (label) drawTextBox(g, label, mid.x, mid.y, style, s, env, angleOf(mid));
    const glyphs = asList(link.g);
    if (glyphs.length) {
      const gr = 10 * s;
      // 'horizontal' (default) lines glyphs up across the screen; 'along' follows the link.
      const along = chartOptions.linkStyle && chartOptions.linkStyle.glyphs === 'along' && !label;
      const ux = along ? mid.ux : 1;
      const uy = along ? mid.uy : 0;
      let off = label ? 0 : -((glyphs.length - 1) * gr * 1.1);
      if (label) { g.font = `${(link.fs || 14) * s}px ${link.ff || env.fontFamily}`; off += g.measureText(label).width / 2 + gr + 4; }
      glyphs.forEach(gl => { drawGlyph(g, gl, mid.x + ux * off, mid.y + uy * off, gr * (gl.e || 1), env); off += gr * 2.2; });
    }
    [['t1', 0.18], ['t2', 0.82]].forEach(([key, frac]) => {
      const t = link[key];
      if (t == null) return;
      const p = atArc(total * frac);
      const obj = typeof t === 'string' ? { t } : t;
      drawTextBox(g, obj.t ?? '', p.x, p.y, { ...style, ...obj }, s, env, angleOf(p));
      asList(obj.g).forEach((gl, i) => drawGlyph(g, gl, p.x + (i + 1) * 22 * s, p.y, 10 * s, env));
    });
    if (link.bu) drawBubble(g, link.bu, mid.x, mid.y, s, env);
    g.globalAlpha = 1;
  }

  const HALO_KEYS = Array.from({ length: 10 }, (_, i) => `ha${i}`);
  function drawHalos(g, node, p, v) {
    g.globalAlpha = (node.bg || node._bg ? bgAlpha() : 1) * (p.fog ?? 1);
    // Halos ha0..ha9.
    for (let i = 0; i < 10; i++) {
      const halo = node[HALO_KEYS[i]];
      if (!halo || !halo.c) continue;
      // Ring centred at r, w wide, both in world units scaled with the node
      // (measured against the reference: ha0 {r: 34, w: 6} touches a bordered node).
      const e = node.e || 1;
      const s = p.s ?? v.zoom;
      // In WebGL mode the ring goes on the GL layer, which draws halos before links.
      if (glBatch) { glBatch.ring(p.x, p.y, (halo.r || 34) * e * s, (halo.w || 6) * e * s, halo.c, g.globalAlpha); continue; }
      g.beginPath();
      g.arc(p.x, p.y, (halo.r || 34) * e * s, 0, Math.PI * 2);
      g.strokeStyle = halo.c;
      g.lineWidth = (halo.w || 6) * e * s;
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** The counter glyph on a combo: its own `glyph`, else defaultStyles.comboGlyph, null for none. */
  function comboCounterGlyph(node) {
    if (!isComboNode(node)) return null;
    const own = node._combo.glyph;
    const dflt = chartOptions.defaultStyles && 'comboGlyph' in chartOptions.defaultStyles ? chartOptions.defaultStyles.comboGlyph : {};
    const base = own !== undefined ? own : dflt;
    if (base === null) return null;
    const count = descendants(nodes, node.id).filter(id => !isComboNode(nodes[id])).length;
    return { c: '#e53935', fc: '#ffffff', p: 'ne', t: String(count), ...base };
  }

  /** Truncated labels show in full while hovered (truncateLabels.showOnHover, default true). */
  const fullOnHover = (id, env) => (id === hoverId && chartOptions.truncateLabels && chartOptions.truncateLabels.showOnHover !== false
    ? { ...env, truncate: t => t } : env);

  function drawNode(g, rawNode, p, v, selected, outerEnv) {
    const env = fullOnHover(rawNode.id, outerEnv);
    let node = styledNode(rawNode, selected);
    const s = p.s ?? v.zoom;
    const r = p.r;
    const hw = p.hw ?? r;
    const hh = p.hh ?? r;
    g.globalAlpha = (node.bg || node._bg ? bgAlpha() : 1) * (p.fog ?? 1);

    // Deprecated dummy nodes: a small dumbbell end.
    if (node.du) {
      g.beginPath();
      g.arc(p.x, p.y, Math.max(2, 5 * s), 0, Math.PI * 2);
      g.fillStyle = node.c || '#757575';
      g.fill();
      g.globalAlpha = 1;
      return;
    }

    const box = isBox(node);
    const radii = box ? cornerRadii(node.borderRadius).map(x => x * s) : null;
    const shape = (grow = 0) => {
      g.beginPath();
      if (box) roundRectPath(g, p.x - hw - grow, p.y - hh - grow, (hw + grow) * 2, (hh + grow) * 2, radii.map(x => (x ? x + grow : 0)));
      else g.arc(p.x, p.y, r + grow, 0, Math.PI * 2);
    };
    // Border first, as a shape reaching (r + border) under the body, so the
    // body's anti-aliased edge blends into the border instead of leaving a seam.
    // A donut replaces the border on circle nodes.
    const donut = !box && node.donut && node.donut.v;
    const hasBorder = !donut && (node.b || isComboNode(node));
    const lw = hasBorder ? Math.max(1, (node.bw ?? DEFAULT_BORDER_WIDTH) * (node.e || 1) * s) : 0;
    const glBody = glBatch && !donut && node.bs !== 'dashed' && !(box && radii.some(Boolean));
    if (glBody) {
      glBatch.disc(p.x, p.y, hw, hh, box, node.c || (isComboNode(node) ? '#cfd8dc' : 'rgba(0,0,0,0)'), node.b || '#90a4ae', lw, g.globalAlpha);
    } else if (hasBorder) {
      g.fillStyle = node.b || '#90a4ae';
      if (node.bs === 'dashed') {
        g.strokeStyle = g.fillStyle; g.lineWidth = lw; g.setLineDash([6 * s, 4 * s]);
        shape(lw / 2);
        g.stroke(); g.setLineDash([]);
      } else { shape(lw); g.fill(); }
    }
    if (!glBody) {
      shape();
      g.fillStyle = node.c || (isComboNode(node) ? '#cfd8dc' : 'rgba(0,0,0,0)');
      g.fill();
    }
    if (donut) drawDonut(g, node.donut, p, r, s);

    // Image and font icon, positioned by imageAlignment[path] { dx, dy, e }.
    const align = key => (chartOptions.imageAlignment && chartOptions.imageAlignment[key]) || {};
    if (node.u && typeof g.drawImage === 'function') {
      const img = imageFor(node.u, render);
      if (img) {
        const al = align(node.u);
        const k = al.e ?? 1;
        const ox = ((al.dx || 0) / 100) * hw * 2;
        const oy = ((al.dy || 0) / 100) * hh * 2;
        g.save();
        if (node.ci) { g.beginPath(); g.arc(p.x, p.y, Math.min(hw, hh), 0, Math.PI * 2); } else shape();
        g.clip();
        g.drawImage(img, p.x - hw * k + ox, p.y - hh * k + oy, hw * 2 * k, hh * 2 * k);
        g.restore();
      }
    }
    // 3D: light the body like a sphere (top-left highlight, darker rim). The WebGL
    // layer does the same in its fragment shader. SVG/PDF recorders have no radial gradient.
    if (shading3D() && !box && !glBody && !donut && typeof g.createRadialGradient === 'function') {
      const light = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.05, p.x, p.y, r);
      light.addColorStop(0, 'rgba(255,255,255,0.55)');
      light.addColorStop(0.35, 'rgba(255,255,255,0.12)');
      light.addColorStop(0.75, 'rgba(0,0,0,0.06)');
      light.addColorStop(1, 'rgba(0,0,0,0.38)');
      shape();
      g.fillStyle = light;
      g.fill();
    }
    if (node.fi && node.fi.t != null) {
      const ch = typeof node.fi.t === 'number' ? String.fromCodePoint(node.fi.t) : String(node.fi.t);
      const al = align(node.fi.t);
      g.fillStyle = node.fi.c || '#000';
      g.font = `${Math.min(hw, hh) * 1.1 * (al.e ?? 1)}px ${node.fi.ff || chartOptions.iconFontFamily || 'sans-serif'}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, p.x + ((al.dx || 0) / 100) * hw * 2, p.y + ((al.dy || 0) / 100) * hh * 2);
    }

    // Deprecated resize handles on box nodes.
    if (node.re && box) {
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#616161';
      g.lineWidth = 1;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy]) => {
        g.beginPath();
        g.rect(p.x + dx * hw - 4, p.y + dy * hh - 4, 8, 8);
        g.fill();
        g.stroke();
      });
    }

    const drawGlyphs = () => {
      const list = asList(node.g).slice();
      const counter = comboCounterGlyph(node);
      if (counter) list.push(counter);
      list.forEach((glyph, i) => {
        if (!glyph) return;
        const at = glyphPosition(glyph, i, p, box ? Math.hypot(hw, hh) * 0.75 : r, s);
        drawGlyph(g, glyph, at.x, at.y, Math.min(hw, hh) * 0.32 * (glyph.e || 1), env);
      });
    };
    // Room the border takes outside the body. It always includes a default-width
    // border, so selecting a node (which adds one) never puts its label over the
    // selection ring, and the label does not jump when the node is selected.
    const edgePad = Math.max(lw, (rawNode.bw ?? DEFAULT_BORDER_WIDTH) * (rawNode.e || 1) * s);
    const drawLabels = () => {
      // One centred auto-sized label object uses the same fitting as a plain string.
      const one = Array.isArray(node.t) && node.t.length === 1 ? node.t[0] : node.t;
      const simple = one && typeof one === 'object' && one.fs === 'auto' && !one.position && !one.fi && !one.padding && !one.b;
      if (node.t != null && typeof node.t === 'object' && !simple) {
        const boxes = drawLabelObjects(g, node, p, { w: hw, h: hh }, s, env, edgePad);
        if (g === ctx) labelBoxes.set(node.id, boxes);
        return;
      }
      if (simple) node = { ...node, fc: one.fc ?? node.fc, fb: one.fb ?? node.fb, ff: one.ff ?? node.ff, fbc: one.fbc ?? node.fbc, t: one.t };
      const label = env.truncate(labelText(node));
      if (!label) return;
      const family = node.ff || chartOptions.fontFamily || 'sans-serif';
      const offset = (chartOptions.labelOffset || 0) * s;
      // Labels sit below the node when tc is false, or by default on image nodes.
      const below = node.tc === false || (node.tc === undefined && node.u);
      if (below) {
        drawTextBox(g, label, p.x, p.y + hh + edgePad + (node.fs || 14) * s * 0.6 + offset, { fs: node.fs || 14, fc: node.fc || '#000', fbc: node.fbc, ff: family, fb: node.fb }, s, env);
        return;
      }
      let lines;
      let fontPx;
      if (node.fs) { lines = label.split(/\r\n|\r|\n/); fontPx = node.fs * s; } else ({ lines, fontPx } = fitLabel(g, label, Math.min(hw, hh), family));
      if (fontPx < MIN_LABEL_PX) return;
      g.font = `${node.fb ? 'bold ' : ''}${fontPx}px ${family}`;
      if (node.fbc) {
        const wMax = Math.max(...lines.map(l => g.measureText(l).width));
        const hTot = lines.length * LABEL_LINE_ADVANCE * fontPx;
        g.fillStyle = node.fbc;
        g.fillRect(p.x - wMax / 2 - 2, p.y - hTot / 2 + offset, wMax + 4, hTot);
      }
      g.fillStyle = node.fc || (isComboNode(node) ? '#37474f' : '#000000');
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const top = (-lines.length * LABEL_BLOCK_LINE) / 2 + LABEL_BASELINE;
      lines.forEach((line, i) => g.fillText(line, p.x, p.y + (top + i * LABEL_LINE_ADVANCE) * fontPx + offset));
    };
    // By default labels draw over glyphs; legacyGlyphAndLabelOrdering: false flips it.
    // 3D: a label too small to read is clutter; the selected node keeps its label.
    const labels = !is3D() || selected || r >= labelMin3D() ? drawLabels : () => {};
    if (chartOptions.legacyGlyphAndLabelOrdering === false) { labels(); drawGlyphs(); } else { drawGlyphs(); labels(); }

    if (node.bu) {
      const dir = COMPASS[node.bu.p || 'ne'];
      drawBubble(g, node.bu, p.x + dir[0] * hw, p.y + dir[1] * hh, s, env);
    }
    g.globalAlpha = 1;
  }

  /* ---- hit testing ---- */
  function hitTest(sx, sy) {
    const size = viewSize();
    const visible = visibleIds();
    // Closed nodes on top of open combos; smallest distance wins.
    let best = null; let bestD = Infinity;
    visible.forEach(id => {
      const node = nodes[id];
      if (isComboNode(node) && node._combo.open) return;
      const p = placeNode(node, view, size);
      if (!p) return;
      const inside = isBox(node) ? Math.abs(p.x - sx) <= p.hw && Math.abs(p.y - sy) <= p.hh : Math.hypot(p.x - sx, p.y - sy) <= p.r;
      // In 3D the nearest node under the pointer wins; in 2D the closest centre.
      const d = is3D() ? p.depth : Math.hypot(p.x - sx, p.y - sy);
      if (inside && d < bestD) { bestD = d; best = id; }
    });
    if (best) return best;
    // Links: distance to the straight segment between drawn ends.
    let linkHit = null; let linkD = 6;
    Object.values(links).forEach(link => {
      if (link.hi || !nodes[link.id1] || !nodes[link.id2]) return;
      const e1 = visibleEnd(nodes, link.id1);
      const e2 = visibleEnd(nodes, link.id2);
      if (e1 === e2 || !isNodeVisible(nodes, e1) || !isNodeVisible(nodes, e2)) return;
      const a = placeNode(nodes[e1], view, size);
      const b = placeNode(nodes[e2], view, size);
      if (!a || !b) return;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - sx, a.y + t * dy - sy);
      if (d < linkD) { linkD = d; linkHit = link.id; }
    });
    if (linkHit) return linkHit;
    // Open combos last, so their contents stay clickable.
    visible.forEach(id => {
      const node = nodes[id];
      if (!(isComboNode(node) && node._combo.open)) return;
      const p = placeNode(node, view, size);
      if (p && Math.hypot(p.x - sx, p.y - sy) <= p.r) best = id;
    });
    return best;
  }

  /* ---- view changes ---- */
  let viewAnim = null;
  const MAX_ZOOM = 16;
  const clampZoom = z => Math.min(Math.max(z, chartOptions.minZoom ?? 0.05), MAX_ZOOM);
  function setView(rawTarget, opts = {}) {
    const { camera: camTo, ...target } = { ...rawTarget, zoom: clampZoom(rawTarget.zoom) };
    if (viewAnim) { cancelAnimationFrame(viewAnim.raf); viewAnim.resolve(); viewAnim = null; }
    if (!opts.animate) {
      if (camTo) camera.set(camTo);
      Object.assign(view, target);
      render();
      events.emit('view-change');
      return Promise.resolve();
    }
    const from = { ...view };
    const camFrom = camera.state;
    const time = opts.time ?? 250;
    const start = performance.now();
    return new Promise(resolve => {
      viewAnim = { resolve, raf: 0 };
      const frame = now => {
        const k = Math.min(1, Math.max(0, (now - start) / time));
        const e = k * k * (3 - 2 * k);
        // Interpolate zoom geometrically so zooming feels even.
        view.zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
        view.panX = from.panX + (target.panX - from.panX) * e;
        view.panY = from.panY + (target.panY - from.panY) * e;
        if (camTo) {
          const step = {};
          Object.keys(camTo).forEach(k => { if (Number.isFinite(camTo[k])) step[k] = camFrom[k] + (camTo[k] - camFrom[k]) * e; });
          camera.set(step);
        }
        render();
        if (k < 1) viewAnim.raf = requestAnimationFrame(frame);
        else { viewAnim = null; events.emit('view-change'); resolve(); }
      };
      viewAnim.raf = requestAnimationFrame(frame);
    });
  }

  function fitTo(ids, opts, heightOnly = false) {
    if (mapMode.isShown()) { mapMode.fit(); return Promise.resolve(); }
    return setView(fitView(ids.length ? ids : visibleIds(), viewSize(), heightOnly, true), opts);
  }

  /** Navigation arrow in 3D: turn the camera a fixed step. */
  const ORBIT_STEP = Math.PI / 8;
  function orbitStep(direction) {
    const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
    if (!d) return Promise.resolve();
    const c = camera.state;
    return setView({ ...view, camera: { yaw: c.yaw + d[0] * ORBIT_STEP, pitch: c.pitch + d[1] * ORBIT_STEP } }, { animate: true, time: 200 });
  }

  // Also right in 3D: toWorld gives pivot-plane coordinates there, which is what pan is measured in.
  function zoomAround(sx, sy, factor, opts) {
    const before = toWorld(sx, sy);
    const zoom = clampZoom(view.zoom * factor);
    const size = viewSize();
    const panX = (sx - size.w / 2) / zoom - before.x;
    const panY = (sy - size.h / 2) / zoom - before.y;
    return setView({ zoom, panX, panY }, opts);
  }

  /* ---- position animation (shared by animateProperties and layouts) ---- */
  function afterMove(node) {
    if (isComboNode(node)) syncChildren(nodes, node.id);
    const parent = nodes[node.parentId];
    if (parent && isComboNode(parent) && parent._combo.offsets[node.id]) {
      Object.assign(parent._combo.offsets[node.id], comboOffset(parent, node));
    }
  }

  let animationQueue = Promise.resolve();
  function animateProperties(items, opts = {}) {
    const settings = { time: 500, queue: true, easing: 'linear', ...opts };
    if (!settings.queue) return runAnimation(items, settings);
    const run = animationQueue.then(() => runAnimation(items, settings));
    // A failed animation must not block every animation queued after it.
    animationQueue = run.catch(() => {});
    return run;
  }

  function runAnimation(items, settings) {
    const list = asList(items);
    const startAt = performance.now();
    // Numeric props tween; everything else (colours, halos) applies at once.
    const tweens = list.map(update => {
      const target = update && (nodes[update.id] || links[update.id]);
      if (!target) return null;
      const numeric = {};
      ['e', 'w', 'x', 'y', 'z'].forEach(key => {
        if (typeof update[key] === 'number') numeric[key] = { from: target[key] ?? (key === 'e' || key === 'w' ? 1 : 0), to: update[key] };
      });
      Object.keys(update).forEach(key => {
        if (key === 'id' || key in numeric) return;
        target[key] = update[key];
      });
      return { target, numeric };
    }).filter(Boolean);

    return new Promise((resolve, reject) => {
      function frame(now) {
        try { step(now); } catch (err) { reject(err); }
      }
      function step(now) {
        // rAF's `now` can predate `startAt`; clamp so the tween never extrapolates.
        const t = settings.time > 0 ? Math.min(1, Math.max(0, (now - startAt) / settings.time)) : 1;
        const ease = settings.easing === 'cubic' ? t * t * (3 - 2 * t) : t;
        tweens.forEach(({ target, numeric }) => {
          Object.keys(numeric).forEach(key => {
            const { from, to } = numeric[key];
            target[key] = from + (to - from) * ease;
          });
          if (target.type !== 'link') afterMove(target);
        });
        render();
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /** Moves nodes to `targets` ({ id: {x, y} }), animated unless `animate === false`. */
  function moveNodes(targets, opts = {}) {
    const updates = Object.keys(targets).map(id => {
      const u = { id, x: targets[id].x, y: targets[id].y };
      if (typeof targets[id].z === 'number') u.z = targets[id].z;
      return u;
    });
    if (opts.animate === false) {
      updates.forEach(u => { Object.assign(nodes[u.id], u); afterMove(nodes[u.id]); });
      render();
      return Promise.resolve();
    }
    return runAnimation(updates, { time: opts.time ?? 500, easing: opts.easing || 'cubic' });
  }

  /* ---- pointer interaction ---- */
  /** { type: 'label', index } when (x, y) is on one of node `id`'s label objects (topmost wins). */
  function labelSubItem(id, x, y) {
    const hit = (labelBoxes.get(id) || []).filter(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h).pop();
    return hit ? { type: 'label', index: hit.index } : {};
  }

  function pointerProps(evt, id) {
    const rect = canvas.getBoundingClientRect();
    return {
      id: id ?? null,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      button: evt.button ?? 0,
      pointerType: evt.pointerType || 'mouse',
      pointerId: evt.pointerId ?? 1,
      subItem: id ? labelSubItem(id, evt.clientX - rect.left, evt.clientY - rect.top) : {},
      modifierKeys: { alt: evt.altKey, ctrl: evt.ctrlKey, meta: evt.metaKey, shift: evt.shiftKey, consistentCtrl: navigator.platform?.startsWith('Mac') ? evt.metaKey : evt.ctrlKey },
    };
  }

  function setSelection(ids, fromUser) {
    const next = asList(ids).filter(id => nodes[id] || links[id]);
    const same = next.length === selection.length && next.every((id, i) => id === selection[i]);
    selection = next;
    render();
    if (fromUser && !same) events.emit('selection-change');
  }

  canvas.addEventListener('pointerdown', evt => {
    if (destroyed) return;
    canvas.focus({ preventScroll: true });
    const rect = canvas.getBoundingClientRect();
    const sx = evt.clientX - rect.left;
    const sy = evt.clientY - rect.top;
    // On-screen controls take the press before anything on the chart.
    if (!mapMode.isShown() && !locked) {
      const button = hitButton(navigationLayout(viewSize(), chartOptions), sx, sy);
      if (button) {
        if (button.id === 'in' || button.id === 'out' || button.id === 'fit') api.zoom(button.id, { animate: true, time: 200 });
        else if (is3D()) orbitStep(button.id);
        else api.pan(button.id, { animate: true, time: 200 });
        return;
      }
      const ov = overviewBox || overviewLayout(viewSize(), chartOptions, overviewOpen);
      if (ov && sx >= ov.x && sx <= ov.x + ov.w && sy >= ov.y && sy <= ov.y + ov.h) {
        if (!ov.open) overviewOpen = true;
        else if (ov.toWorld) {
          const c = ov.toWorld(sx, sy);
          // 3D too: the overview is in pivot-plane coordinates, the space pan is measured in.
          setView({ zoom: view.zoom, panX: -c.x, panY: -c.y }, { animate: true, time: 200 });
        }
        if (!ov.open) render();
        return;
      }
    }
    const id = hitTest(sx, sy);
    const props = pointerProps(evt, id);
    // Right button: ignored in 2D; in 3D it pans from anywhere (left rotates).
    if (events.emit('pointer-down', props) || locked || (evt.button === 2 && !is3D())) return;
    canvas.setPointerCapture(evt.pointerId);
    if (evt.button === 2) {
      gesture = { kind: 'pan', id, x0: sx, y0: sy, x1: sx, y1: sy, moved: false, props, start: [], view: { ...view }, cam: camera.state, right: true };
      return;
    }

    if (pendingLink) {
      gesture = { kind: 'createLink', source: pendingLink.source, x0: sx, y0: sy, x1: sx, y1: sy, moved: false };
      return;
    }

    const node = id && nodes[id];
    if (id) {
      // Selection: plain press selects; shift/ctrl toggles.
      const additive = props.modifierKeys.shift || props.modifierKeys.consistentCtrl;
      if (additive) setSelection(selection.includes(id) ? selection.filter(s => s !== id) : [...selection, id], true);
      else if (!selection.includes(id)) setSelection([id], true);
    }

    const dragLinks = !chartOptions.drag || chartOptions.drag.links !== false;
    let kind;
    if (node) kind = 'node';
    else if (id && dragLinks) kind = 'node'; // dragging a link moves its ends
    // 3D: left drag orbits (hand mode or not), shift-drag pans, alt-drag draws a marquee.
    else if (is3D() && !evt.altKey) kind = evt.shiftKey ? 'pan' : 'orbit';
    else kind = chartOptions.handMode || mapMode.isShown() ? 'pan' : 'marquee';

    let dragged = [];
    if (kind === 'node') {
      const base = node ? (selection.includes(id) ? selection : [id]) : [links[id].id1, links[id].id2];
      dragged = base.filter(n => nodes[n] && isNodeVisible(nodes, n));
    }
    gesture = {
      kind, id, x0: sx, y0: sy, x1: sx, y1: sy, moved: false, props,
      start: dragged.map(n => {
        const s = { id: n, x: nodes[n].x || 0, y: nodes[n].y || 0 };
        // 3D drags move each node in the plane facing the camera, at its own depth.
        const p = is3D() && placeNode(nodes[n]);
        if (p) Object.assign(s, { offX: p.x - sx, offY: p.y - sy, depth: p.depth });
        return s;
      }),
      view: { ...view },
      cam: camera.state,
    };
  });

  let hoverTimer = null;
  canvas.addEventListener('pointermove', evt => {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const sx = evt.clientX - rect.left;
    const sy = evt.clientY - rect.top;
    if (!gesture) {
      const id = hitTest(sx, sy);
      if (id !== hoverId) {
        hoverId = id;
        canvas.style.cursor = id ? 'pointer' : '';
        const props = pointerProps(evt, id);
        if (chartOptions.truncateLabels) render();
        clearTimeout(hoverTimer);
        const delay = chartOptions.hover ?? 150;
        if (delay > 0) hoverTimer = setTimeout(() => { if (hoverId === id) events.emit('hover', props); }, delay);
        else events.emit('hover', props);
      }
      if (events.has('pointer-move')) events.emit('pointer-move', pointerProps(evt, id));
      return;
    }
    if (!gesture.moved && Math.hypot(sx - gesture.x0, sy - gesture.y0) < 3) return;
    if (!gesture.moved) {
      gesture.moved = true;
      if (gesture.kind !== 'createLink' && events.emit('drag-start', { ...gesture.props, type: gesture.kind === 'node' ? 'move' : gesture.kind })) {
        gesture = null;
        return;
      }
    }
    gesture.x1 = sx;
    gesture.y1 = sy;
    if (gesture.kind === 'node' && !mapMode.isShown() && chartOptions.dragPan !== false && chartOptions.panAtBoundary !== false) {
      const edge = 24;
      const size = viewSize();
      const px = sx < edge ? 10 : sx > size.w - edge ? -10 : 0;
      const py = sy < edge ? 10 : sy > size.h - edge ? -10 : 0;
      if (px || py) {
        // Shift the view, and the gesture origin with it, so the dragged node stays under the pointer.
        view.panX += px / view.zoom;
        view.panY += py / view.zoom;
        gesture.x0 += px;
        gesture.y0 += py;
        events.emit('view-change');
      }
    }
    const dx = sx - gesture.x0;
    const dy = sy - gesture.y0;
    if (gesture.kind === 'node') {
      gesture.start.forEach(s => {
        const n = nodes[s.id];
        if (!n) return; // removed during the drag
        if (mapMode.isShown()) {
          if (!n.pos) return; // not on the map: leave it unplaced
          const p = mapMode.project({ pos: n.pos }) || { x: sx, y: sy };
          mapMode.moveNodeTo(n, p.x + evt.movementX, p.y + evt.movementY);
        } else if (is3D() && s.depth !== undefined) {
          const w = camera.unproject(sx + s.offX, sy + s.offY, s.depth, view, viewSize());
          n.x = w.x; n.y = w.y; n.z = w.z;
          afterMove(n);
        } else {
          n.x = s.x + dx / view.zoom;
          n.y = s.y + dy / view.zoom;
          afterMove(n);
        }
      });
      render();
    } else if (gesture.kind === 'pan') {
      if (mapMode.isShown()) mapMode.panBy(evt.movementX, evt.movementY);
      else { view.panX = gesture.view.panX + dx / view.zoom; view.panY = gesture.view.panY + dy / view.zoom; render(); }
    } else if (gesture.kind === 'orbit') {
      camera.set(gesture.cam);
      camera.orbit(dx, dy);
      render();
    } else {
      render();
    }
    events.emit('drag-move', { ...pointerProps(evt, gesture.id), type: gesture.kind });
  });

  function endGesture(evt) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    const rect = canvas.getBoundingClientRect();
    const sx = evt.clientX - rect.left;
    const sy = evt.clientY - rect.top;
    const target = hitTest(sx, sy);
    const props = pointerProps(evt, target);

    if (g.kind === 'createLink') {
      const done = pendingLink;
      pendingLink = null;
      const ok = target && nodes[target] && target !== done.source;
      if (ok) {
        links[done.linkId] = { type: 'link', id: done.linkId, id1: done.source, id2: target, c: '#555', w: 2, ...(done.style || {}) };
        changed();
      } else render();
      done.resolve(ok ? target : null);
      return;
    }

    if (g.moved) {
      if (g.kind === 'marquee') {
        const [x0, x1] = [Math.min(g.x0, g.x1), Math.max(g.x0, g.x1)];
        const [y0, y1] = [Math.min(g.y0, g.y1), Math.max(g.y0, g.y1)];
        const inside = visibleIds().filter(id => {
          const p = placeNode(nodes[id]);
          return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
        });
        const mode = chartOptions.marqueeLinkSelection || 'centre';
        const inRect = q => q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        if (mode !== 'off') {
          Object.values(links).forEach(l => {
            if (l.hi || !isNodeVisible(nodes, l.id1) || !isNodeVisible(nodes, l.id2)) return;
            const a = placeNode(nodes[l.id1]);
            const b = placeNode(nodes[l.id2]);
            if (!a || !b) return;
            const ok = mode === 'ends' ? inRect(a) && inRect(b) : inRect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            if (ok) inside.push(l.id);
          });
        }
        const additive = props.modifierKeys.shift || props.modifierKeys.consistentCtrl;
        setSelection(additive ? [...new Set([...selection, ...inside])] : inside, true);
      }
      if (g.kind === 'pan' || g.kind === 'orbit') events.emit('view-change');
      if (g.kind === 'node' && target && !g.start.some(s => s.id === target)) events.emit('drag-over', { ...props, type: 'move' });
      if (g.kind === 'node') events.emit('prechange', { type: 'move' });
      events.emit('drag-end', { ...props, type: g.kind === 'node' ? 'move' : g.kind });
      if (g.kind === 'node') graphFacade.reload();
      render();
    } else if (!g.right) {
      // A press without movement is a click (a still right press is a context-menu, not a click).
      if (!events.emit('click', props) && !target && !locked) setSelection([], true);
    }
    events.emit('pointer-up', props);
  }
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);

  canvas.addEventListener('dblclick', evt => {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const id = hitTest(evt.clientX - rect.left, evt.clientY - rect.top);
    const props = pointerProps(evt, id);
    if (events.emit('double-click', props) || locked) return;
    if (id && isComboNode(nodes[id])) {
      if (nodes[id]._combo.open) combos.api.close(id); else combos.api.open(id);
    } else if (!id) {
      zoomAround(props.x, props.y, 1.6, { animate: true, time: 200 });
    }
  });

  canvas.addEventListener('contextmenu', evt => {
    const rect = canvas.getBoundingClientRect();
    const id = hitTest(evt.clientX - rect.left, evt.clientY - rect.top);
    // In 3D the right button pans, so the browser menu would get in the way.
    if (events.emit('context-menu', pointerProps(evt, id)) || is3D()) evt.preventDefault();
  });

  canvas.addEventListener('wheel', evt => {
    if (destroyed) return;
    const props = { ...pointerProps(evt, null), deltaX: evt.deltaX, deltaY: evt.deltaY, deltaZ: evt.deltaZ };
    if (events.emit('wheel', props) || locked) return;
    if (chartOptions.navigation && chartOptions.navigation.wheel === false) return;
    evt.preventDefault();
    if (mapMode.isShown()) { mapMode.zoomAt(props.x, props.y, evt.deltaY); return; }
    zoomAround(props.x, props.y, Math.pow(1.0015, -evt.deltaY), {});
  }, { passive: false });

  const keyProps = evt => ({
    keyCode: evt.keyCode, key: evt.key, code: evt.code,
    modifierKeys: { alt: evt.altKey, ctrl: evt.ctrlKey, meta: evt.metaKey, shift: evt.shiftKey, consistentCtrl: evt.ctrlKey || evt.metaKey },
  });
  canvas.addEventListener('keydown', evt => {
    if (events.emit('key-down', keyProps(evt))) { evt.preventDefault(); return; }
    if (locked) return;
    const panBy = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[evt.key];
    if (panBy) {
      evt.preventDefault();
      setView({ zoom: view.zoom, panX: view.panX + panBy[0] / view.zoom, panY: view.panY + panBy[1] / view.zoom });
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && selection.length && events.has('delete')) {
      events.emit('delete');
    }
  });
  canvas.addEventListener('keyup', evt => { if (events.emit('key-up', keyProps(evt))) evt.preventDefault(); });

  let resizeRaf = null;
  const onResize = () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(render);
  };
  window.addEventListener('resize', onResize);

  /* ---- ping ticker ---- */
  let pingRaf = null;
  function tickPings() {
    const now = performance.now();
    pings = pings.filter(p => {
      if (now - p.start < p.time * p.repeat) return true;
      p.resolve();
      return false;
    });
    render();
    pingRaf = pings.length ? requestAnimationFrame(tickPings) : null;
  }

  /* ---- export ---- */
  /** View for an export of w x h: 'chart'/'exact' fit everything, 'oneToOne' keeps zoom 1, 'view' scales the screen view. */
  function exportView(mode, w, h) {
    const size = viewSize();
    if (mode === 'chart' || mode === 'exact') return fitView(visibleIds(), { w, h });
    if (mode === 'oneToOne') return { ...view, zoom: 1 };
    const s = Math.min(w / size.w, h / size.h);
    return { zoom: view.zoom * s, panX: view.panX, panY: view.panY };
  }

  function renderOffscreen(width, height, mode, withSelection, extra = {}) {
    const size = viewSize();
    const w = Math.max(1, Math.round(width || size.w));
    const h = Math.max(1, Math.round(height || size.h));
    let v;
    if (mode === 'chart' || mode === 'exact') v = fitView(visibleIds(), { w, h });
    else if (mode === 'oneToOne') v = { ...view, zoom: 1 };
    else {
      // 'view': same world window as on screen, scaled into w x h.
      const s = Math.min(w / size.w, h / size.h);
      v = { zoom: view.zoom * s, panX: view.panX, panY: view.panY };
    }
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d');
    drawScene(g, { w, h }, v, { selection: withSelection, overlays: false, ...extra });
    return { canvas: off, w, h, v };
  }

  function exportSize(opts) {
    const size = viewSize();
    if (opts.fitTo && typeof opts.fitTo === 'object') {
      const { width, height } = opts.fitTo;
      const aspect = size.w / size.h;
      if (width && height) return { w: width, h: height };
      if (width) return { w: width, h: width / aspect };
      if (height) return { w: height * aspect, h: height };
    }
    if (opts.fitTo === 'page') return { w: 595, h: 842 }; // A4 portrait, points
    return size;
  }

  /** Every image URL the chart draws: node images, glyph images, watermark and logo. */
  function imageUrls() {
    const urls = [];
    [...Object.values(nodes), ...Object.values(links)].forEach(item => {
      if (item.u) urls.push(item.u);
      asList(item.g).forEach(gl => gl && gl.u && urls.push(gl.u));
    });
    if (chartOptions.watermark && chartOptions.watermark.u) urls.push(chartOptions.watermark.u);
    if (chartOptions.logo && chartOptions.logo.u) urls.push(chartOptions.logo.u);
    return urls;
  }

  const toBlob = (c, type, quality) => new Promise(resolve => c.toBlob(resolve, type, quality));

  /* ---- public API ---- */
  const api = {
    load(data) {
      const indexed = indexItems(data);
      nodes = indexed.nodes;
      links = indexed.links;
      selection = [];
      changed();
      return Promise.resolve();
    },

    merge(items) {
      const indexed = indexItems(items);
      Object.values(indexed.nodes).forEach(n => { nodes[n.id] = { ...(nodes[n.id] || {}), ...n }; });
      Object.values(indexed.links).forEach(l => { links[l.id] = { ...(links[l.id] || {}), ...l }; });
      changed();
      return Promise.resolve();
    },

    expand(items, opts = {}) {
      const indexed = indexItems(items);
      // New nodes start beside an existing neighbour so the layout only adjusts.
      Object.values(indexed.nodes).forEach(n => {
        if (nodes[n.id] || typeof n.x === 'number') return;
        const neighbour = Object.values(indexed.links).map(l => (l.id1 === n.id ? l.id2 : l.id2 === n.id ? l.id1 : null)).find(id => id && nodes[id]);
        const at = neighbour ? nodes[neighbour] : { x: 0, y: 0 };
        n.x = (at.x || 0) + (Math.random() - 0.5) * DEFAULT_NODE_RADIUS * 4;
        n.y = (at.y || 0) + (Math.random() - 0.5) * DEFAULT_NODE_RADIUS * 4;
      });
      const existing = new Set(Object.keys(nodes));
      return api.merge(items).then(() => {
        const layout = opts.layout || {};
        const name = layout.name || 'organic';
        // `fix` (organic): which existing nodes keep their place.
        const fix = layout.fix || 'adaptive';
        let fixed;
        if (fix !== 'adaptive' && name === 'organic') {
          const touched = new Set();
          Object.values(indexed.links).forEach(l => {
            if (existing.has(l.id1) && !existing.has(l.id2)) touched.add(l.id1);
            if (existing.has(l.id2) && !existing.has(l.id1)) touched.add(l.id2);
            if (existing.has(l.id1) && existing.has(l.id2) && !links[l.id]) { touched.add(l.id1); touched.add(l.id2); }
          });
          const all = [...existing].filter(id => nodes[id]);
          fixed = fix === 'all' ? all : fix === 'adjacent' ? all.filter(id => touched.has(id)) : fix === 'nonadjacent' ? all.filter(id => !touched.has(id)) : [];
        }
        return api.layout(name, {
          mode: 'adaptive', ...layout, ...(fixed ? { fixed, mode: fixed.length ? 'adaptive' : 'full' } : {}),
          animate: opts.animate, time: opts.time, fit: layout.fit ?? true,
        });
      });
    },

    removeItem(ids) {
      asList(ids).forEach(id => {
        if (links[id]) { delete links[id]; return; }
        if (!nodes[id]) return;
        const gone = [id, ...(isComboNode(nodes[id]) ? descendants(nodes, id) : [])];
        const parent = nodes[nodes[id].parentId];
        if (parent && isComboNode(parent)) delete parent._combo.offsets[id];
        gone.forEach(n => delete nodes[n]);
        Object.values(links).forEach(l => { if (!nodes[l.id1] || !nodes[l.id2]) delete links[l.id]; });
      });
      selection = selection.filter(id => nodes[id] || links[id]);
      changed();
    },

    setItem(item) {
      if (!item || item.id == null) return Promise.reject(new Error('setItem: item must have an id'));
      if (item.type === 'link') {
        if (!nodes[item.id1] || !nodes[item.id2]) return Promise.reject(new Error(`setItem: link ${item.id} refers to a missing node`));
        links[item.id] = { ...item };
      } else {
        const old = nodes[item.id];
        // Replacing a combo keeps its combo state (children, open/closed).
        nodes[item.id] = { type: 'node', ...item, ...(old && old._combo ? { _combo: old._combo } : {}) };
      }
      changed();
      return Promise.resolve();
    },

    getItem(id) {
      const one = i => nodes[i] || links[i] || null;
      return Array.isArray(id) ? id.map(one) : one(id);
    },

    clear() {
      nodes = {};
      links = {};
      selection = [];
      changed();
    },

    serialize() {
      const strip = item => {
        const copy = clone(item);
        delete copy._bg;
        return copy;
      };
      return { type: 'LinkChart', items: [...Object.values(nodes), ...Object.values(links)].map(strip) };
    },

    each(query, visit) {
      const type = (query && query.type) || 'all';
      const scope = (query && query.items) || 'toplevel';
      const keep = item => {
        if (scope === 'underlying' && isComboNode(item)) return false;
        if (scope === 'toplevel' && item.type !== 'link' && item.parentId != null) return false;
        return true;
      };
      if (type !== 'link') Object.values(nodes).filter(keep).forEach(n => visit(n));
      if (type !== 'node') Object.values(links).forEach(l => visit(l));
    },

    graph: () => graphFacade,
    combo: () => comboApiWithPrechange,
    map: () => mapMode.api,

    selection(ids) {
      if (ids === undefined) return selection.slice();
      setSelection(ids, false);
      return selection.slice();
    },

    setProperties(props, useRegEx) {
      asList(props).forEach(update => {
        if (!update || update.id === undefined) return;
        let targets;
        if (useRegEx) {
          const re = new RegExp(update.id);
          targets = [...Object.values(nodes), ...Object.values(links)].filter(item => re.test(item.id));
        } else {
          targets = [nodes[update.id] || links[update.id]].filter(Boolean);
          // Aggregate links are drawn, not stored: keep their style for the next draw.
          if (!targets.length && aggregates.has(update.id)) {
            const style = aggStyles.get(update.id) || {};
            Object.keys(update).forEach(key => { if (key !== 'id') style[key] = update[key] === null ? undefined : update[key]; });
            aggStyles.set(update.id, style);
          }
        }
        targets.forEach(target => {
          Object.keys(update).forEach(key => {
            if (key === 'id') return;
            if (update[key] === null) delete target[key];
            else target[key] = update[key];
          });
          if (target.type !== 'link' && ('x' in update || 'y' in update)) afterMove(target);
        });
      });
      changed();
      return Promise.resolve();
    },

    animateProperties,

    hide(ids) {
      asList(ids).forEach(id => { const item = nodes[id] || links[id]; if (item) { item.hi = true; delete item._singleton; } });
      changed();
      return Promise.resolve();
    },

    show(ids, showLinks = false) {
      const list = asList(ids);
      list.forEach(id => { const item = nodes[id] || links[id]; if (item) { delete item.hi; delete item._singleton; } });
      if (showLinks) {
        const set = new Set(list);
        Object.values(links).forEach(l => {
          if ((set.has(l.id1) || set.has(l.id2)) && !nodes[l.id1]?.hi && !nodes[l.id2]?.hi) delete l.hi;
        });
      }
      changed();
      return Promise.resolve();
    },

    filter(fn, opts = {}) {
      const type = opts.type || 'node';
      const result = { shown: { nodes: [], links: [] }, hidden: { nodes: [], links: [] }, combos: { nodes: [], links: [] } };
      if (type !== 'link') {
        Object.values(nodes).forEach(n => {
          if (isComboNode(n)) return;
          delete n._singleton;
          if (fn(n)) delete n.hi; else n.hi = true;
        });
      } else {
        // Link filters do not judge nodes, but nodes an earlier pass hid only for having no visible
        // links must be judged again, or widening the filter could never bring them back.
        Object.values(nodes).forEach(n => { if (n._singleton) { delete n.hi; delete n._singleton; } });
      }
      Object.values(links).forEach(l => {
        const endsShown = !nodes[l.id1]?.hi && !nodes[l.id2]?.hi;
        const pass = type === 'node' ? true : fn(l);
        if (pass && endsShown) delete l.hi; else l.hi = true;
      });
      if (opts.hideSingletons) {
        const linked = new Set();
        Object.values(links).forEach(l => { if (!l.hi) { linked.add(l.id1); linked.add(l.id2); } });
        Object.values(nodes).forEach(n => { if (!isComboNode(n) && !n.hi && !linked.has(n.id)) { n.hi = true; n._singleton = true; } });
      }
      Object.values(nodes).forEach(n => { if (!isComboNode(n)) result[n.hi ? 'hidden' : 'shown'].nodes.push(n.id); });
      Object.values(links).forEach(l => result[l.hi ? 'hidden' : 'shown'].links.push(l.id));
      changed();
      return Promise.resolve(result);
    },

    foreground(fn, opts = {}) {
      const type = opts.type || 'node';
      const result = { foreground: { nodes: [], links: [] }, background: { nodes: [], links: [] } };
      Object.values(nodes).forEach(n => {
        const fg = type === 'link' ? true : !!fn(n);
        if (fg) delete n._bg; else n._bg = true;
        result[fg ? 'foreground' : 'background'].nodes.push(n.id);
      });
      Object.values(links).forEach(l => {
        const fg = type === 'node' ? !nodes[l.id1]?._bg && !nodes[l.id2]?._bg : !!fn(l);
        if (fg) delete l._bg; else l._bg = true;
        result[fg ? 'foreground' : 'background'].links.push(l.id);
      });
      // With type 'link', a node stays foreground if any of its links is.
      if (type === 'link') {
        const keep = new Set();
        Object.values(links).forEach(l => { if (!l._bg) { keep.add(l.id1); keep.add(l.id2); } });
        result.foreground.nodes = [];
        result.background.nodes = [];
        Object.values(nodes).forEach(n => {
          const fg = keep.has(n.id);
          if (fg) delete n._bg; else n._bg = true;
          result[fg ? 'foreground' : 'background'].nodes.push(n.id);
        });
      }
      render();
      return Promise.resolve(result);
    },

    ping(ids, opts = {}) {
      const list = asList(ids).filter(id => nodes[id]);
      const done = list.map(id => new Promise(resolve => {
        pings.push({
          id, start: performance.now(), resolve,
          c: opts.c || '#2196f3', r: opts.r ?? 80, w: opts.w ?? 20, lw: opts.lw ?? 4,
          time: opts.time ?? 800, repeat: Math.max(1, opts.repeat ?? 1),
        });
      }));
      if (!pingRaf && pings.length) pingRaf = requestAnimationFrame(tickPings);
      return Promise.all(done).then(() => undefined);
    },

    lock(val) {
      if (val !== undefined) {
        locked = !!val;
        canvas.style.cursor = locked ? (chartOptions.lockCursor || 'wait') : '';
      }
      return locked;
    },

    labelPosition(id) {
      const node = nodes[id];
      if (!node || !isNodeVisible(nodes, id) || !labelText(node)) return null;
      const p = placeNode(node);
      if (!p) return null;
      const fs = p.r * 0.36;
      ctx.font = `bold ${fs}px sans-serif`;
      const w = ctx.measureText(labelText(node)).width;
      return { x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - fs * 0.6, y2: p.y + fs * 0.6, fs };
    },

    getItemInfoAt(x, y) {
      const id = hitTest(x, y);
      return id ? { id, subItem: labelSubItem(id, x, y) } : undefined;
    },

    contains(shape) {
      const { x, y, w, h } = shape;
      return visibleIds().filter(id => {
        const n = nodes[id];
        const dx = (n.x || 0) - x;
        const dy = (n.y || 0) - y;
        return shape.sh === 'circle'
          ? (dx * dx) / ((w / 2) ** 2) + (dy * dy) / ((h / 2) ** 2) <= 1
          : Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2;
      });
    },

    /** 3D camera { yaw, pitch, focal } (radians, world units). Takes effect with options.view3d. */
    camera(next, opts = {}) {
      if (next && Number.isFinite(next.focal)) baseFocal = Math.max(1, next.focal);
      if (next !== undefined) setView({ ...view, camera: next }, opts);
      return camera.state;
    },

    viewCoordinates(x, y, z = 0) {
      if (!is3D()) return toScreen(x, y);
      const p = camera.project(x, y, z, view, viewSize());
      return p ? { x: p.x, y: p.y } : null;
    },
    // 3D: the world point under (x, y) on the plane through the orbit pivot.
    worldCoordinates(x, y) { return is3D() ? camera.unproject(x, y, 0, view, viewSize()) : toWorld(x, y); },

    viewOptions(next, transition = {}) {
      const size = viewSize();
      if (next === undefined) {
        return { zoom: view.zoom, offsetX: view.panX * view.zoom, offsetY: view.panY * view.zoom, width: size.w, height: size.h };
      }
      const zoom = next.zoom ?? view.zoom;
      const panX = next.offsetX !== undefined ? next.offsetX / zoom : view.panX;
      const panY = next.offsetY !== undefined ? next.offsetY / zoom : view.panY;
      return setView({ zoom, panX, panY }, transition);
    },

    zoom(how, opts = {}) {
      if (mapMode.isShown()) {
        if (how === 'in') mapMode.zoomBy(1);
        else if (how === 'out') mapMode.zoomBy(-1);
        else mapMode.fit();
        return Promise.resolve();
      }
      const size = viewSize();
      if (how === 'fit') return fitTo(asList(opts.ids).filter(id => nodes[id]), opts);
      if (how === 'height') return fitTo(asList(opts.ids).filter(id => nodes[id]), opts, true);
      if (how === 'selection') {
        const ids = selection.filter(id => nodes[id]);
        return ids.length ? fitTo(ids, opts) : Promise.resolve();
      }
      if (how === 'in') return zoomAround(size.w / 2, size.h / 2, ZOOM_STEP, opts);
      if (how === 'out') return zoomAround(size.w / 2, size.h / 2, 1 / ZOOM_STEP, opts);
      if (how === 'one') return setView({ zoom: 1, panX: view.panX, panY: view.panY }, opts);
      if (typeof how === 'number') return setView({ zoom: how, panX: view.panX, panY: view.panY }, opts);
      return Promise.reject(new Error(`zoom: unknown option ${how}`));
    },

    pan(direction, opts = {}) {
      const size = viewSize();
      const step = { up: [0, size.h / 3], down: [0, -size.h / 3], left: [size.w / 3, 0], right: [-size.w / 3, 0] }[direction];
      if (mapMode.isShown()) {
        if (step) mapMode.panBy(step[0], step[1]);
        return Promise.resolve();
      }
      if (step) return setView({ zoom: view.zoom, panX: view.panX + step[0] / view.zoom, panY: view.panY + step[1] / view.zoom }, opts);
      if (direction === 'selection') {
        const ids = selection.filter(id => nodes[id]);
        if (!ids.length) return Promise.resolve();
        if (is3D()) return setView({ zoom: view.zoom, panX: 0, panY: 0, camera: fitView3D(ids, viewSize(), false, true).camera }, opts);
        const b = boundsOf(ids);
        return setView({ zoom: view.zoom, panX: -(b.minX + b.maxX) / 2, panY: -(b.minY + b.maxY) / 2 }, opts);
      }
      return Promise.reject(new Error(`pan: unknown direction ${direction}`));
    },

    arrange(name, ids, opts = {}) {
      const work = {};
      Object.keys(nodes).forEach(id => { work[id] = { ...nodes[id] }; });
      try { arrangeNodes(name, work, links, asList(ids), opts); } catch (err) { return Promise.reject(err); }
      const targets = {};
      asList(ids).forEach(id => { if (work[id]) targets[id] = work[id]; });
      return moveNodes(targets, opts).then(() => (opts.fit ? fitTo(Object.keys(targets), { animate: opts.animate !== false }) : undefined));
    },

    layout(name = 'organic', opts = {}) {
      // Lay out what is drawn: visible nodes, with links rerouted to closed combos.
      const ids = visibleIds().filter(id => {
        const p = nodes[nodes[id].parentId];
        return !(p && isComboNode(p));
      });
      const work = {};
      ids.forEach(id => { work[id] = { ...nodes[id] }; });
      const routed = {};
      Object.values(links).forEach(l => {
        if (l.hi || !nodes[l.id1] || !nodes[l.id2]) return;
        const a = visibleEnd(nodes, l.id1);
        const b = visibleEnd(nodes, l.id2);
        if (a !== b && work[a] && work[b]) routed[l.id] = { ...l, id1: a, id2: b };
      });
      events.emit('progress', { task: 'layout', progress: 0 });
      const args = { dimensions: chartOptions.view3d ? 3 : 2, ...opts };
      const solve = () => { runLayout(name, work, routed, args); return work; };
      // Then: link shapes ('curved' leaves and enters nodes along the layout's axis for
      // hierarchy / sequential; `straighten`, the default, clears manual offsets), move, fit.
      const finish = placed => {
        // A worker layout is async: skip nodes and links removed meanwhile.
        const live = {};
        Object.keys(placed).forEach(id => { if (nodes[id]) live[id] = placed[id]; });
        const axis = (opts.orientation === 'left' || opts.orientation === 'right') ? 'horizontal' : 'vertical';
        const curved = opts.linkShape === 'curved' && (name === 'hierarchy' || name === 'sequential');
        Object.keys(routed).forEach(lid => {
          const link = links[lid];
          if (!link) return;
          if (curved) link._path = axis; else delete link._path;
          if (opts.straighten !== false) delete link.off;
        });
        const fit = opts.fit !== false;
        const animate = opts.animate !== false;
        return moveNodes(live, { animate, time: opts.time, easing: opts.easing }).then(() => {
          events.emit('progress', { task: 'layout', progress: 1 });
          return fit ? fitTo(ids.filter(id => nodes[id]), { animate, time: 300 }) : undefined;
        });
      };
      // Big layouts run in the worker so the page stays responsive; any failure there (no
      // worker, uncloneable data, an error) runs it here instead, so results match either way.
      if (ids.length >= LAYOUT_WORKER_MIN_NODES && typeof Worker !== 'undefined') {
        return runInWorker({ layout: name, nodes: work, links: routed, opts: args })
          .catch(() => solve())
          .then(placed => (destroyed ? undefined : finish(placed)));
      }
      try { solve(); } catch (err) { return Promise.reject(err); }
      return finish(work);
    },

    createLink(id, linkId, opts = {}) {
      if (!nodes[id]) return Promise.reject(new Error(`createLink: no node ${id}`));
      if (pendingLink) pendingLink.resolve(null);
      return new Promise(resolve => {
        pendingLink = { source: id, linkId, style: opts.style, resolve };
      });
    },

    getAggregateInfo(id) {
      const one = i => {
        const agg = aggregates.get(i);
        if (agg) {
          return { isAggregate: true, aggregateChildren: agg.children.slice(), aggregateDirection: agg.directed ? 'both' : 'none', aggregateByProp: undefined, parentAggregate: undefined };
        }
        for (const [aggId, a] of aggregates) {
          if (a.children.includes(i)) return { isAggregate: false, parentAggregate: aggId };
        }
        return null;
      };
      return Array.isArray(id) ? id.map(one) : one(id);
    },

    async toDataURL(width, height, opts = {}) {
      await waitForImages(imageUrls());
      const { canvas: off } = renderOffscreen(width, height, opts.fit || 'view', !!opts.selection, {
        logo: opts.logo !== false, watermark: opts.watermark !== false,
      });
      return Promise.resolve(off.toDataURL('image/png'));
    },

    async export(opts = {}) {
      const type = (opts.type || 'png').toLowerCase();
      const { w, h } = exportSize(opts);
      const mode = opts.extents === 'chart' ? 'chart' : 'view';
      const warnings = [];
      let blob;
      const W = Math.max(1, Math.round(w));
      const H = Math.max(1, Math.round(h));
      // Images that have not loaded yet would silently be missing from the export.
      const missing = await waitForImages(imageUrls());
      missing.forEach(url => warnings.push({ type: 'image', message: `Image not loaded, left out of export: ${url}` }));
      if (type === 'svg') {
        const svg = createSvgContext(W, H, ctx);
        drawScene(svg, { w: W, h: H }, exportView(mode, W, H), { selection: false, overlays: false });
        warnings.push(...svg.warnings);
        blob = new Blob([svg.toSvg()], { type: 'image/svg+xml' });
      } else if (type === 'png' || type === 'jpeg' || type === 'jpg') {
        const { canvas: off } = renderOffscreen(w, h, mode, false);
        blob = await toBlob(off, type === 'png' ? 'image/png' : 'image/jpeg', 0.92);
      } else if (type === 'pdf') {
        // Vector PDF: paths and text stay paths and text; images embed as JPEG.
        const pdf = createPdfContext(W, H, ctx);
        drawScene(pdf, { w: W, h: H }, exportView(mode, W, H), { selection: false, overlays: false });
        const bytes = await pdf.toPdf();
        warnings.push(...pdf.warnings);
        blob = new Blob([bytes], { type: 'application/pdf' });
      } else {
        throw new Error(`export: unsupported type ${opts.type}`);
      }
      return { url: URL.createObjectURL(blob), blob, warnings };
    },

    options(next) {
      if (next === undefined) return { ...chartOptions };
      chartOptions = { ...chartOptions, ...next };
      render();
      return Promise.resolve();
    },

    setContainer(element) {
      const target = typeof element === 'string' ? document.getElementById(element) : element;
      // The map and the WebGL layer live in the old container; drop them, render() rebuilds GL.
      if (mapMode.isShown()) mapMode.api.hide();
      if (gl) { gl.destroy(); gl = null; }
      if (!target) { canvas.remove(); return; }
      container = target;
      container.appendChild(canvas);
      render();
    },

    destroy() {
      if (destroyed) return;
      if (mapMode.isShown()) mapMode.api.hide();
      destroyed = true;
      window.removeEventListener('resize', onResize);
      if (pingRaf) cancelAnimationFrame(pingRaf);
      pings.forEach(p => p.resolve());
      pings = [];
      if (pendingLink) { pendingLink.resolve(null); pendingLink = null; }
      clearTimeout(hoverTimer);
      if (gl) { gl.destroy(); gl = null; }
      globals.renderers.delete(render);
      canvas.remove();
      events.clear();
      onDestroy();
      Object.keys(api).forEach(k => {
        if (k === 'destroy' || k === 'toString') return; // destroy stays a no-op
        api[k] = () => { throw new Error('This chart has been destroyed'); };
      });
    },

    on: events.on,
    off: events.off,
    bind: events.bind,
    unbind: events.unbind,
    toString: () => '[GraphNexus chart]',
  };

  globals.renderers.add(render);
  render();

  // Debug accessor for automated verification only; inert unless the page URL has `?debug`.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
    const registry = (window.__gnCharts = window.__gnCharts || []);
    registry.push({
      container,
      labelOf: id => labelText(nodes[id]),
      nodeState: () => Object.values(nodes).map(node => ({
        id: node.id, label: labelText(node), rawT: node.t, x: node.x, y: node.y, z: node.z, e: node.e || 1,
        selected: selection.includes(node.id), halo: !!(node.ha0 && node.ha0.c),
      })),
      view: () => ({ ...view }),
      selection: () => selection.slice(),
    });
  }

  // `prechange` fires before every API call that changes the chart.
  const PRECHANGE = {
    layout: 'layout', merge: 'merge', expand: 'expand', hide: 'hide', show: 'show', setProperties: 'properties',
    animateProperties: 'properties', setItem: 'properties', removeItem: 'delete', arrange: 'arrange', filter: 'hide',
  };
  Object.entries(PRECHANGE).forEach(([key, type]) => {
    const fn = api[key];
    api[key] = (...args) => { events.emit('prechange', { type }); return fn(...args); };
  });
  const COMBO_PRECHANGE = { combine: 'combine', uncombine: 'uncombine', open: 'open', close: 'close', transfer: 'transfer', arrange: 'arrange combo' };
  const comboApiWithPrechange = { ...combos.api };
  Object.entries(COMBO_PRECHANGE).forEach(([key, type]) => {
    comboApiWithPrechange[key] = (...args) => { events.emit('prechange', { type }); return combos.api[key](...args); };
  });

  return api;
}

/* ============================================================================
 * Public Graph Nexus surface
 * ==========================================================================*/

const components = {};
let componentCounter = 0;

function resolveElement(target) {
  if (typeof target === 'string') {
    const el = document.getElementById(target);
    if (!el) throw new Error(`Cannot create component. No element with id "${target}" exists in the DOM`);
    return el;
  }
  if (target && target.nodeType === 1) return target;
  throw new Error('create: a container id or element is required');
}

function createOne(def) {
  const definition = typeof def === 'string' || (def && def.nodeType === 1) ? { container: def } : def || {};
  const element = resolveElement(definition.container ?? definition.element ?? definition.id);
  const type = definition.type || 'chart';
  if (type !== 'chart' && type !== 'timebar' && type !== 'timeline') throw new Error(`The type of component passed to create is not valid: ${type}`);
  let id = definition.id && typeof definition.id === 'string' && definition.container ? definition.id : element.id;
  if (!id || components[id]) id = `${type}-${++componentCounter}`;
  const onDestroy = () => { delete components[id]; };
  const component = type === 'timebar'
    ? createTimebar(element, definition.options || {})
    : type === 'timeline'
      ? createTimelineEngine({ container: element, options: definition.options || {} })
      : createChart(element, definition.options || {}, onDestroy);
  if (type === 'timebar' || type === 'timeline') {
    const destroy = component.destroy;
    component.destroy = () => { destroy(); onDestroy(); };
  }
  components[id] = component;
  return component;
}

function createTimeline(definition) {
  if (definition && typeof definition === 'object' && definition.nodeType !== 1) {
    return createOne({ ...definition, type: 'timeline' });
  }
  return createOne({ container: definition, type: 'timeline' });
}

function create(definitions) {
  return new Promise((resolve, reject) => {
    try {
      const wasArray = Array.isArray(definitions);
      const list = wasArray ? definitions : [definitions];
      if (list.length < 1) throw new Error('No definition passed to create');
      const made = list.map(createOne);
      resolve(wasArray ? made : made[0]);
    } catch (error) {
      reject(error);
    }
  });
}

const base = {
  create,
  createTimeline: definition => withCallbacks(createTimeline(definition)),
  components,

  callbacks: () => GraphNexus,

  coords(evt) {
    const target = evt.currentTarget && evt.currentTarget.getBoundingClientRect ? evt.currentTarget : evt.target;
    const rect = target.getBoundingClientRect();
    const point = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  },

  corsAdapter(adapter) { globals.corsAdapter = typeof adapter === 'function' ? adapter : null; },

  dashedLineSupport: () => typeof CanvasRenderingContext2D !== 'undefined' && 'setLineDash' in CanvasRenderingContext2D.prototype,

  fullScreenCapable: () => typeof document !== 'undefined' && !!document.fullscreenEnabled,

  getFontIcon(classes) {
    const el = document.createElement('i');
    el.className = classes;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    const content = getComputedStyle(el, '::before').content;
    el.remove();
    const ch = content && content !== 'none' ? content.replace(/^["']|["']$/g, '') : '';
    return ch ? ch.codePointAt(0) : 0;
  },

  getGraphEngine: opts => withCallbacks(createGraphEngine(opts)),

  info: () => ({ version: VERSION, mode: base.mode(), webgl: base.webGLSupport(), wasm: wasmActive() }),

  /** 'auto' (WebGL for large charts), 'webgl' or 'canvas'. Returns the mode in effect. */
  mode(value) {
    if (value !== undefined) {
      if (!['auto', 'webgl', 'canvas'].includes(value)) throw new Error(`mode: expected 'auto', 'webgl' or 'canvas', got ${value}`);
      globals.mode = value === 'webgl' && !base.webGLSupport() ? 'canvas' : value;
      globals.renderers.forEach(fn => fn());
    }
    return globals.mode;
  },

  paths(value) {
    if (value !== undefined) globals.paths = { ...globals.paths, ...value };
    return { ...globals.paths };
  },

  setSize(target, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('setSize: Invalid width or height value passed. Both parameters should be numbers.');
    }
    const el = resolveElement(target);
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    window.dispatchEvent(new Event('resize'));
  },

  toggleFullScreen(element, handler) {
    const done = () => { if (typeof handler === 'function') handler(!!document.fullscreenElement); };
    const p = document.fullscreenElement ? document.exitFullscreen() : resolveElement(element).requestFullscreen();
    Promise.resolve(p).then(done, done);
  },

  webGLSupport() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  },
};

/* ============================================================================
 * Callback style: every async method also accepts a trailing callback,
 * e.g. chart.layout('organic', {}, () => ...). A Proxy keeps the wrapper live,
 * so methods replaced later (destroy) are wrapped too.
 * ==========================================================================*/

const ASYNC_METHODS = new Set([
  'animateProperties', 'arrange', 'createLink', 'expand', 'export', 'hide', 'layout', 'load', 'merge',
  'options', 'pan', 'ping', 'setItem', 'setProperties', 'show', 'toDataURL', 'viewOptions', 'zoom', 'range',
  'close', 'combine', 'open', 'transfer', 'uncombine', 'betweenness', 'closeness',
]);
// These take a function as their first argument, so only a second one is a callback.
const FN_FIRST = new Set(['filter', 'foreground']);
const NESTED = new Set(['graph', 'combo', 'map']);
const isTimelineComponent = target => isTimeline(target);

function withCallbacks(target) {
  return new Proxy(target, {
    get(obj, key) {
      const value = obj[key];
      if (typeof value !== 'function') return value;
      if (NESTED.has(key)) return (...args) => withCallbacks(value(...args));
      if (key === 'create') {
        return (def, cb) => {
          const p = value(def).then(made => (Array.isArray(made) ? made.map(withCallbacks) : withCallbacks(made)));
          if (typeof cb !== 'function') return p;
          p.then(made => cb(null, made), err => cb(err));
          return undefined;
        };
      }
      const isAsync = isTimelineComponent(target) ? key === 'export' : ASYNC_METHODS.has(key) || FN_FIRST.has(key);
      if (!isAsync) return value;
      return (...args) => {
        const last = args[args.length - 1];
        const hasCb = typeof last === 'function' && (!FN_FIRST.has(key) || args.length > 1);
        if (!hasCb) return value(...args);
        args.pop();
        Promise.resolve(value(...args)).then(
          result => last(result),
          err => setTimeout(() => { throw err; }),
        );
        return undefined;
      };
    },
  });
}

/** The object exposed as the UMD global. */
const GraphNexus = withCallbacks(base);

export default GraphNexus;
export { ChronoGraphValidationError, GraphNexus, create, createTimeline, createTimelineWithController };
