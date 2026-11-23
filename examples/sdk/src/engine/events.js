/**
 * SCAFFOLD event bus shared by the stand-in chart and time bar. Original code.
 *
 * `on/off` take the hyphenated event names and call handlers with one props
 * object. `bind/unbind` take the legacy names and call handlers with
 * positional arguments built by `legacyArgs`. An `all` handler sees every
 * event as `{ name, event }` (modern) or `(name, ...args)` (legacy).
 */

/** Legacy name -> modern name. */
export const LEGACY_NAMES = {
  click: 'click', dblclick: 'double-click', contextmenu: 'context-menu',
  mousedown: 'pointer-down', touchdown: 'pointer-down', hover: 'hover',
  mousewheel: 'wheel', dragstart: 'drag-start', dragend: 'drag-end',
  dragcomplete: 'drag-end', dragover: 'drag-over', keydown: 'key-down',
  selectionchange: 'selection-change', viewchange: 'view-change',
  prechange: 'prechange', progress: 'progress', map: 'map', change: 'change',
  play: 'play', pause: 'pause', start: 'start', end: 'end', overview: 'overview',
};

/** Positional legacy args from a modern props object. */
function legacyArgs(props) {
  if (!props || typeof props !== 'object') return [];
  if ('id' in props || 'x' in props) return [props.id ?? null, props.x, props.y, props.button, props.subItem];
  if ('type' in props) return [props.type];
  return [];
}

export function createEmitter({ allowDuplicates = false } = {}) {
  const handlers = new Map(); // modern name -> Set(fn) or Array(fn)
  const legacy = new Map(); // legacy name -> Map(userFn -> wrapper)

  function on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError(`on('${name}'): handler must be a function`);
    if (!handlers.has(name)) handlers.set(name, allowDuplicates ? [] : new Set());
    if (allowDuplicates) handlers.get(name).push(fn);
    else handlers.get(name).add(fn);
  }

  function off(name, fn) {
    if (name === undefined) { handlers.clear(); return; }
    if (fn === undefined) handlers.delete(name);
    else if (handlers.has(name)) {
      if (allowDuplicates) handlers.set(name, handlers.get(name).filter(handler => handler !== fn));
      else handlers.get(name).delete(fn);
    }
  }

  function bind(name, fn) {
    const modern = name === 'all' ? 'all' : LEGACY_NAMES[name] || name;
    const wrapper = name === 'all'
      ? ({ name: n, event }) => fn(n, ...legacyArgs(event))
      : props => fn(...legacyArgs(props));
    if (!legacy.has(name)) legacy.set(name, new Map());
    if (legacy.get(name).has(fn)) return; // already bound: binding twice must not fire twice
    legacy.get(name).set(fn, wrapper);
    on(modern, wrapper);
  }

  function unbind(name, fn) {
    if (name === undefined) { legacy.forEach((m, n) => unbind(n)); return; }
    const modern = name === 'all' ? 'all' : LEGACY_NAMES[name] || name;
    const map = legacy.get(name);
    if (!map) return;
    const fns = fn === undefined ? [...map.keys()] : [fn];
    fns.forEach(f => { off(modern, map.get(f)); map.delete(f); });
  }

  /** Calls every handler; returns true if any handler called preventDefault(). */
  function emit(name, props) {
    let prevented = !!(props && typeof props === 'object' && props.defaultPrevented);
    let event = props;
    if (props && typeof props === 'object') {
      event = { ...props, preventDefault: () => { prevented = true; } };
      Object.defineProperty(event, 'defaultPrevented', {
        enumerable: true,
        get: () => prevented,
      });
    }
    // Snapshot each collection so removing a later handler does not alter this dispatch.
    // One throwing handler must not stop the others, or the caller (e.g. a redraw).
    const call = (fn, arg, hasArgument = true) => {
      try { if (hasArgument) fn(arg); else fn(); } catch (err) { setTimeout(() => { throw err; }); }
    };
    [...(handlers.get(name) || [])].forEach(fn => call(fn, event, props !== undefined));
    [...(handlers.get('all') || [])].forEach(fn => call(fn, { name, event }));
    return prevented;
  }

  const count = collection => allowDuplicates ? collection?.length || 0 : collection?.size || 0;
  const has = name => count(handlers.get(name)) + count(handlers.get('all')) > 0;

  return { on, off, bind, unbind, emit, has, clear: () => { handlers.clear(); legacy.clear(); } };
}
