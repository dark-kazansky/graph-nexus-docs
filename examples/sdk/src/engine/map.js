/**
 * Graph Nexus map mode. Original code.
 *
 * Uses the Leaflet the application supplies (`map().options({ leaflet: L })`
 * or a global `window.L`); otherwise it loads the copy bundled in
 * `assets/vendor/leaflet` (BSD-2-Clause, see its LICENSE), CSS included.
 * Bundled builds (dist/) find it via `GraphNexus.paths({ assets: '.../assets/' })`.
 * While shown, a Leaflet map
 * sits under the chart canvas, nodes with `pos: { lat, lng }` are drawn at
 * their geographic position, and nodes without `pos` are hidden.
 */

/** Base URL of the assets folder: GraphNexus.paths().assets, else next to src/. */
function assetsBase(host) {
  const configured = host.assets && host.assets();
  if (configured) return configured.replace(/\/?$/, '/');
  try { return new URL('../../assets/', import.meta.url).href; } catch { return null; }
}

let bundledLeaflet = null;
/** Loads assets/vendor/leaflet once: ESM import first, classic script as fallback; adds leaflet.css. */
function loadBundledLeaflet(host) {
  if (bundledLeaflet) return bundledLeaflet;
  const base = assetsBase(host);
  if (!base) return Promise.reject(new Error('map().show(): set GraphNexus.paths({ assets }) so the bundled Leaflet can be found, or supply Leaflet yourself'));
  const dir = `${base}vendor/leaflet/`;
  if (!document.querySelector('link[data-graph-nexus-leaflet]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${dir}leaflet.css`;
    css.dataset.graphNexusLeaflet = '';
    document.head.appendChild(css);
  }
  const viaScript = () => new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = `${dir}leaflet.js`;
    tag.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet script loaded without defining L')));
    tag.onerror = () => reject(new Error(`Could not load ${tag.src}`));
    document.head.appendChild(tag);
  });
  bundledLeaflet = import(/* webpackIgnore: true */ `${dir}leaflet-src.esm.js`).then(mod => mod.default || mod, viaScript);
  bundledLeaflet.catch(() => { bundledLeaflet = null; });
  return bundledLeaflet;
}

const DEFAULT_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
};

/**
 * @param {object} host { container, canvas, nodes(), render(), emit(name, props), fit() }
 */
export function createMapMode(host) {
  let settings = { animate: true, padding: 20, tiles: DEFAULT_TILES, time: 800, transition: 'restore' };
  let leafletMap = null;
  let mapDiv = null;
  let shown = false;
  let savedView = null;

  const L = () => settings.leaflet || (typeof window !== 'undefined' ? window.L : undefined);

  function located() {
    return Object.values(host.nodes()).filter(n => n.pos && Number.isFinite(n.pos.lat) && Number.isFinite(n.pos.lng));
  }

  const api = {
    isShown: () => shown,
    leafletMap: () => leafletMap,

    options(next) {
      if (next === undefined) return { ...settings };
      settings = { ...settings, ...next };
      if (shown && 'tiles' in next) { api.hide(); return api.show(); }
      return Promise.resolve();
    },

    show() {
      if (shown) return Promise.resolve();
      const supplied = L();
      return (supplied ? Promise.resolve(supplied) : loadBundledLeaflet(host)).then(leaflet => {
        if (shown || (host.isDestroyed && host.isDestroyed())) return;
        // transition 'restore' (default): hide() returns to the view from before show().
        savedView = host.saveView ? host.saveView() : null;
        host.emit('map', { type: 'showstart' });
        if (getComputedStyle(host.container).position === 'static') host.container.style.position = 'relative';
        mapDiv = document.createElement('div');
        Object.assign(mapDiv.style, { position: 'absolute', inset: '0', zIndex: '0' });
        host.container.insertBefore(mapDiv, host.canvas);
        Object.assign(host.canvas.style, { position: 'relative', zIndex: '1' });
        leafletMap = leaflet.map(mapDiv, { zoomControl: false, attributionControl: !!settings.tiles, maxZoom: 19 });
        if (settings.tiles) {
          const tiles = typeof settings.tiles === 'string' ? { url: settings.tiles } : settings.tiles;
          leaflet.tileLayer(tiles.url, tiles).addTo(leafletMap);
        }
        const pts = located().map(n => [n.pos.lat, n.pos.lng]);
        if (pts.length) leafletMap.fitBounds(pts, { padding: [settings.padding, settings.padding], animate: false, maxZoom: 16 });
        else leafletMap.setView([0, 0], 2);
        leafletMap.on('move zoom', host.render);
        shown = true;
        host.render();
        host.emit('map', { type: 'showend' });
      });
    },

    hide() {
      if (!shown) return Promise.resolve();
      host.emit('map', { type: 'hidestart' });
      leafletMap.remove();
      mapDiv.remove();
      leafletMap = null;
      mapDiv = null;
      shown = false;
      const transition = { animate: settings.animate !== false, time: settings.time };
      if (settings.transition === 'layout' || !savedView || !host.restoreView) host.fit(transition);
      else host.restoreView(savedView, transition);
      savedView = null;
      host.emit('map', { type: 'hideend' });
      return Promise.resolve();
    },

    /** View (container pixel) coordinates -> { lat, lng }. */
    mapCoordinates(x, y) {
      if (!shown) return null;
      const ll = leafletMap.containerPointToLatLng([x, y]);
      return { lat: ll.lat, lng: ll.lng };
    },

    /** { lat, lng } -> view coordinates. */
    viewCoordinates(lat, lng) {
      if (!shown) return null;
      const p = leafletMap.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    },
  };

  return {
    api,
    isShown: () => shown,
    /** Screen position of a node, or null when it has no `pos`. */
    project(node) {
      if (!node.pos) return null;
      return api.viewCoordinates(node.pos.lat, node.pos.lng);
    },
    moveNodeTo(node, x, y) { node.pos = api.mapCoordinates(x, y); },
    panBy(dx, dy) { leafletMap.panBy([-dx, -dy], { animate: false }); },
    /** Wheel zoom: fractional, proportional to the wheel delta, so trackpads stay smooth. */
    zoomAt(x, y, delta) {
      if (!delta) return;
      const step = Math.max(-1, Math.min(1, -delta / 200));
      leafletMap.setZoomAround([x, y], leafletMap.getZoom() + step, { animate: false });
    },
    zoomBy(step) { leafletMap.setZoom(leafletMap.getZoom() + step); },
    fit() {
      const pts = located().map(n => [n.pos.lat, n.pos.lng]);
      if (pts.length) leafletMap.fitBounds(pts, { padding: [settings.padding, settings.padding], maxZoom: 16, animate: settings.animate !== false, duration: (settings.time ?? 800) / 1000 });
    },
  };
}
