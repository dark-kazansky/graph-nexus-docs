import { createEmitter } from './events.js';
import { AggregationState, FoldState } from './timeline/aggregation.js';
import { createTimelineInteraction } from './timeline/interaction.js';
import { TimelineModel } from './timeline/model.js';
import { renderTimeline } from './timeline/render.js';
import { getRowEntityIds, lensScrollOffset, lensScrollTarget } from './timeline/rows.js';
import { fromEpochNanoseconds, normalizeTime, toEpochNanoseconds } from './timeline/time.js';
import {
  assertAllowedProperties, assertBoolean, assertFiniteNumber, assertOneOf,
  assertPlainObject, assertString, assertUniqueStringArray, assertValidTime,
  ChronoGraphValidationError, fail, parseColor, validateEventName, validateOptions,
  validateTimeRange,
} from './timeline/validation.js';

let nextCanvasId = 1;
const raf = callback => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(() => callback(Date.now()), 16));
const caf = token => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(token) : clearTimeout(token));

function resolveContainer(value, context = 'Timeline container') {
  if (value === null) return null;
  const element = typeof value === 'string' ? document.getElementById(value) : value;
  const isElement = typeof HTMLElement !== 'undefined' && element instanceof HTMLElement;
  if (!isElement) fail(context, typeof value === 'string' ? `Could not find an element in the DOM with the id '${value}'` : `${context} must be an HTMLElement or element id`);
  if (!element.isConnected) fail(context, 'The container element is not mounted in the document');
  return element;
}

function parseDefinition(definition) {
  if (typeof definition === 'string') return { container: resolveContainer(definition), options: {} };
  assertAllowedProperties(definition, ['container', 'options'], 'Timeline component definition');
  if (!Object.prototype.hasOwnProperty.call(definition, 'container')) fail('Timeline component definition', "Timeline component definition is missing 'container'");
  return { container: resolveContainer(definition.container), options: definition.options || {} };
}

function toRangeArguments(start, end) {
  const first = fromEpochNanoseconds(start);
  const last = fromEpochNanoseconds(end);
  return [first.time, last.time, first.timeNanoseconds, last.timeNanoseconds];
}

const ZOOM_UNITS_NS = {
  nanosecond: 1n, microsecond: 1000n, millisecond: 1000000n, second: 1000000000n,
  minute: 60000000000n, hour: 3600000000000n, day: 86400000000000n,
  week: 604800000000000n, month: 2629800000000000n, year: 31557600000000000n,
};

const SCALE_RESOLUTION = { millisecond: 0, microsecond: 1, nanosecond: 2 };
const WRAPPING_SCALE_INFO = {
  day: { baseRanges: [{ start: 946684800000, end: 946771200000 }, { start: 0, end: 86400000000 }, { start: 0, end: 86400000000000 }], intervalStep: { unit: 'day', count: 1 }, wrappedZeroTime: 946684800000 },
  week: { baseRanges: [{ start: 946857600000, end: 947462400000 }, { start: 0, end: 604800000000 }, { start: 0, end: 604800000000000 }], intervalStep: { unit: 'week', count: 1 }, wrappedZeroTime: 946857600000 },
  month: { baseRanges: [{ start: 946684800000, end: 949363200000 }, { start: 0, end: 2678400000000 }, { start: 0, end: 2678400000000000 }], intervalStep: { unit: 'month', count: 1 }, wrappedZeroTime: 946684800000 },
  year: { baseRanges: [{ start: 946684800000, end: 978307200000 }, { start: -15724800000000, end: 15897600000000 }, { start: -15724800000000000, end: 15897600000000000 }], intervalStep: { unit: 'year', count: 1 }, wrappedZeroTime: 962409600000 },
};

function publicScaleInfo(model) {
  const source = model.normalized.resolution;
  const resolution = SCALE_RESOLUTION[source.resolution];
  const originMilliseconds = source.origin / 1000000n - (source.origin < 0n && source.origin % 1000000n !== 0n ? 1n : 0n);
  const zeroTime = resolution === 0 ? 0 : Number(originMilliseconds);
  const scaleWrapping = model.options().scales.wrapping;
  const wrapping = WRAPPING_SCALE_INFO[scaleWrapping];
  return {
    resolution,
    zeroTime,
    scaleWrapping,
    wrappingInfo: wrapping ? { baseRanges: wrapping.baseRanges.map(range => ({ ...range })), intervalStep: { ...wrapping.intervalStep } } : undefined,
    wrappedZeroTime: scaleWrapping === 'off' || resolution === 0 ? zeroTime : wrapping.wrappedZeroTime,
  };
}

function createController(container, options) {
  const model = new TimelineModel(options);
  const emitter = createEmitter({ allowDuplicates: true });
  const canvas = document.createElement('canvas');
  canvas.id = `graph-nexus-timeline-${nextCanvasId++}`;
  canvas.tabIndex = 8888;
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Timeline requires a Canvas 2D rendering context.');
  let host = container;
  let priorOverflow = host.style.overflow;
  host.style.overflow = 'hidden';
  host.appendChild(canvas);
  let destroyed = false;
  let drawToken = null;
  let monitorToken = null;
  let observer = null;
  let frame = null;
  let width = 100;
  let height = 100;
  let dpr = 1;
  let labelAreaMode = 'auto';
  let labelAreaWidth = 125;
  let lensOffset = 0;
  let chartHighlight = null;
  let marquee = null;
  let guide = null;
  let interaction = null;
  let rangeEventTimer = null;
  let pings = [];
  const objectUrls = new Set();
  const pendingExports = new Set();
  const foldState = new FoldState();
  const aggregationState = new AggregationState();

  function measure() {
    const rect = host?.getBoundingClientRect();
    const nextWidth = rect && rect.width > 0 ? rect.width : 100;
    const nextHeight = rect && rect.height > 0 ? rect.height : 100;
    const nextDpr = window.devicePixelRatio || 1;
    const changed = nextWidth !== width || nextHeight !== height || nextDpr !== dpr;
    width = nextWidth; height = nextHeight; dpr = nextDpr;
    if (changed) requestDraw();
  }

  function drawNow(now = Date.now()) {
    if (destroyed) return frame;
    measure();
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    pings = pings.filter(ping => now < ping.start + ping.options.time * ping.options.repeat);
    frame = renderTimeline(context, { width, height }, model, {
      aggregationState, foldState, labelAreaMode, labelAreaWidth, lensOffset, chartHighlight, marquee, guide, pings, now,
    });
    interaction?.afterDraw();
    emitter.emit('draw');
    if (pings.length || frame.aggregation.active) requestDraw();
    return frame;
  }

  function requestDraw() {
    if (destroyed || drawToken !== null) return;
    drawToken = raf(() => { drawToken = null; drawNow(Date.now()); });
  }

  function monitor() {
    if (destroyed) return;
    measure();
    monitorToken = raf(monitor);
  }

  function handleWindowResize() {
    measure();
    requestDraw();
  }

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { measure(); requestDraw(); });
    observer.observe(host);
  } else monitorToken = raf(monitor);
  window.addEventListener('resize', handleWindowResize);
  requestDraw();

  function currentFrame() { return frame || drawNow(); }

  function emitRange(why = 'auto', debounced = false) {
    if (why === 'direct') return;
    const fire = () => { rangeEventTimer = null; emitter.emit('range', { ...model.range(), why }); };
    if (!debounced) { if (rangeEventTimer !== null) clearTimeout(rangeEventTimer); fire(); return; }
    if (rangeEventTimer !== null) clearTimeout(rangeEventTimer);
    rangeEventTimer = setTimeout(fire, 40);
  }

  function setRangeNanoseconds(start, end, why = 'auto', debounced = false) {
    if (start >= end) return model.range();
    model.range(...toRangeArguments(start, end)); requestDraw(); emitRange(why, debounced); return model.range();
  }

  function setFocus(ids, why = 'auto') {
    const before = model.focus(); const result = model.focus(ids);
    if (before.join('\0') !== result.join('\0')) {
      requestDraw();
      if (why !== 'direct') emitter.emit('focus', { focus: result, why });
    }
    return result;
  }

  function setHighlight(ids, why = 'auto') {
    const before = model.highlight();
    const values = Array.isArray(ids) ? ids : [ids];
    const known = values.filter(id => model.normalized.entities[id] || currentFrame().rows.rowIndex[id]);
    const result = model.highlight(known);
    if (before.join('\0') !== result.join('\0')) {
      requestDraw();
      if (why !== 'direct') emitter.emit('highlight', { highlight: result, why });
    }
    return result;
  }

  function setPin(ids, pinned = true, why = 'auto') {
    const before = model.getPinnedEntityIds(); model.pin(ids, pinned); const result = model.getPinnedEntityIds();
    if (before.join('\0') !== result.join('\0')) {
      lensOffset = 0; requestDraw();
      if (why !== 'direct') emitter.emit('pin', { pin: result, why });
    }
    return result;
  }

  function setLens(id, why = 'auto') {
    const before = model.lens(); const result = model.lens(id);
    if (before !== result) {
      lensOffset = 0; requestDraw();
      if (why !== 'direct') emitter.emit('lens', { lens: result, why });
    }
    return result;
  }

  function panByPixels(delta, why = 'user', debounced = true) {
    const value = model.range(); const start = toEpochNanoseconds(value.start, value.startNanoseconds); const end = toEpochNanoseconds(value.end, value.endNanoseconds);
    const pixels = Math.max(1, currentFrame().geometry.timeline.x2 - currentFrame().geometry.timeline.x1);
    const shift = BigInt(Math.round(Number(end - start) * -delta / pixels));
    return setRangeNanoseconds(start + shift, end + shift, why, debounced);
  }

  function zoomAt(x, direction, why = 'user', debounced = true) {
    const value = model.range(); const start = toEpochNanoseconds(value.start, value.startNanoseconds); const end = toEpochNanoseconds(value.end, value.endNanoseconds);
    const bounds = currentFrame().geometry.timeline; const amount = Math.max(0, Math.min(1, (x - bounds.x1) / Math.max(1, bounds.x2 - bounds.x1)));
    const anchor = start + BigInt(Math.round(Number(end - start) * amount));
    const numerator = direction === 'in' ? 5n : 6n; const denominator = direction === 'in' ? 6n : 5n;
    const nextStart = anchor - (anchor - start) * numerator / denominator;
    const nextEnd = anchor + (end - anchor) * numerator / denominator;
    return setRangeNanoseconds(nextStart, nextEnd, why, debounced);
  }

  const controller = {
    canvas,
    model,
    emitter,
    foldState,
    get frame() { return currentFrame(); },
    requestDraw,
    drawNow,
    set(data) {
      const focus = model.focus(); const highlight = model.highlight(); const pin = model.getPinnedEntityIds(); const lens = model.lens();
      model.set(data); chartHighlight = null; aggregationState.reset(); requestDraw();
      if (focus.join('\0') !== model.focus().join('\0')) emitter.emit('focus', { focus: model.focus(), why: 'auto' });
      if (highlight.join('\0') !== model.highlight().join('\0')) emitter.emit('highlight', { highlight: model.highlight(), why: 'auto' });
      if (pin.join('\0') !== model.getPinnedEntityIds().join('\0')) emitter.emit('pin', { pin: model.getPinnedEntityIds(), why: 'auto' });
      if (lens !== model.lens()) emitter.emit('lens', { lens: model.lens(), why: 'auto' });
    },
    fit() { model.fit(); requestDraw(); emitRange('auto'); },
    range(...args) { const result = model.range(...args); if (args.length) { requestDraw(); emitRange('direct'); } return result; },
    pan(direction, amount = 0.3) {
      assertOneOf(direction, ['left', 'right'], 'pan direction');
      assertFiniteNumber(amount, 'pan amount', { min: 0 });
      const value = model.range();
      const start = toEpochNanoseconds(value.start, value.startNanoseconds);
      const end = toEpochNanoseconds(value.end, value.endNanoseconds);
      const widthNs = end - start;
      let shift = BigInt(Math.round(Number(widthNs) * amount)) * (direction === 'left' ? -1n : 1n);
      let nextStart = start + shift; let nextEnd = end + shift;
      if (model.options().scales.panLimit === 'auto' && model.normalized.bounds) {
        const minimum = model.normalized.bounds.start.epochNanoseconds;
        const maximum = model.normalized.bounds.end.epochNanoseconds;
        if (nextStart < minimum) { nextEnd += minimum - nextStart; nextStart = minimum; }
        if (nextEnd > maximum) { nextStart -= nextEnd - maximum; nextEnd = maximum; }
        if (nextStart >= nextEnd) return;
      }
      setRangeNanoseconds(nextStart, nextEnd, 'auto', false);
    },
    zoom(direction) {
      assertOneOf(direction, ['in', 'out'], 'zoom direction');
      const value = model.range();
      const start = toEpochNanoseconds(value.start, value.startNanoseconds);
      const end = toEpochNanoseconds(value.end, value.endNanoseconds);
      const center = (start + end) / 2n;
      let widthNs = end - start;
      widthNs = direction === 'in' ? widthNs * 5n / 6n : widthNs * 6n / 5n;
      const zoomLimit = model.options().scales.zoomOutLimit;
      if (zoomLimit !== 'auto') {
        const maximum = ZOOM_UNITS_NS[zoomLimit.unit] * BigInt(Math.round((zoomLimit.value ?? 1) * 1000000)) / 1000000n;
        if (widthNs > maximum) widthNs = maximum;
      } else if (model.normalized.bounds && direction === 'out') {
        const dataWidth = model.normalized.bounds.end.epochNanoseconds - model.normalized.bounds.start.epochNanoseconds;
        widthNs = widthNs > dataWidth * 20n / 9n ? dataWidth * 20n / 9n : widthNs;
      }
      if (widthNs < 2n) widthNs = 2n;
      setRangeNanoseconds(center - widthNs / 2n, center + widthNs / 2n, 'auto', false);
    },
    focus(ids) { return ids === undefined ? model.focus() : setFocus(ids, 'direct'); },
    highlight(ids) { return ids === undefined ? model.highlight() : setHighlight(ids, 'direct'); },
    pin(ids, pinned = true) { setPin(ids, pinned, 'direct'); },
    getPinnedEntityIds() { return model.getPinnedEntityIds(); },
    lens(id) { return id === undefined ? model.lens() : setLens(id, 'direct'); },
    labelAreaWidth(mode, value) {
      if (mode === undefined) return { mode: labelAreaMode, width: currentFrame().geometry.label.x2 };
      assertOneOf(mode, ['auto', 'fixed'], 'label area width mode');
      if (mode === 'fixed') {
        if (value === undefined) value = currentFrame().geometry.label.x2;
        assertFiniteNumber(value, 'label area width', { positive: true });
        labelAreaWidth = Math.max(40, Math.min(width - 40, value));
      }
      labelAreaMode = mode; requestDraw();
      return { mode: labelAreaMode, width: labelAreaMode === 'fixed' ? labelAreaWidth : currentFrame().geometry.label.x2 };
    },
    markers(value) { const result = model.markers(value); if (value !== undefined) requestDraw(); return result; },
    reveal(ids) { const result = model.reveal(ids); if (ids !== undefined) { foldState.clearForReveal(result); requestDraw(); } return result; },
    ping(ids, pingOptions = {}) {
      const list = Array.isArray(ids) ? ids : [ids];
      if (list.some(id => typeof id !== 'string') || new Set(list).size !== list.length) fail('ping ids', 'ping ids must be unique strings');
      assertAllowedProperties(pingOptions, ['color', 'mode', 'repeat', 'spread', 'strokeWidth', 'time'], 'ping options');
      const next = { color: '#909090', mode: 'individual', repeat: 1, spread: 42, strokeWidth: 12, time: 800, ...pingOptions };
      parseColor(next.color); assertOneOf(next.mode, ['individual', 'grouped'], 'ping mode');
      ['repeat', 'spread', 'strokeWidth', 'time'].forEach(key => assertFiniteNumber(next[key], `ping ${key}`, { positive: true }));
      const known = list.filter(id => model.normalized.events[id]);
      if (known.length) { pings.push({ ids: known, options: next, start: Date.now() }); requestDraw(); }
    },
    setOrdering(value) { model.setOrdering(value); requestDraw(); },
    getScaleInfo() { return publicScaleInfo(model); },
    getEntity(id) { return model.getEntity(id); },
    getEvent(id) { return model.getEvent(id); },
    getEntityPosition(id) { assertString(id, 'entity id'); return currentFrame().entityPositions[id] ? { ...currentFrame().entityPositions[id] } : null; },
    getEventPosition(id) {
      assertString(id, 'event id'); const result = currentFrame().eventPositions[id];
      return result ? { ...result, ...(result.wrappedSegments ? { wrappedSegments: result.wrappedSegments.map(item => ({ ...item })) } : {}) } : null;
    },
    getRowEntityIds(id) { assertString(id, 'row id'); return getRowEntityIds(currentFrame().rows, id); },
    getInRangeItems(optionsValue) {
      if (optionsValue !== undefined) {
        assertAllowedProperties(optionsValue, ['focus'], 'getInRangeItems options');
        if (Object.prototype.hasOwnProperty.call(optionsValue, 'focus')) assertBoolean(optionsValue.focus, 'getInRangeItems focus');
      }
      return model.getInRangeItems(optionsValue);
    },
    inRange(item, nanoseconds) {
      if (nanoseconds !== undefined) assertFiniteNumber(nanoseconds, 'nanoseconds');
      return model.inRange(item, nanoseconds);
    },
    options(value) { const result = model.options(value); if (value !== undefined) requestDraw(); return result; },
    on(name, handler) { validateEventName(name); if (typeof handler !== 'function') fail('Timeline event handler', 'Timeline event handler must be a function'); emitter.on(name, handler); },
    off(name, handler) { validateEventName(name); if (typeof handler !== 'function') fail('Timeline event handler', 'Timeline event handler must be a function'); emitter.off(name, handler); },
    export(optionsValue) {
      assertAllowedProperties(optionsValue, ['type'], 'export options');
      if (!Object.prototype.hasOwnProperty.call(optionsValue, 'type')) fail('export options', "export options is missing 'type'");
      assertOneOf(optionsValue.type, ['png'], 'export type');
      drawNow();
      return new Promise((resolve, reject) => {
        const pending = { reject };
        pendingExports.add(pending);
        try {
          canvas.toBlob(blob => {
            if (!pendingExports.delete(pending)) return;
            if (!blob) { reject(new Error('Failed to export timeline to blob.')); return; }
            try {
              const url = URL.createObjectURL(blob);
              if (destroyed) { URL.revokeObjectURL(url); reject(new Error('Timeline has been destroyed.')); return; }
              objectUrls.add(url); resolve({ url });
            } catch (error) { reject(error); }
          }, 'image/png');
        } catch (error) { pendingExports.delete(pending); reject(error); }
      });
    },
    setContainer(value) {
      const target = value === null ? null : resolveContainer(value);
      if (host) { if (host.style.overflow === 'hidden') host.style.overflow = priorOverflow; }
      canvas.remove(); host = target;
      if (host) { priorOverflow = host.style.overflow; host.style.overflow = 'hidden'; host.appendChild(canvas); if (observer) { observer.disconnect(); observer.observe(host); } measure(); requestDraw(); }
      else if (observer) observer.disconnect();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (drawToken !== null) caf(drawToken);
      if (monitorToken !== null) caf(monitorToken);
      if (rangeEventTimer !== null) clearTimeout(rangeEventTimer);
      window.removeEventListener('resize', handleWindowResize);
      interaction?.destroy();
      observer?.disconnect();
      pendingExports.forEach(pending => pending.reject(new Error('Timeline has been destroyed.')));
      pendingExports.clear();
      if (host && host.style.overflow === 'hidden') host.style.overflow = priorOverflow;
      canvas.remove(); emitter.clear(); objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls.clear();
    },
    hitTest(x, y) {
      const hit = [...currentFrame().hitRegions].reverse().find(item => x >= item.x1 && x <= item.x2 && y >= item.y1 && y <= item.y2);
      if (!hit) return { targetType: null, id: null };
      if (!hit.nearestPoints) return hit;
      const nearestByChart = new Map();
      hit.nearestPoints.forEach(point => {
        const previous = nearestByChart.get(point.chartId);
        if (!previous || Math.abs(point.x - x) < Math.abs(previous.x - x)) nearestByChart.set(point.chartId, point);
      });
      const nearest = [...nearestByChart.values()].sort((left, right) => Math.hypot(left.x - x, left.y - y) - Math.hypot(right.x - x, right.y - y))[0];
      const { nearestPoints, ...publicHit } = hit;
      return nearest ? { ...publicHit, subItem: nearest.subItem } : publicHit;
    },
  };

  interaction = createTimelineInteraction({
    canvas, emitter, model, getFrame: currentFrame,
    actions: {
      hitTest: controller.hitTest,
      getRowEntityIds: controller.getRowEntityIds,
      focus: setFocus,
      highlight: setHighlight,
      pin: setPin,
      lens: setLens,
      range: setRangeNanoseconds,
      panPixels: panByPixels,
      zoomAt,
      labelAreaMode: () => labelAreaMode,
      labelAreaWidth: () => ({ mode: labelAreaMode, width: labelAreaWidth }),
      lensOffset: () => lensOffset,
      setLabelAreaWidth(value) {
        labelAreaWidth = Math.max(40, Math.min(width - 40, value)); labelAreaMode = 'fixed'; requestDraw();
      },
      scrollLens(direction, why = 'user') {
        const snapshot = currentFrame().rows;
        const delta = lensScrollOffset(snapshot, direction);
        const target = lensScrollTarget(snapshot, direction);
        if (delta && target) setLens(target, why);
      },
      toggleFold(id) {
        const fold = currentFrame().aggregation.folds.find(item => item.id === id);
        if (fold) {
          const opened = foldState.toggle(fold.time);
          if (opened) {
            const value = model.range();
            const start = toEpochNanoseconds(value.start, value.startNanoseconds);
            const end = toEpochNanoseconds(value.end, value.endNanoseconds);
            const widthNs = end - start;
            setRangeNanoseconds(fold.time - widthNs / 2n, fold.time + widthNs / 2n, 'user', false);
          }
          requestDraw();
        }
      },
      setGuide(value) {
        const same = guide === value || (guide && value && guide.x === value.x && guide.y === value.y && guide.time.epochNanoseconds === value.time.epochNanoseconds);
        guide = value; if (!same) requestDraw();
      },
      setChartHighlight(value) {
        if (chartHighlight === value) return;
        chartHighlight = value; requestDraw();
      },
      setMarquee(value) { marquee = value; requestDraw(); },
      restoreDrag(state) {
        if (state.startRange) {
          model.range(state.startRange.start, state.startRange.end, state.startRange.startNanoseconds, state.startRange.endNanoseconds);
          emitRange('user');
        }
        labelAreaMode = state.startLabel.mode; labelAreaWidth = state.startLabel.width;
        lensOffset = state.startLensOffset; requestDraw();
      },
    },
  });
  return controller;
}

function assertArity(name, args, allowed) {
  if (!allowed.includes(args.length)) fail(name, `${name} expects ${allowed.join(' or ')} argument${allowed.length === 1 && allowed[0] === 1 ? '' : 's'}; received ${args.length}`);
}

function validateIds(value, context) {
  const values = Array.isArray(value) ? value : [value];
  assertUniqueStringArray(values, context);
}

function validateFacadeCall(name, args, shadow) {
  const arities = {
    set: [1], fit: [0], range: [0, 2, 3, 4], pan: [1, 2], zoom: [1], focus: [0, 1], highlight: [0, 1],
    pin: [1, 2], getPinnedEntityIds: [0], lens: [0, 1], labelAreaWidth: [0, 1, 2], markers: [0, 1],
    reveal: [0, 1], ping: [1, 2], setOrdering: [1], getEntity: [1], getEvent: [1], getEntityPosition: [1],
    getEventPosition: [1], getRowEntityIds: [1], getInRangeItems: [0, 1], inRange: [1, 2], options: [0, 1],
    on: [2], off: [2], export: [1], setContainer: [1], destroy: [0],
  };
  assertArity(name, args, arities[name]);
  if (name === 'set') shadow.set(args[0]);
  else if (name === 'range' && args.length) {
    assertValidTime(args[0], 'range start'); assertValidTime(args[1], 'range end');
    if (args.length > 2) assertFiniteNumber(args[2], 'range startNanoseconds');
    if (args.length > 3) assertFiniteNumber(args[3], 'range endNanoseconds');
    if (toEpochNanoseconds(args[0], args[2] || 0) >= toEpochNanoseconds(args[1], args[3] || 0)) fail('range', 'range start must be before range end');
  } else if (name === 'pan') {
    assertOneOf(args[0], ['left', 'right'], 'pan direction'); if (args.length > 1) assertFiniteNumber(args[1], 'pan amount', { min: 0 });
  } else if (name === 'zoom') assertOneOf(args[0], ['in', 'out'], 'zoom direction');
  else if (name === 'focus' || name === 'highlight' || name === 'reveal') { if (args.length) validateIds(args[0], `${name} ids`); }
  else if (name === 'pin') { validateIds(args[0], 'entity ids'); if (args.length > 1) assertBoolean(args[1], 'pinned'); }
  else if (name === 'lens' && args.length && args[0] !== null) assertString(args[0], 'lens entity id');
  else if (name === 'labelAreaWidth' && args.length) {
    assertOneOf(args[0], ['auto', 'fixed'], 'label area width mode');
    if (args[0] === 'auto' && args.length !== 1) fail(name, 'labelAreaWidth auto overload accepts no width');
    if (args.length > 1) assertFiniteNumber(args[1], 'label area width', { positive: true });
  } else if (name === 'markers' && args.length) shadow.markers(args[0]);
  else if (name === 'ping') {
    validateIds(args[0], 'ping ids');
    const value = args[1] || {};
    assertAllowedProperties(value, ['color', 'mode', 'repeat', 'spread', 'strokeWidth', 'time'], 'ping options');
    if (Object.prototype.hasOwnProperty.call(value, 'color')) parseColor(value.color);
    if (Object.prototype.hasOwnProperty.call(value, 'mode')) assertOneOf(value.mode, ['individual', 'grouped'], 'ping mode');
    ['repeat', 'spread', 'strokeWidth', 'time'].forEach(key => { if (Object.prototype.hasOwnProperty.call(value, key)) assertFiniteNumber(value[key], `ping ${key}`, { positive: true }); });
  } else if (name === 'setOrdering') assertOneOf(args[0], ['firstevent', 'lastevent', 'keyorder', 'alphabetical', 'shorteneventlines'], 'ordering');
  else if (['getEntity', 'getEvent', 'getEntityPosition', 'getEventPosition', 'getRowEntityIds'].includes(name)) assertString(args[0], `${name} id`);
  else if (name === 'getInRangeItems' && args.length) {
    assertAllowedProperties(args[0], ['focus'], 'getInRangeItems options');
    if (Object.prototype.hasOwnProperty.call(args[0], 'focus')) assertBoolean(args[0].focus, 'getInRangeItems focus');
  } else if (name === 'inRange') {
    if (typeof args[0] !== 'string') {
      if (args[0] && typeof args[0] === 'object' && !(args[0] instanceof Date)) validateTimeRange(args[0], 'range item');
      else assertValidTime(args[0], 'range item');
    }
    if (args.length > 1) assertFiniteNumber(args[1], 'nanoseconds');
  } else if (name === 'options' && args.length) validateOptions(args[0]);
  else if (name === 'on' || name === 'off') {
    validateEventName(args[0]); if (typeof args[1] !== 'function') fail('Timeline event handler', 'Timeline event handler must be a function');
  } else if (name === 'export') {
    assertAllowedProperties(args[0], ['type'], 'export options');
    if (!Object.prototype.hasOwnProperty.call(args[0], 'type')) fail('export options', "export options is missing 'type'");
    assertOneOf(args[0].type, ['png'], 'export type');
  } else if (name === 'setContainer' && args[0] !== null) resolveContainer(args[0]);
}

const timelineFacades = new WeakSet();

export function isTimeline(value) {
  return !!(value && typeof value === 'object' && timelineFacades.has(value));
}

function publicFacade(controller) {
  if (!controller || typeof controller !== 'object') fail('Timeline controller', 'Timeline controller must be an object');
  const shadow = new TimelineModel();
  let destroyed = false;
  const destroyedError = () => new Error('Timeline has been destroyed.');
  const assertAlive = () => { if (destroyed) throw destroyedError(); };
  const method = name => (...args) => {
    if (name === 'destroy') {
      validateFacadeCall(name, args, shadow);
      if (destroyed) return undefined;
      if (typeof controller.destroy !== 'function') throw new TypeError("Timeline controller does not implement 'destroy'");
      const result = controller.destroy();
      destroyed = true;
      return result;
    }
    if (name === 'export') {
      return Promise.resolve().then(() => {
        assertAlive();
        if (typeof controller.export !== 'function') throw new TypeError("Timeline controller does not implement 'export'");
        validateFacadeCall(name, args, shadow);
        return controller.export(...args);
      });
    }
    assertAlive();
    if (typeof controller[name] !== 'function') throw new TypeError(`Timeline controller does not implement '${name}'`);
    validateFacadeCall(name, args, shadow);
    const result = controller[name](...args);
    return ['fit', 'pan', 'zoom'].includes(name) ? undefined : result;
  };
  const privateSurface = Object.freeze({
    getScaleInfo() {
      assertAlive();
      if (typeof controller.getScaleInfo !== 'function') throw new TypeError("Timeline controller does not implement 'getScaleInfo'");
      return controller.getScaleInfo();
    },
    options: method('options'),
  });
  const facade = {
    set: method('set'), fit: method('fit'), range: method('range'), pan: method('pan'), zoom: method('zoom'),
    focus: method('focus'), highlight: method('highlight'), pin: method('pin'), getPinnedEntityIds: method('getPinnedEntityIds'),
    lens: method('lens'), labelAreaWidth: method('labelAreaWidth'), markers: method('markers'), reveal: method('reveal'),
    ping: method('ping'), setOrdering: method('setOrdering'), getEntity: method('getEntity'), getEvent: method('getEvent'),
    getEntityPosition: method('getEntityPosition'), getEventPosition: method('getEventPosition'), getRowEntityIds: method('getRowEntityIds'),
    getInRangeItems: method('getInRangeItems'), inRange: method('inRange'), options: method('options'),
    on: method('on'), off: method('off'), export: method('export'), setContainer: method('setContainer'), destroy: method('destroy'),
    private: privateSurface,
  };
  timelineFacades.add(facade);
  return facade;
}

export function createTimelineWithController(controller) {
  return publicFacade(controller);
}

export function createTimeline(definition) {
  const { container, options } = parseDefinition(definition);
  return createTimelineWithController(createController(container, options));
}

export { ChronoGraphValidationError };
