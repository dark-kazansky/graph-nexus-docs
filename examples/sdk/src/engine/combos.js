/**
 * SCAFFOLD combos for the stand-in chart. Original code.
 *
 * A combo is an ordinary node carrying `_combo: { open, offsets }`; its
 * children carry `parentId`. Children store their offset from the combo
 * centre, so moving a combo moves its contents. A closed combo hides its
 * children and the renderer reroutes their links to the combo (see
 * `visibleEnd`). Nested combos work the same way.
 */

import { DEFAULT_NODE_RADIUS, arrangeNodes } from './layouts.js';

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

export const isComboNode = node => !!(node && node._combo);

/** Parent chain of `id`, nearest first. */
export function ancestors(nodes, id) {
  const out = [];
  let node = nodes[id];
  // Only real combos count as parents: a parentId pointing at a plain node is ignored.
  while (node && node.parentId != null && isComboNode(nodes[node.parentId])) {
    out.push(node.parentId);
    node = nodes[node.parentId];
  }
  return out;
}

/** True if the node is drawn: not hidden, and every enclosing combo is open. */
export function isNodeVisible(nodes, id) {
  const node = nodes[id];
  if (!node || node.hi) return false;
  return ancestors(nodes, id).every(p => nodes[p]._combo.open && !nodes[p].hi);
}

/** The node a link end is drawn at: the node itself, or its outermost closed combo. */
export function visibleEnd(nodes, id) {
  const chain = ancestors(nodes, id);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!nodes[chain[i]]._combo.open) return chain[i];
  }
  return id;
}

/** All descendant ids of a combo (not including itself). */
export function descendants(nodes, comboId) {
  const out = [];
  Object.values(nodes).forEach(node => {
    if (node.parentId === comboId) {
      out.push(node.id);
      if (isComboNode(node)) out.push(...descendants(nodes, node.id));
    }
  });
  return out;
}

/** Radius that encloses an open combo's children. */
export function openRadius(nodes, combo) {
  let r = DEFAULT_NODE_RADIUS * (combo.e || 1);
  Object.values(combo._combo.offsets).forEach(o => {
    const child = nodes[o.id];
    if (!child || child.hi) return;
    const cr = isComboNode(child) && child._combo.open ? openRadius(nodes, child) : DEFAULT_NODE_RADIUS * (child.e || 1);
    // ponytail: flat allowance for a child's outside label (e.g. position 's'), not its measured size.
    const labelPad = asList(child.t).some(l => l && typeof l.position === 'string') ? DEFAULT_NODE_RADIUS * 0.6 : 0;
    r = Math.max(r, Math.hypot(o.dx, o.dy, o.dz || 0) + cr + labelPad + DEFAULT_NODE_RADIUS * 0.5);
  });
  return r;
}

/** Offset of `child` from `combo`: dx, dy, and dz when either has a z. */
export function comboOffset(combo, child) {
  const o = { id: child.id, dx: (child.x || 0) - combo.x, dy: (child.y || 0) - combo.y };
  if (Number.isFinite(child.z) || Number.isFinite(combo.z)) o.dz = (child.z || 0) - (combo.z || 0);
  return o;
}

/** Writes child positions from the combo centre + stored offsets (recursively). */
export function syncChildren(nodes, comboId) {
  const combo = nodes[comboId];
  if (!isComboNode(combo)) return;
  Object.values(combo._combo.offsets).forEach(o => {
    const child = nodes[o.id];
    if (!child) return;
    child.x = combo.x + o.dx;
    child.y = combo.y + o.dy;
    // Depth only once the combo or child has one (3D view), so 2D items never gain a z.
    if (o.dz !== undefined || Number.isFinite(combo.z)) child.z = (combo.z || 0) + (o.dz || 0);
    if (isComboNode(child)) syncChildren(nodes, child.id);
  });
}

/**
 * @param {object} host  { nodes(), links(), render(), select(ids), changed() }
 */
export function createComboApi(host) {
  let counter = 0;
  let revealed = [];

  function addChild(combo, child) {
    child.parentId = combo.id;
    combo._combo.offsets[child.id] = comboOffset(combo, child);
  }

  function removeChild(combo, child) {
    delete combo._combo.offsets[child.id];
    const parent = host.nodes()[combo.parentId];
    if (parent && isComboNode(parent)) addChild(parent, child);
    else delete child.parentId;
  }

  const api = {
    combine(definitions, options = {}) {
      const nodes = host.nodes();
      const created = asList(definitions).map(def => {
        const ids = asList(def.ids).filter(id => nodes[id]);
        if (ids.length === 0) return null;
        let id;
        do { id = `_combo_${++counter}`; } while (nodes[id]);
        const first = nodes[ids[0]];
        const avg = ids.reduce((acc, i) => ({ x: acc.x + (nodes[i].x || 0) / ids.length, y: acc.y + (nodes[i].y || 0) / ids.length }), { x: 0, y: 0 });
        const at = def.position === 'first' ? { x: first.x || 0, y: first.y || 0 } : avg;
        // In 3D the combo sits at its children's mean depth (or the first child's).
        const deep = ids.filter(i => Number.isFinite(nodes[i].z));
        if (deep.length) at.z = def.position === 'first' ? first.z || 0 : deep.reduce((sum, i) => sum + nodes[i].z, 0) / ids.length;
        // A combo of items that share a parent stays inside that parent.
        const commonParent = ids.every(i => nodes[i].parentId === first.parentId) ? first.parentId : undefined;
        const combo = {
          type: 'node',
          id,
          x: at.x + (def.dx || 0),
          y: at.y + (def.dy || 0),
          ...(at.z !== undefined ? { z: at.z } : {}),
          c: '#cfd8dc',
          b: '#90a4ae',
          e: Math.min(4, 1 + Math.sqrt(ids.length) * 0.35),
          t: def.label ?? '',
          d: def.d,
          ...(def.style || {}),
          // `glyph` replaces the counter glyph (null removes it); undefined keeps the default.
          _combo: { open: !!def.open, offsets: {}, openStyle: def.openStyle || {}, glyph: 'glyph' in def ? def.glyph : undefined },
        };
        nodes[id] = combo;
        if (commonParent != null && nodes[commonParent]) addChild(nodes[commonParent], combo);
        ids.forEach(childId => {
          const child = nodes[childId];
          const oldParent = nodes[child.parentId];
          if (oldParent && isComboNode(oldParent)) delete oldParent._combo.offsets[childId];
          addChild(combo, child);
        });
        if (options.arrange !== 'none') {
          const arrange = typeof options.arrange === 'object' ? options.arrange : { name: options.arrange };
          arrangeChildren(combo, arrange.name, arrange);
        }
        return id;
      }).filter(Boolean);
      if (options.select) host.select(created);
      host.changed();
      return Promise.resolve(created);
    },

    uncombine(ids, options = {}) {
      const nodes = host.nodes();
      const run = id => {
        const combo = nodes[id];
        if (!isComboNode(combo)) return [];
        syncChildren(nodes, id);
        const children = Object.keys(combo._combo.offsets).map(c => nodes[c]).filter(Boolean);
        children.forEach(child => removeChild(combo, child));
        const parent = nodes[combo.parentId];
        if (parent && isComboNode(parent)) delete parent._combo.offsets[id];
        // Links drawn to the combo itself go with it.
        Object.values(host.links()).forEach(l => { if (l.id1 === id || l.id2 === id) delete host.links()[l.id]; });
        delete nodes[id];
        const freed = children.map(c => c.id);
        if (options.full) children.filter(isComboNode).forEach(c => freed.push(...run(c.id)));
        return freed;
      };
      const freed = asList(ids).flatMap(run);
      if (options.select) host.select(freed.filter(id => nodes[id]));
      host.changed();
      return Promise.resolve();
    },

    open(ids) { return setOpen(ids, true); },
    close(ids) { return setOpen(ids, false); },

    isOpen(id) {
      const node = host.nodes()[id];
      return isComboNode(node) && node._combo.open;
    },

    isCombo(ids, options = {}) {
      // Only node combos exist here; there are no combo links.
      if (options.type === 'link') return false;
      return asList(ids).some(id => isComboNode(host.nodes()[id]));
    },

    find(ids, options = {}) {
      const nodes = host.nodes();
      const one = id => {
        const chain = ancestors(nodes, id);
        if (chain.length === 0) return null;
        return options.parent === 'first' ? chain[0] : chain[chain.length - 1];
      };
      return Array.isArray(ids) ? ids.map(one) : one(ids);
    },

    info(id) {
      const nodes = host.nodes();
      if (!isComboNode(nodes[id])) return null;
      const inside = new Set(descendants(nodes, id));
      return {
        nodes: [...inside].filter(c => nodes[c].parentId === id).map(c => nodes[c]),
        links: Object.values(host.links()).filter(l => inside.has(l.id1) && inside.has(l.id2)),
      };
    },

    reveal(ids) {
      if (ids !== undefined) {
        revealed = asList(ids).filter(id => host.links()[id]);
        host.render();
      }
      return revealed.slice();
    },

    transfer(ids, comboId, options = {}) {
      const nodes = host.nodes();
      const target = comboId == null ? null : nodes[comboId];
      if (comboId != null && !isComboNode(target)) return Promise.reject(new Error(`transfer: ${comboId} is not a combo`));
      asList(ids).forEach(id => {
        const node = nodes[id];
        if (!node || id === comboId || (target && ancestors(nodes, comboId).includes(id))) return;
        const old = nodes[node.parentId];
        if (old && isComboNode(old)) { syncChildren(nodes, old.id); delete old._combo.offsets[id]; }
        delete node.parentId;
        if (target) {
          if (!target._combo.open) { node.x = target.x; node.y = target.y; }
          addChild(target, node);
        }
      });
      if (target && options.arrange !== 'none') {
        const arrange = typeof options.arrange === 'object' ? options.arrange : { name: options.arrange };
        arrangeChildren(target, arrange.name, arrange);
      }
      host.changed();
      return Promise.resolve();
    },

    arrange(ids, options = {}) {
      asList(ids).forEach(id => {
        const combo = host.nodes()[id];
        if (isComboNode(combo)) arrangeChildren(combo, options.name, options);
      });
      host.render();
      return Promise.resolve();
    },
  };

  /**
   * Arranges a combo's children around its centre. `name`: 'lens' (default,
   * connected nodes together), 'concentric', 'grid' (honours gridShape),
   * 'sequential' (levels; honours level/top/orderBy/orientation/spacing/
   * stacking/stretch) or 'none'. Rectangular combos default to 'grid'.
   */
  function arrangeChildren(combo, name, opts = {}) {
    const nodes = host.nodes();
    const ids = Object.keys(combo._combo.offsets);
    const arrangement = name || (host.comboShape && host.comboShape() === 'rectangle' ? 'grid' : 'lens');
    if (arrangement === 'none' || ids.length === 0) return;
    syncChildren(nodes, combo.id);
    arrangeNodes(arrangement, nodes, host.links(), ids, { ...opts, position: 'absolute', x: combo.x, y: combo.y, tightness: opts.tightness ?? 8 });
    // Arrangements are flat: in 3D the children lie in the combo's own depth plane.
    ids.forEach(id => {
      const o = combo._combo.offsets[id];
      o.dx = nodes[id].x - combo.x;
      o.dy = nodes[id].y - combo.y;
      if (o.dz !== undefined) { o.dz = 0; nodes[id].z = combo.z || 0; }
    });
  }

  function setOpen(ids, open) {
    const nodes = host.nodes();
    asList(ids).forEach(id => {
      const combo = nodes[id];
      if (!isComboNode(combo)) return;
      combo._combo.open = open;
      syncChildren(nodes, id);
    });
    host.changed();
    return Promise.resolve();
  }

  return { api, revealed: () => revealed };
}
