const compareText = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function eventTimes(normalized) {
  const times = Object.fromEntries(Object.keys(normalized.entities).map(id => [id, { first: null, last: null, count: 0 }]));
  Object.values(normalized.events).forEach(event => {
    event.endpoints.all.forEach(id => {
      const entry = times[id];
      if (!entry) return;
      const start = event.range.start.epochNanoseconds;
      const end = event.range.end.epochNanoseconds;
      entry.first = entry.first === null || start < entry.first ? start : entry.first;
      entry.last = entry.last === null || end > entry.last ? end : entry.last;
      entry.count += 1;
    });
  });
  return times;
}

function compareEntities(a, b, ordering, times, keyOrder) {
  if (ordering === 'keyorder') return keyOrder.get(a.id) - keyOrder.get(b.id);
  if (ordering === 'alphabetical') return compareText(a.style.label, b.style.label) || compareText(a.id, b.id);
  if (ordering === 'firstevent') {
    const left = times[a.id].first ?? 2n ** 126n;
    const right = times[b.id].first ?? 2n ** 126n;
    return left < right ? -1 : left > right ? 1 : compareText(a.id, b.id);
  }
  if (ordering === 'lastevent') {
    const left = times[a.id].last ?? -(2n ** 126n);
    const right = times[b.id].last ?? -(2n ** 126n);
    return left > right ? -1 : left < right ? 1 : compareText(a.id, b.id);
  }
  return keyOrder.get(a.id) - keyOrder.get(b.id);
}

function groupPath(entity) {
  const values = (entity.style.groupBy || []).map(key => String(entity.input.data?.[key] ?? '')).reverse();
  return [entity.typeName, ...values];
}

function rowId(kind, parts) {
  return `_${kind}|${parts.map(encodeURIComponent).join('|')}`;
}

function makeGroups(entities) {
  const roots = new Map();
  entities.forEach(entity => {
    const path = groupPath(entity);
    let level = roots;
    path.forEach((part, index) => {
      if (!level.has(part)) level.set(part, { key: part, path: path.slice(0, index + 1), entities: [], children: new Map() });
      const group = level.get(part);
      group.entities.push(entity);
      level = group.children;
    });
  });
  return roots;
}

// Port of Chronograph's 'shorteneventlines' ordering: a greedy pass that places strongly linked rows
// next to each other, weighing links to rows outside the group by where those rows already sit.
class SelectionList {
  constructor(info, nodes) {
    this.info = info; this.lists = new Map(); this.minimum = Infinity; this.set = new Set(nodes);
    this.set.forEach(node => {
      const factor = info.factors.get(node);
      if (factor < this.minimum) this.minimum = factor;
      this.nodesAt(factor).add(node);
    });
  }

  nodesAt(factor) {
    let list = this.lists.get(factor);
    if (!list) { list = new Set(); this.lists.set(factor, list); }
    return list;
  }

  remove(node, factor, list) {
    if (!this.set.has(node)) return;
    this.set.delete(node); list.delete(node);
    if (factor !== this.minimum) return;
    if (this.set.size === 0) { this.minimum = Infinity; return; }
    let current = this.nodesAt(factor);
    while (current.size === 0) { this.minimum++; current = this.nodesAt(this.minimum); }
  }

  update(node, from, to) {
    this.nodesAt(from).delete(node); this.nodesAt(to).add(node);
    this.minimum = Math.min(this.minimum, to);
  }
}

class SelectionClass {
  constructor(nodes, info) { this.info = info; this.front = new SelectionList(info, []); this.all = new SelectionList(info, nodes); }

  initial() {
    const factor = this.all.minimum;
    return [this.all.nodesAt(factor).values().next().value, factor];
  }

  remove(node, factor, list) {
    const at = factor ?? this.info.factors.get(node);
    this.all.remove(node, at, this.all.nodesAt(at));
    this.front.remove(node, at, list || this.front.nodesAt(at));
  }

  update(node, from, to) { this.front.update(node, from, to); this.all.update(node, from, to); }
}

function orderTopologyGroups(roots, normalized, keyOrder, allEntities) {
  const present = new Map();
  const root = { key: '', children: roots, entities: [], parent: null };
  const parentOf = new Map();
  const visit = group => {
    if (group.children.size) group.children.forEach(child => { parentOf.set(child, group); visit(child); });
    else group.entities.forEach(entity => { parentOf.set(entity, group); present.set(entity.id, entity); });
  };
  visit(root);
  const chain = node => { const list = [node]; while (parentOf.get(list.at(-1))) list.push(parentOf.get(list.at(-1))); return list; };
  const states = new Map();
  const stateOf = group => {
    let state = states.get(group);
    if (!state) {
      state = { internal: new Map(), external: new Map(), factors: new Map(), weighted: new Map(), degree: 0, internalDegree: new Map(), pullup: new Map(), ordered: [] };
      states.set(group, state);
    }
    return state;
  };
  const bump = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);
  const nested = (map, key) => { let inner = map.get(key); if (!inner) { inner = new Map(); map.set(key, inner); } return inner; };

  const links = new Map();
  const link = (left, right) => { if (left !== right) { bump(nested(links, left), right, 1); bump(nested(links, right), left, 1); } };
  Object.values(normalized.events).forEach(event => {
    const from = event.endpoints.from.map(id => present.get(id)).filter(Boolean);
    const to = event.endpoints.to.map(id => present.get(id)).filter(Boolean);
    if (!from.length || !to.length) return;
    if (from.length === 1) to.forEach(target => link(from[0], target));
    else if (to.length === 1) from.forEach(source => link(source, to[0]));
    else { const all = from.concat(to); all.forEach((node, index) => link(node, index === 0 ? all.at(-1) : all[index - 1])); }
  });

  const addInternal = (node, other, reference, weight, state) => {
    const inner = nested(state.internal, other);
    const previous = inner.get(reference) || 0;
    if (previous === 0) { bump(state.internalDegree, node, 1); state.degree += 1; }
    inner.set(reference, previous + weight);
  };
  const addExternal = (node, other, reference, weight, group) => {
    const state = stateOf(group);
    const inner = nested(state.external, node);
    const previous = inner.get(other);
    inner.set(other, previous ? { weight: previous.weight + weight, reference } : { weight, reference });
  };
  const walk = (path, near, far, weight, state) => {
    for (let index = 0; index < path.length - 1; index++) {
      const node = path[index];
      if (node === near) { addInternal(node, far, near, weight, state); return; }
      addExternal(node, far, near, weight, parentOf.get(node));
    }
  };
  const seen = new Set();
  [...present.values()].forEach(entity => {
    const neighbours = links.get(entity);
    if (neighbours) neighbours.forEach((weight, other) => {
      if (!seen.has(other)) return;
      const left = chain(entity); const right = chain(other);
      let li = 0; let ri = 0; const gap = left.length - right.length;
      if (gap > 0) li = gap; else ri = -gap;
      while (left[li] !== right[ri]) { li++; ri++; }
      const common = left[li]; const nearA = left[li - 1]; const nearB = right[ri - 1];
      const state = stateOf(common);
      bump(state.weighted, nearA, weight); bump(state.weighted, nearB, weight);
      walk(left, nearA, nearB, weight, state); walk(right, nearB, nearA, weight, state);
    });
    seen.add(entity);
  });

  // Chronograph creates groups while walking every entity, so group order follows first appearance among all of them.
  const created = new Map();
  allEntities.forEach((entity, index) => {
    const path = groupPath(entity);
    path.forEach((_, depth) => { const id = path.slice(0, depth + 1).join('\u0000'); if (!created.has(id)) created.set(id, index); });
  });
  const createdAt = group => created.get(group.path.join('\u0000')) ?? Infinity;
  const childrenOf = group => (group.children.size ? [...group.children.values()].sort((a, b) => createdAt(a) - createdAt(b)) : [...group.entities]);
  const typeOrder = group => normalized.entityTypes.resolved[group.key]?.order ?? 0;
  const orderChildren = (group, classes) => {
    const info = stateOf(group);
    const children = classes.flat();
    if (children.length < 2) return children;
    children.forEach(child => {
      let adjustment = 0;
      const outside = info.external.get(child);
      if (outside) outside.forEach(({ weight, reference }, node) => {
        const siblings = stateOf(parentOf.get(node)).ordered;
        adjustment += siblings.indexOf(node) > siblings.indexOf(reference) ? -weight : weight;
      });
      info.factors.set(child, (info.weighted.get(child) || 0) - adjustment);
    });
    const lists = classes.map(nodes => new SelectionClass(nodes, info));
    let pivot = null; const output = [];
    const neighbours = node => new Set((info.internal.get(node) || new Map()).keys());
    const pull = (node, other, list) => {
      const factor = info.factors.get(other);
      const next = factor - 2 * info.internal.get(node).get(other);
      info.factors.set(other, next);
      if (list) { list.update(other, factor, next); if (!list.front.set.has(other)) list.front.set.add(other); }
      bump(info.pullup, other, 1);
    };
    const scan = node => {
      const around = neighbours(node);
      if (pivot && around.has(pivot)) pull(node, pivot);
      lists.forEach(list => {
        // The intersection walks the smaller set, which fixes the order ties are later broken in.
        const [small, large] = around.size < list.all.set.size ? [around, list.all.set] : [list.all.set, around];
        [...small].filter(other => large.has(other)).forEach(other => pull(node, other, list));
      });
    };
    const release = list => {
      if (pivot && (list.front.set.size === 0 || info.factors.get(pivot) <= 0)) { output.push(pivot); pivot = null; }
    };
    const shouldPivot = (node, list) => {
      const degree = info.internalDegree.get(node) || 0;
      const hub = degree > Math.ceil(info.degree / children.length);
      const pulled = info.pullup.get(node) || 0;
      return list.front.minimum > 0 && hub && degree - pulled > 1 && (!pivot || list.front.minimum >= info.factors.get(pivot));
    };
    lists.forEach(list => {
      while (list.all.set.size) {
        const [start, factor] = list.initial();
        output.push(start); list.remove(start, factor, undefined);
        let current = start;
        for (;;) {
          scan(current); release(list);
          if (list.front.set.size === 0) break;
          const minimum = list.front.minimum;
          const bucket = list.front.nodesAt(minimum);
          current = bucket.values().next().value;
          if (shouldPivot(current, list)) { if (pivot) output.push(pivot); pivot = current; list.remove(current, minimum, bucket); }
          else { output.push(current); list.remove(current, minimum, bucket); }
        }
      }
    });
    return output;
  };
  const place = (group, ordered) => {
    stateOf(group).ordered = ordered;
    if (group.children.size) {
      group.children.clear(); ordered.forEach(child => group.children.set(child.key, child));
      ordered.forEach(child => place(child, orderChildren(child, [childrenOf(child)])));
    } else group.entities = ordered;
  };
  // Leaf groups keep ordering in `entities`; recurse so child groups see their parents' final order.
  const topLevel = [...roots.values()].sort((left, right) => typeOrder(left) - typeOrder(right) || createdAt(left) - createdAt(right));
  const classes = [];
  topLevel.forEach((group, index) => {
    if (index === 0 || typeOrder(group) !== typeOrder(topLevel[index - 1])) classes.push([]);
    classes.at(-1).push(group);
  });
  const rootOrdered = classes.length ? orderChildren(root, classes) : [];
  stateOf(root).ordered = rootOrdered;
  roots.clear(); rootOrdered.forEach(group => roots.set(group.key, group));
  rootOrdered.forEach(group => place(group, orderChildren(group, [childrenOf(group)])));
}

function pruneGroups(groups, keep) {
  [...groups].forEach(([key, group]) => {
    if (group.children.size) pruneGroups(group.children, keep);
    else group.entities = group.entities.filter(entity => keep.has(entity.id));
    group.entities = group.entities.filter(entity => keep.has(entity.id));
    if (!group.entities.length) groups.delete(key);
  });
}

function flattenGroups(groups, output, typeState) {
  [...groups.values()].forEach(group => {
    const type = typeState.resolved[group.path[0]] || typeState.resolved.default;
    const isType = group.path.length === 1;
    const label = isType ? (type.typeLabel === false ? '' : type.typeLabel || group.key) : group.key;
    // Chronograph paints no header for the implicit 'default' type unless it is labelled explicitly.
    const implicit = isType && group.key === 'default' && type.typeLabel === undefined;
    if (!implicit && (label || group.children.size)) {
      output.push({
        id: rowId('group', group.path), type: 'group', label,
        entityIds: group.entities.map(entity => entity.id), depth: group.path.length - 1,
        groupPath: [...group.path], style: type,
      });
    }
    if (group.children.size) flattenGroups(group.children, output, typeState);
    else group.entities.forEach(entity => output.push({
      id: entity.id, type: 'entity', label: entity.style.label,
      entityIds: [entity.id], entity, depth: group.path.length - (implicit ? 1 : 0),
      groupPath: [...group.path],
    }));
  });
}

function runRow(members) {
  const first = members[0];
  if (members.length === 1) return first;
  return {
    id: rowId('run', [first.id, members.at(-1).id]), type: 'run',
    label: `${first.label} – ${members.at(-1).label}`,
    entityIds: members.flatMap(row => row.entityIds), depth: Math.min(...members.map(row => row.depth)),
    groupPath: first.groupPath,
  };
}

function compressRows(rows, capacity, pinned) {
  const fixed = rows.filter(row => row.type === 'entity' && pinned.has(row.id));
  const body = rows.filter(row => row.type !== 'entity' || !pinned.has(row.id)).map(row => row.type === 'group'
    ? { ...row, entityIds: row.entityIds.filter(id => !pinned.has(id)) }
    : row);
  const entityCount = body.filter(row => row.type === 'entity').length;
  if (fixed.length + body.length <= capacity) return [...fixed, ...body];

  const groups = [];
  body.forEach((row, index) => {
    if (row.type !== 'entity') return;
    const key = row.groupPath.join('\0');
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, indexes: [], rows: [] };
      groups.push(group);
    }
    group.indexes.push(index); group.rows.push(row);
  });
  const groupSlots = Math.max(groups.length, capacity - fixed.length - (body.length - entityCount));
  const slots = new Map(groups.map(group => [group.key, 1]));
  let remaining = Math.max(0, groupSlots - groups.length);
  while (remaining > 0) {
    const group = groups
      .filter(item => slots.get(item.key) < item.rows.length)
      .sort((a, b) => b.rows.length / slots.get(b.key) - a.rows.length / slots.get(a.key))[0];
    if (!group) break;
    slots.set(group.key, slots.get(group.key) + 1); remaining -= 1;
  }
  const replacements = new Map();
  groups.forEach(group => {
    const count = slots.get(group.key);
    const size = Math.ceil(group.rows.length / count);
    const compressed = [];
    for (let index = 0; index < group.rows.length; index += size) compressed.push(runRow(group.rows.slice(index, index + size)));
    replacements.set(group.indexes[0], { indexes: new Set(group.indexes), rows: compressed });
  });
  const output = [];
  body.forEach((row, index) => {
    const replacement = replacements.get(index);
    if (replacement) output.push(...replacement.rows);
    else if (row.type !== 'entity' || !groups.some(group => group.indexes.includes(index))) output.push(row);
  });
  return [...fixed, ...output];
}

function applyLens(rows, entityRows, lensId, height, standardHeight, offset = 0) {
  if (!lensId) return { rows, lens: null };
  const centerIndex = entityRows.findIndex(row => row.id === lensId);
  if (centerIndex < 0) return { rows, lens: null };
  const detailCount = Math.max(1, Math.min(entityRows.length, Math.floor(height / standardHeight) - 2));
  const half = Math.floor(detailCount / 2);
  const maximumStart = Math.max(0, entityRows.length - detailCount);
  const startEntity = Math.max(0, Math.min(maximumStart, centerIndex - half + offset));
  const detail = entityRows.slice(startEntity, startEntity + detailCount);
  const detailIds = new Set(detail.map(row => row.id));
  let insertion = rows.findIndex(row => row.type !== 'group' && row.entityIds.some(id => detailIds.has(id)));
  if (insertion < 0) insertion = rows.length;
  const compact = [];
  rows.forEach((row, index) => {
    if (index === insertion) compact.push(...detail);
    if (row.type === 'group') { compact.push(row); return; }
    const remaining = row.entityIds.filter(id => !detailIds.has(id));
    if (!remaining.length) return;
    if (remaining.length === row.entityIds.length) compact.push(row);
    else {
      const members = remaining.map(id => entityRows.find(item => item.id === id)).filter(Boolean);
      compact.push(runRow(members));
    }
  });
  if (insertion === rows.length) compact.push(...detail);
  const start = compact.findIndex(row => row.id === detail[0]?.id);
  const end = start + detail.length;
  return {
    rows: compact,
    lens: {
      entityId: lensId, rowIndex: compact.findIndex(row => row.id === lensId), start, end,
      entityStart: startEntity, entityCount: entityRows.length,
      firstEntityId: detail[0]?.id || null, lastEntityId: detail.at(-1)?.id || null,
      previousEntityId: entityRows[centerIndex - 1]?.id || null,
      nextEntityId: entityRows[centerIndex + 1]?.id || null,
      canScrollUp: centerIndex > 0, canScrollDown: centerIndex + 1 < entityRows.length,
    },
  };
}

/** Derive the one row snapshot shared by rendering, hit testing, and public queries. */
export function deriveRows(model, { y1 = 0, y2 = 100, lensOffset = 0 } = {}) {
  const normalized = model.normalized;
  const options = model.options();
  const focus = new Set(model.focus());
  const pinned = new Set(model.getPinnedEntityIds());
  const relevant = new Set(Object.keys(model.getInRangeItems({ focus: true }).entities));
  pinned.forEach(id => relevant.add(id));
  focus.forEach(id => { if (normalized.entities[id]) relevant.add(id); });
  const allEntities = Object.values(normalized.entities);
  let entities = relevant.size ? allEntities.filter(entity => relevant.has(entity.id)) : allEntities.filter(() => Object.keys(normalized.events).length === 0);
  const times = eventTimes(normalized);
  const keyOrder = new Map(Object.keys(normalized.entities).map((id, index) => [id, index]));
  entities.sort((a, b) => compareEntities(a, b, normalized.ordering, times, keyOrder));
  if (focus.size && options.focus.reorder) entities.sort((a, b) => Number(!focus.has(a.id)) - Number(!focus.has(b.id)));

  const natural = [];
  let groups;
  if (normalized.ordering === 'shorteneventlines') {
    // Chronograph orders every entity, including ones with nothing in range, then hides the idle rows.
    const everyone = [...allEntities].sort((a, b) => keyOrder.get(a.id) - keyOrder.get(b.id));
    groups = makeGroups(everyone);
    orderTopologyGroups(groups, normalized, keyOrder, everyone);
    pruneGroups(groups, new Set(entities.map(entity => entity.id)));
  } else groups = makeGroups(entities);
  flattenGroups(groups, natural, normalized.entityTypes);
  const height = Math.max(0, y2 - y1);
  const standardHeight = options.entities.standardRowHeight;
  const entityRows = natural.filter(row => row.type === 'entity');
  const compressed = entityRows.length * standardHeight > height;
  let rows = compressed || pinned.size
    ? compressRows(natural, compressed ? Math.max(1, Math.floor(height / Math.max(3, standardHeight / 3))) : natural.length, pinned)
    : natural;
  const lensed = applyLens(rows, entityRows, model.lens(), height, standardHeight, lensOffset);
  rows = lensed.rows;
  const compactHeight = compressed ? Math.max(3, Math.min(standardHeight, height / Math.max(1, rows.length))) : standardHeight;
  // Chronograph gives each uncompressed row a slot of up to 2x the standard height (5px margins), centred vertically.
  const spaced = !compressed && !lensed.lens && rows.length > 0;
  // Group headers take 1.5x the standard height in Chronograph; entity rows take a 2x slot.
  const slotFor = row => (row.type === 'group' ? 1.5 : 2) * standardHeight;
  const total = spaced ? rows.reduce((sum, row) => sum + slotFor(row), 0) : 0;
  const fit = spaced ? Math.min(1, (height - 10) / total) : 1;
  let cursor = spaced ? y1 + Math.max(0, (height - total * fit) / 2) : y1;
  rows.forEach((row, index) => {
    let rowHeight = compactHeight;
    if (lensed.lens && index >= lensed.lens.start && index < lensed.lens.end) rowHeight = standardHeight;
    if (spaced) {
      const slot = Math.max(standardHeight, slotFor(row) * fit);
      row.y1 = cursor + (slot - standardHeight) / 2; row.y2 = row.y1 + standardHeight; row.height = standardHeight;
      cursor += slot; return;
    }
    row.y1 = cursor;
    row.y2 = Math.min(y2, cursor + rowHeight);
    row.height = row.y2 - row.y1;
    cursor = row.y2;
  });
  const visibleRows = rows.filter(row => row.y1 < y2 && row.y2 > y1 && row.height > 0);
  const rowIndex = Object.fromEntries(rows.map(row => [row.id, row]));
  const entityIndex = Object.create(null);
  rows.forEach(row => row.entityIds.forEach(id => { entityIndex[id] = row; }));
  return { rows, visibleRows, rowIndex, entityIndex, compressed, lens: lensed.lens, bounds: { y1, y2 }, standardRowHeight: standardHeight };
}

export function getRowEntityIds(snapshot, id) {
  const row = snapshot?.rowIndex[id];
  return row ? [...row.entityIds] : null;
}

export function lensScrollOffset(snapshot, direction) {
  if (!snapshot?.lens) return 0;
  if (direction < 0) return snapshot.lens.previousEntityId ? -1 : 0;
  return snapshot.lens.nextEntityId ? 1 : 0;
}

export function lensScrollTarget(snapshot, direction) {
  if (!snapshot?.lens) return null;
  return direction < 0 ? snapshot.lens.previousEntityId : snapshot.lens.nextEntityId;
}
