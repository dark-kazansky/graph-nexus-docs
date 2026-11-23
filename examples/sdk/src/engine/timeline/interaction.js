import { fromEpochNanoseconds, toEpochNanoseconds } from './time.js';

const DRAG_TYPES = new Set(['lensScrollbar', 'pan', 'marqueeRange', 'labelAreaWidth', null]);
const CLICK_DISTANCE = 5;
const DOUBLE_CLICK_MS = 320;
const LONG_PRESS_MS = 500;

const sameList = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

function modifiers(event = {}) {
  const ctrl = !!event.ctrlKey; const meta = !!event.metaKey;
  return {
    alt: !!event.altKey, ctrl, meta, shift: !!event.shiftKey,
    consistentCtrl: typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? meta : ctrl,
  };
}

function publicTime(value) {
  if (!value) return { time: undefined, timeNanoseconds: undefined };
  const result = value.epochNanoseconds === undefined ? value : fromEpochNanoseconds(value.epochNanoseconds);
  return { time: new Date(result.time.getTime()), timeNanoseconds: result.timeNanoseconds };
}

export function createTimelineInteraction({ canvas, emitter, model, getFrame, actions }) {
  const listeners = [];
  const activePointers = new Map();
  let destroyed = false;
  let drag = null;
  let hoverTimer = null;
  let hoverKey = null;
  let longPressTimer = null;
  let suppressClick = false;
  let lastClick = null;
  let lastPointer = null;
  let pinch = null;
  let marquee = null;

  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.clientWidth || rect.width || 1) / (rect.width || 1),
      y: (event.clientY - rect.top) * (canvas.clientHeight || rect.height || 1) / (rect.height || 1),
    };
  }

  function timeAt(x) {
    const frame = getFrame();
    const start = frame.range.start.epochNanoseconds; const end = frame.range.end.epochNanoseconds;
    const bounds = frame.geometry.timeline;
    const amount = Math.max(0, Math.min(1, (x - bounds.x1) / Math.max(1, bounds.x2 - bounds.x1)));
    const epochNanoseconds = start + BigInt(Math.round(Number(end - start) * amount));
    return { epochNanoseconds, ...fromEpochNanoseconds(epochNanoseconds) };
  }

  function payloadAt(x, y, event = {}, extra = {}) {
    const hit = actions.hitTest(x, y);
    const pointed = timeAt(x);
    const start = publicTime(hit.range?.start); const end = publicTime(hit.range?.end);
    const subItem = hit.subItem ? { ...hit.subItem } : undefined;
    if (subItem?.time instanceof Date) subItem.time = new Date(subItem.time.getTime());
    return {
      button: Number.isFinite(event.button) ? event.button : -1,
      pointerId: event.pointerId ?? 0,
      pointerType: event.pointerType || 'mouse',
      modifierKeys: modifiers(event),
      x, y,
      id: hit.id ?? null,
      targetType: hit.targetType ?? null,
      time: pointed.time,
      endTime: hit.range ? end.time : undefined,
      startTime: hit.range ? start.time : undefined,
      eventIds: hit.eventIds ? [...hit.eventIds] : undefined,
      subItem,
      label: hit.label,
      timeNanoseconds: pointed.timeNanoseconds,
      startNanoseconds: hit.range ? start.timeNanoseconds : undefined,
      endNanoseconds: hit.range ? end.timeNanoseconds : undefined,
      ...extra,
    };
  }

  function emit(name, payload) { return emitter.emit(name, payload); }

  function scheduleHover(payload) {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    const key = `${payload.targetType}|${payload.id}|${payload.subItem?.subId || ''}`;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (key === hoverKey) return;
      hoverKey = key;
      emit('hover', payload);
    }, model.options().hover);
  }

  function targetEntityIds(payload) {
    if (['entityGroup', 'entityRun'].includes(payload.targetType) && payload.id) return actions.getRowEntityIds?.(payload.id) || [];
    if (['entity', 'glyph', 'focus', 'pin', 'lensControl'].includes(payload.targetType) && payload.id && model.normalized.entities[payload.id]) return [payload.id];
    return [];
  }

  function applyPointerDefault(payload) {
    actions.setChartHighlight?.(payload.targetType === 'timeSeriesChart' ? payload.subItem?.subId || null : null);
    const ids = targetEntityIds(payload);
    const next = ids.length ? ids : [];
    if (!sameList(model.highlight(), next)) actions.highlight(next, 'user');
  }

  function clickDefault(payload) {
    if (payload.targetType === 'focus' && payload.id) {
      const current = model.focus();
      actions.focus(current.length === 1 && current[0] === payload.id ? [] : [payload.id], 'user');
    } else if (payload.targetType === 'pin' && payload.id) {
      actions.pin(payload.id, !model.getPinnedEntityIds().includes(payload.id), 'user');
    } else if (payload.targetType === 'fold') {
      actions.toggleFold(payload.id);
    } else if (payload.targetType === 'lensControl') {
      actions.lens(payload.id === '_lensClose' ? null : payload.id, 'user');
    } else if (payload.targetType === 'lensScrollbar') {
      actions.scrollLens(payload.y < (payload.subItem?.y || payload.y) ? -1 : 1, 'user');
    }
  }

  function doubleClickDefault(payload) {
    if (payload.targetType === null) actions.focus([], 'user');
    else if (['entity', 'entityGroup', 'entityRun', 'glyph'].includes(payload.targetType) && payload.id) {
      const ids = targetEntityIds(payload);
      const focused = model.focus();
      actions.focus(ids.every(id => focused.includes(id)) ? [] : ids, 'user');
    } else if (payload.targetType === 'scale' && payload.startTime && payload.endTime) {
      actions.range(
        toEpochNanoseconds(payload.startTime, payload.startNanoseconds),
        toEpochNanoseconds(payload.endTime, payload.endNanoseconds),
        'user', false,
      );
    }
  }

  function fireClick(payload, event) {
    const now = performance.now();
    const repeated = lastClick && now - lastClick.time <= DOUBLE_CLICK_MS
      && lastClick.id === payload.id && lastClick.targetType === payload.targetType
      && Math.hypot(lastClick.x - payload.x, lastClick.y - payload.y) <= CLICK_DISTANCE;
    if (!emit('click', payload)) clickDefault(payload);
    if (repeated) {
      if (!emit('double-click', payload)) doubleClickDefault(payload);
      lastClick = null;
    } else lastClick = { time: now, x: payload.x, y: payload.y, id: payload.id, targetType: payload.targetType };
    if (event.pointerType === 'touch') event.preventDefault();
  }

  function context(payload, event) {
    const prevented = emit('context-menu', payload);
    if (!prevented) suppressClick = true;
    event?.preventDefault();
    return prevented;
  }

  function dragTypeFor(payload, event) {
    if (event.shiftKey) return 'marqueeRange';
    if (payload.targetType === 'labelAreaBorder') return actions.labelAreaMode() === 'fixed' ? 'labelAreaWidth' : null;
    if (payload.targetType === 'scale') return 'marqueeRange';
    if (payload.targetType === 'lensScrollbar') return 'lensScrollbar';
    if (payload.x >= getFrame().geometry.timeline.x1) return 'pan';
    return null;
  }

  function startDrag(event, current, payload) {
    let type = dragTypeFor(payload, event);
    const startRange = model.range();
    const startLabel = actions.labelAreaWidth();
    const startLensOffset = actions.lensOffset();
    const dragPayload = {
      ...payload, dragType: type,
      setDragOptions(options) {
        if (!options || typeof options !== 'object' || !DRAG_TYPES.has(options.type)) throw new TypeError('setDragOptions: unsupported drag type');
        type = options.type;
      },
    };
    const prevented = emit('drag-start', dragPayload);
    drag = { type: prevented ? null : type, start: current, last: current, startRange, startLabel, startLensOffset, canceled: prevented };
    if (drag.type === 'marqueeRange') { marquee = { x1: current.x, x2: current.x }; actions.setMarquee(marquee); }
  }

  function moveDrag(event, current, payload) {
    const dragPayload = { ...payload, dragType: drag.type };
    const prevented = emit('drag-move', dragPayload);
    if (!prevented && drag.type) {
      if (drag.type === 'pan') actions.panPixels(current.x - drag.last.x, 'user', true);
      else if (drag.type === 'labelAreaWidth') actions.setLabelAreaWidth(current.x, 'user');
      else if (drag.type === 'lensScrollbar') actions.scrollLens(current.y < drag.last.y ? -1 : 1, 'user');
      else if (drag.type === 'marqueeRange') {
        marquee = { x1: drag.start.x, x2: current.x }; actions.setMarquee(marquee);
      }
    }
    drag.last = current;
  }

  function finishDrag(event, payload, canceled = false) {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (canceled) actions.restoreDrag(current);
    const prevented = emit('drag-end', { ...payload, dragType: current.type, ...(canceled ? { canceled: true } : {}) });
    if (!canceled && !prevented && current.type === 'marqueeRange') {
      const left = Math.min(current.start.x, current.last.x); const right = Math.max(current.start.x, current.last.x);
      if (right - left > CLICK_DISTANCE) {
        const start = timeAt(left); const end = timeAt(right);
        actions.range(start.epochNanoseconds, end.epochNanoseconds, 'user', false);
      }
    }
    marquee = null; actions.setMarquee(null);
  }

  function beginLongPress(event, payload) {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    if (event.pointerType !== 'touch') return;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      context(payload, event);
    }, LONG_PRESS_MS);
  }

  function clearLongPress() {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function onPointerDown(event) {
    const current = point(event); const payload = payloadAt(current.x, current.y, event);
    lastPointer = { ...current, pointerId: event.pointerId, pointerType: event.pointerType || 'mouse', button: event.button, ...modifiers(event) };
    activePointers.set(event.pointerId, { start: current, current });
    suppressClick = false;
    emit('pointer-down', payload);
    beginLongPress(event, payload);
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    if (activePointers.size === 2) {
      const [one, two] = [...activePointers.values()].map(pointer => pointer.current);
      pinch = { distance: Math.hypot(two.x - one.x, two.y - one.y), centreX: (one.x + two.x) / 2 };
    }
  }

  function onPointerMove(event, synthetic = false) {
    const current = synthetic ? { x: lastPointer.x, y: lastPointer.y } : point(event);
    if (!synthetic) {
      lastPointer = { ...current, pointerId: event.pointerId, pointerType: event.pointerType || 'mouse', button: event.button, ...modifiers(event) };
      const pointer = activePointers.get(event.pointerId);
      if (pointer) pointer.current = current;
    }
    const payload = payloadAt(current.x, current.y, event, synthetic ? { synthetic: true } : {});
    actions.setGuide?.({ ...current, time: timeAt(current.x) });
    const prevented = emit('pointer-move', payload);
    scheduleHover(payload);
    if (prevented) return;
    if (!synthetic && activePointers.size === 2) {
      clearLongPress();
      const [one, two] = [...activePointers.values()].map(pointer => pointer.current);
      const distance = Math.hypot(two.x - one.x, two.y - one.y); const centreX = (one.x + two.x) / 2;
      if (pinch && distance !== pinch.distance) actions.zoomAt(centreX, distance > pinch.distance ? 'in' : 'out', 'user', true);
      if (pinch) actions.panPixels(centreX - pinch.centreX, 'user', true);
      pinch = { distance, centreX };
      return;
    }
    const down = activePointers.get(event.pointerId)?.start;
    if (down && !drag && Math.hypot(current.x - down.x, current.y - down.y) > CLICK_DISTANCE) {
      clearLongPress(); startDrag(event, current, payload);
    }
    if (drag) moveDrag(event, current, payload);
    else applyPointerDefault(payload);
  }

  function onPointerUp(event) {
    const current = point(event); const payload = payloadAt(current.x, current.y, event);
    clearLongPress();
    const hadDrag = !!drag;
    if (drag) finishDrag(event, payload);
    activePointers.delete(event.pointerId); pinch = null;
    emit('pointer-up', payload);
    if (!hadDrag && !suppressClick && event.button === 0) fireClick(payload, event);
    suppressClick = false;
  }

  function onPointerCancel(event) {
    clearLongPress();
    const current = point(event); const payload = payloadAt(current.x, current.y, event);
    if (drag) finishDrag(event, payload, true);
    activePointers.delete(event.pointerId); pinch = null;
  }

  function onContextMenu(event) {
    const current = point(event); context(payloadAt(current.x, current.y, event), event);
  }

  function onWheel(event) {
    const current = point(event);
    const payload = payloadAt(current.x, current.y, event, { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode });
    if (emit('wheel', payload)) return;
    event.preventDefault();
    const frame = getFrame();
    const inLens = !!frame.rows.lens && current.y >= frame.geometry.events.y1 && current.y <= frame.geometry.events.y2;
    if (inLens) actions.scrollLens(event.deltaY < 0 ? -1 : 1, 'user');
    else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) actions.panPixels(-event.deltaX, 'user', true);
    else actions.zoomAt(current.x, event.deltaY < 0 ? 'in' : 'out', 'user', true);
  }

  function keyPayload(event) {
    return { key: event.key, keyCode: event.keyCode, modifierKeys: modifiers(event), keyboardEvent: event };
  }

  function onKeyDown(event) {
    const payload = keyPayload(event);
    if (emit('key-down', payload)) return;
    if (event.key === 'Escape' || event.keyCode === 27) {
      if (drag) finishDrag(event, lastPointer ? payloadAt(lastPointer.x, lastPointer.y, event) : payload, true);
      actions.lens(null, 'user');
    }
  }

  function onKeyUp(event) { emit('key-up', keyPayload(event)); }

  listen(canvas, 'pointerdown', onPointerDown);
  listen(canvas, 'pointermove', onPointerMove);
  listen(canvas, 'pointerup', onPointerUp);
  listen(canvas, 'pointercancel', onPointerCancel);
  listen(canvas, 'pointerleave', () => { clearLongPress(); actions.setGuide?.(null); actions.setChartHighlight?.(null); actions.highlight([], 'user'); });
  listen(canvas, 'contextmenu', onContextMenu);
  listen(canvas, 'wheel', onWheel, { passive: false });
  listen(canvas, 'keydown', onKeyDown);
  listen(canvas, 'keyup', onKeyUp);

  return {
    afterDraw() {
      if (!destroyed && lastPointer && !activePointers.size) {
        onPointerMove({
          pointerId: lastPointer.pointerId, pointerType: lastPointer.pointerType, button: lastPointer.button,
          altKey: lastPointer.alt, ctrlKey: lastPointer.ctrl, metaKey: lastPointer.meta, shiftKey: lastPointer.shift,
        }, true);
      }
    },
    destroy() {
      destroyed = true; clearLongPress();
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      listeners.splice(0).forEach(remove => remove());
      activePointers.clear();
    },
  };
}
