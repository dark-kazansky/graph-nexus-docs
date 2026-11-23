import {
  ALLOWED_VALUES, DEFAULT_CHART, DEFAULT_ENTITY_TYPE, DEFAULT_EVENT_TYPE,
  DEFAULT_MARKER, DEFAULT_OPTIONS, cloneDefaults,
} from './defaults.js';
import {
  assertAllowedProperties, assertBoolean, assertFiniteNumber, assertOneOf,
  assertPlainObject, assertString, assertUniqueStringArray, assertValidTime,
  fail, isPlainObject, parseColor, validateOptions, validateTimeRange, warn,
} from './validation.js';
import {
  chooseResolution, decodeTime, encodeTime, exportTimeRange, normalizeTime, normalizeTimeRange,
  toEpochNanoseconds, wrapTime, wrappedIntersects, WRAP_BASE_RANGES,
} from './time.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const floorDiv = (value, divisor) => {
  let result = value / divisor;
  if (value < 0n && value % divisor !== 0n) result -= 1n;
  return result;
};
const DATA_KEYS = ['entities', 'events', 'entityTypes', 'eventTypes', 'ordering', 'timeSeriesCharts', 'timeSeriesChartStacks'];
const ENTITY_KEYS = ['color', 'data', 'fadeOutsideRange', 'fontIcon', 'glyph', 'label', 'labelColor', 'lineWidth', 'type'];
const EVENT_KEYS = ['color', 'data', 'entityIds', 'fontIcon', 'lineWidth', 'showArrows', 'time', 'timeNanoseconds', 'type'];
const ENTITY_TYPE_KEYS = ['baseType', 'color', 'fadeOutsideRange', 'fontIcon', 'glyph', 'groupBy', 'labelColor', 'lineWidth', 'order', 'priority', 'typeGlyph', 'typeLabel'];
const EVENT_TYPE_KEYS = ['baseType', 'color', 'fontIcon', 'lineWidth', 'showArrows'];
const CHART_KEYS = ['color', 'data', 'fillAreaAlpha', 'label', 'labelColor', 'lineStyle', 'type'];
const STACK_KEYS = ['chartIds', 'label', 'labelColor'];
const POINT_KEYS = ['time', 'timeNanoseconds', 'value'];
const MARKER_KEYS = ['color', 'fontIcon', 'label', 'labelColor', 'showAtBottom', 'showAtTop', 'showLine', 'time', 'timeNanoseconds'];
const FONT_ICON_KEYS = ['color', 'dx', 'dy', 'fontFamily', 'fontWeight', 'scale', 'text'];
const GLYPH_KEYS = ['color', 'fontIcon'];

function clone(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  Object.entries(value).forEach(([key, item]) => { result[key] = clone(item, seen); });
  return result;
}

function merge(base, patch) {
  const result = clone(base);
  Object.entries(patch).forEach(([key, value]) => {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? merge(result[key], value) : clone(value);
  });
  return result;
}

function validateDictionary(value, context) {
  assertPlainObject(value, context);
  for (const id of Object.keys(value)) {
    if (!id) fail(context, `${context} contains an empty id`);
    assertPlainObject(value[id], `${context}['${id}']`);
  }
}

function validateColor(value, context, eventColor = false) {
  if (eventColor && ALLOWED_VALUES.eventColor.includes(value)) return;
  try { parseColor(value); } catch { fail(context, `${context} must be a supported CSS color${eventColor ? ' or event color mode' : ''}`); }
}

function validateFontIcon(value, context) {
  assertAllowedProperties(value, FONT_ICON_KEYS, context);
  if (own(value, 'color')) validateColor(value.color, `${context}.color`);
  ['dx', 'dy'].forEach(key => { if (own(value, key)) assertFiniteNumber(value[key], `${context}.${key}`); });
  if (own(value, 'scale')) assertFiniteNumber(value.scale, `${context}.scale`, { min: 0 });
  ['fontFamily', 'text'].forEach(key => { if (own(value, key)) assertString(value[key], `${context}.${key}`); });
  if (own(value, 'fontWeight') && typeof value.fontWeight !== 'string') assertFiniteNumber(value.fontWeight, `${context}.fontWeight`, { min: 0 });
}

function validateGlyph(value, context) {
  if (typeof value === 'boolean') return;
  assertAllowedProperties(value, GLYPH_KEYS, context);
  if (own(value, 'color')) validateColor(value.color, `${context}.color`);
  if (own(value, 'fontIcon')) validateFontIcon(value.fontIcon, `${context}.fontIcon`);
}

function validateEntity(value, context) {
  assertAllowedProperties(value, ENTITY_KEYS, context);
  ['color', 'labelColor'].forEach(key => { if (own(value, key)) validateColor(value[key], `${context}.${key}`); });
  ['label', 'type'].forEach(key => { if (own(value, key)) assertString(value[key], `${context}.${key}`); });
  if (own(value, 'fadeOutsideRange')) assertBoolean(value.fadeOutsideRange, `${context}.fadeOutsideRange`);
  if (own(value, 'lineWidth')) assertFiniteNumber(value.lineWidth, `${context}.lineWidth`, { min: 0 });
  if (own(value, 'fontIcon')) validateFontIcon(value.fontIcon, `${context}.fontIcon`);
  if (own(value, 'glyph')) validateGlyph(value.glyph, `${context}.glyph`);
}

function validateType(value, context, kind) {
  const entity = kind === 'entity';
  assertAllowedProperties(value, entity ? ENTITY_TYPE_KEYS : EVENT_TYPE_KEYS, context);
  if (own(value, 'baseType')) assertString(value.baseType, `${context}.baseType`);
  if (own(value, 'color')) validateColor(value.color, `${context}.color`, !entity);
  if (own(value, 'lineWidth')) {
    if (!entity && typeof value.lineWidth === 'string') assertString(value.lineWidth, `${context}.lineWidth`);
    else assertFiniteNumber(value.lineWidth, `${context}.lineWidth`, { min: 0 });
  }
  if (own(value, 'showArrows')) assertBoolean(value.showArrows, `${context}.showArrows`);
  if (own(value, 'fadeOutsideRange')) assertBoolean(value.fadeOutsideRange, `${context}.fadeOutsideRange`);
  if (own(value, 'fontIcon')) validateFontIcon(value.fontIcon, `${context}.fontIcon`);
  ['glyph', 'typeGlyph'].forEach(key => { if (own(value, key)) validateGlyph(value[key], `${context}.${key}`); });
  if (own(value, 'groupBy')) assertUniqueStringArray(value.groupBy, `${context}.groupBy`);
  ['order', 'priority'].forEach(key => { if (own(value, key)) assertFiniteNumber(value[key], `${context}.${key}`); });
  if (own(value, 'typeLabel') && value.typeLabel !== false) assertString(value.typeLabel, `${context}.typeLabel`);
}

function resolveTypes(input, defaults, kind) {
  const source = input || {};
  validateDictionary(source, `${kind}Types`);
  Object.entries(source).forEach(([id, value]) => validateType(value, `${kind}Types['${id}']`, kind));
  if (source.default?.baseType !== undefined) fail(`${kind}Types['default']`, "the default type cannot specify baseType");
  const resolved = Object.create(null);
  const resolving = new Set();
  function resolve(id) {
    if (resolved[id]) return resolved[id];
    if (resolving.has(id)) fail(`${kind}Types['${id}']`, `cyclic baseType chain involving '${id}'`);
    const value = source[id];
    if (!value) fail(`${kind}Types`, `missing referenced baseType '${id}'`);
    resolving.add(id);
    const base = id === 'default'
      ? defaults
      : value.baseType === undefined || value.baseType === 'default'
        ? resolve('default')
        : resolve(value.baseType);
    resolved[id] = { ...base, ...clone(value), id };
    resolving.delete(id);
    return resolved[id];
  }
  resolved.default = { ...defaults, ...(source.default ? clone(source.default) : {}), id: 'default' };
  Object.keys(source).forEach(resolve);
  return { source, resolved, resolve };
}

function normalizeEndpoints(value, context, entityIds) {
  let from;
  let to;
  if (Array.isArray(value)) {
    assertUniqueStringArray(value, context, { nonEmpty: true });
    [from, ...to] = value;
    from = [from];
  } else {
    assertAllowedProperties(value, ['from', 'to'], context);
    if (!own(value, 'from')) fail(context, `${context} is missing 'from'`);
    from = Array.isArray(value.from) ? value.from : [value.from];
    to = own(value, 'to') ? (Array.isArray(value.to) ? value.to : [value.to]) : [];
    assertUniqueStringArray(from, `${context}.from`, { nonEmpty: true });
    assertUniqueStringArray(to, `${context}.to`);
  }
  [...from, ...to].forEach(id => { if (!own(entityIds, id)) fail(context, `${context} references missing entity '${id}'`); });
  return { from, to, all: [...new Set([...from, ...to])] };
}

function normalizeEvent(value, id, entities, typeState) {
  const context = `events['${id}']`;
  assertAllowedProperties(value, EVENT_KEYS, context);
  if (!own(value, 'entityIds')) fail(context, `${context} is missing 'entityIds'`);
  if (!own(value, 'time')) fail(context, `${context} is missing 'time'`);
  const endpoints = normalizeEndpoints(value.entityIds, `${context}.entityIds`, entities);
  const isRange = isPlainObject(value.time);
  if (isRange) validateTimeRange(value.time, `${context}.time`);
  else assertValidTime(value.time, `${context}.time`);
  if (own(value, 'timeNanoseconds')) assertFiniteNumber(value.timeNanoseconds, `${context}.timeNanoseconds`);
  if (isRange && own(value, 'timeNanoseconds')) fail(context, `${context}.timeNanoseconds cannot accompany a time range`);
  if (own(value, 'type')) assertString(value.type, `${context}.type`);
  if (own(value, 'color')) validateColor(value.color, `${context}.color`, true);
  if (own(value, 'lineWidth') && typeof value.lineWidth !== 'string') assertFiniteNumber(value.lineWidth, `${context}.lineWidth`, { min: 0 });
  if (own(value, 'showArrows')) assertBoolean(value.showArrows, `${context}.showArrows`);
  if (own(value, 'fontIcon')) validateFontIcon(value.fontIcon, `${context}.fontIcon`);
  const typeName = value.type || 'default';
  const type = typeState.resolved[typeName] || { ...typeState.resolved.default, id: typeName, implicit: true };
  const range = isRange
    ? normalizeTimeRange(value.time, context)
    : (() => { const point = normalizeTime(value.time, value.timeNanoseconds || 0); return { start: point, end: point }; })();
  return { id, input: value, typeName, style: { ...type, ...clone(value) }, endpoints, range };
}

function normalizeChart(value, id) {
  const context = `timeSeriesCharts['${id}']`;
  assertAllowedProperties(value, CHART_KEYS, context);
  if (!Array.isArray(value.data)) fail(context, `${context}.data must be an array`);
  if (own(value, 'color')) validateColor(value.color, `${context}.color`);
  if (own(value, 'labelColor')) validateColor(value.labelColor, `${context}.labelColor`);
  if (own(value, 'label')) assertString(value.label, `${context}.label`);
  if (own(value, 'fillAreaAlpha')) assertFiniteNumber(value.fillAreaAlpha, `${context}.fillAreaAlpha`, { min: 0, max: 1 });
  if (own(value, 'lineStyle')) assertOneOf(value.lineStyle, ALLOWED_VALUES.lineStyle, `${context}.lineStyle`);
  if (own(value, 'type')) assertOneOf(value.type, ALLOWED_VALUES.timeSeriesChartType, `${context}.type`);
  const data = value.data.map((point, index) => {
    const pointContext = `${context}.data[${index}]`;
    assertAllowedProperties(point, POINT_KEYS, pointContext);
    if (!own(point, 'time') || !own(point, 'value')) fail(pointContext, `${pointContext} requires time and value`);
    assertValidTime(point.time, `${pointContext}.time`);
    assertFiniteNumber(point.value, `${pointContext}.value`);
    if (own(point, 'timeNanoseconds')) assertFiniteNumber(point.timeNanoseconds, `${pointContext}.timeNanoseconds`);
    return { input: point, ...normalizeTime(point.time, point.timeNanoseconds || 0), value: point.value, originalIndex: index };
  }).sort((a, b) => a.epochNanoseconds < b.epochNanoseconds ? -1 : a.epochNanoseconds > b.epochNanoseconds ? 1 : a.originalIndex - b.originalIndex)
    .map((point, index) => ({ ...point, id: `${id}-${index}`, index }));
  return { id, input: value, style: { ...DEFAULT_CHART, label: id, labelColor: value.color || DEFAULT_CHART.color, ...clone(value), data: undefined }, data };
}

function normalizeStack(value, id, charts, assignedCharts) {
  const context = `timeSeriesChartStacks['${id}']`;
  assertAllowedProperties(value, STACK_KEYS, context);
  if (!own(value, 'chartIds')) fail(context, `${context} is missing 'chartIds'`);
  assertUniqueStringArray(value.chartIds, `${context}.chartIds`, { nonEmpty: true });
  value.chartIds.forEach(chartId => {
    if (!charts[chartId]) fail(context, `${context} references missing chart '${chartId}'`);
    if (assignedCharts.has(chartId)) fail(context, `chart '${chartId}' belongs to more than one stack`);
    assignedCharts.add(chartId);
  });
  if (own(value, 'label')) assertString(value.label, `${context}.label`);
  if (own(value, 'labelColor')) validateColor(value.labelColor, `${context}.labelColor`);
  return { id, input: value, chartIds: [...value.chartIds], label: value.label || id, labelColor: value.labelColor || '#e5e8eb' };
}

function normalizeMarker(value, index) {
  const context = `markers[${index}]`;
  assertAllowedProperties(value, MARKER_KEYS, context);
  if (!own(value, 'label') || !own(value, 'time')) fail(context, `${context} requires label and time`);
  assertString(value.label, `${context}.label`);
  const isRange = isPlainObject(value.time);
  if (isRange) validateTimeRange(value.time, `${context}.time`);
  else assertValidTime(value.time, `${context}.time`);
  if (own(value, 'timeNanoseconds')) assertFiniteNumber(value.timeNanoseconds, `${context}.timeNanoseconds`);
  if (isRange && own(value, 'timeNanoseconds')) fail(context, `${context}.timeNanoseconds cannot accompany a time range`);
  ['color', 'labelColor'].forEach(key => { if (own(value, key)) validateColor(value[key], `${context}.${key}`); });
  ['showAtBottom', 'showAtTop', 'showLine'].forEach(key => { if (own(value, key)) assertBoolean(value[key], `${context}.${key}`); });
  if (own(value, 'fontIcon')) validateFontIcon(value.fontIcon, `${context}.fontIcon`);
  const range = isRange ? normalizeTimeRange(value.time) : (() => { const point = normalizeTime(value.time, value.timeNanoseconds || 0); return { start: point, end: point }; })();
  return { input: clone(value), style: { ...DEFAULT_MARKER, ...clone(value) }, range };
}

function buildCandidate(data, options, previous) {
  assertAllowedProperties(data, DATA_KEYS, 'Timeline data');
  if (!own(data, 'entities') || !own(data, 'events')) fail('Timeline data', 'Timeline data requires entities and events');
  validateDictionary(data.entities, 'entities');
  validateDictionary(data.events, 'events');
  const entityTypes = previous && data.entityTypes === previous.references.entityTypes
    ? previous.entityTypes
    : resolveTypes(data.entityTypes, DEFAULT_ENTITY_TYPE, 'entity');
  const eventTypes = previous && data.eventTypes === previous.references.eventTypes
    ? previous.eventTypes
    : resolveTypes(data.eventTypes, DEFAULT_EVENT_TYPE, 'event');
  const entities = previous && data.entities === previous.references.entities && data.entityTypes === previous.references.entityTypes
    ? previous.entities
    : Object.fromEntries(Object.entries(data.entities).map(([id, value]) => {
      validateEntity(value, `entities['${id}']`);
      if (own(data.events, id)) fail('Timeline data', `id '${id}' is shared between an Entity and an Event`);
      const typeName = value.type || 'default';
      const type = entityTypes.resolved[typeName] || { ...entityTypes.resolved.default, id: typeName, implicit: true };
      for (const groupBy of type.groupBy || []) {
        const groupValue = value.data?.[groupBy];
        if (groupValue !== undefined && typeof groupValue !== 'string') {
          warn(`entity with id '${id}' has a non-string data.${groupBy} grouping value`, options.showWarnings);
        }
      }
      return [id, { id, input: value, typeName, style: { ...type, label: id, ...clone(value) } }];
    }));
  let events = previous && data.events === previous.references.events
    && data.entities === previous.references.entities
    && data.eventTypes === previous.references.eventTypes
    ? previous.events
    : Object.fromEntries(Object.entries(data.events).map(([id, value]) => [id, normalizeEvent(value, id, data.entities, eventTypes)]));
  let charts = previous && data.timeSeriesCharts === previous.references.timeSeriesCharts
    ? previous.charts
    : (() => {
      validateDictionary(data.timeSeriesCharts || {}, 'timeSeriesCharts');
      return Object.fromEntries(Object.entries(data.timeSeriesCharts || {}).map(([id, value]) => [id, normalizeChart(value, id)]));
    })();
  const stacks = previous && data.timeSeriesChartStacks === previous.references.timeSeriesChartStacks
    && data.timeSeriesCharts === previous.references.timeSeriesCharts
    ? previous.stacks
    : (() => {
      validateDictionary(data.timeSeriesChartStacks || {}, 'timeSeriesChartStacks');
      const assigned = new Set();
      return Object.fromEntries(Object.entries(data.timeSeriesChartStacks || {}).map(([id, value]) => [id, normalizeStack(value, id, charts, assigned)]));
    })();
  const ordering = data.ordering || 'shorteneventlines';
  assertOneOf(ordering, ALLOWED_VALUES.ordering, 'Timeline data.ordering');
  const times = [];
  Object.values(events).forEach(event => times.push(event.range.start.epochNanoseconds, event.range.end.epochNanoseconds));
  Object.values(charts).forEach(chart => chart.data.forEach(point => times.push(point.epochNanoseconds)));
  const resolution = chooseResolution(times, options.showWarnings);
  const quantize = point => {
    const epochNanoseconds = decodeTime(encodeTime(point.epochNanoseconds, resolution), resolution);
    return normalizeTime(...fromEpochInput(epochNanoseconds));
  };
  const resolutionChanged = !previous
    || previous.resolution.resolution !== resolution.resolution
    || previous.resolution.origin !== resolution.origin;
  if (resolution.unitNanoseconds > 1 || resolutionChanged) {
    events = Object.fromEntries(Object.entries(events).map(([id, event]) => [id, {
      ...event,
      range: { start: quantize(event.range.start), end: quantize(event.range.end) },
    }]));
    charts = Object.fromEntries(Object.entries(charts).map(([id, chart]) => [id, {
      ...chart,
      data: chart.data.map(point => ({ ...point, ...quantize(point) })),
    }]));
  }
  let bounds = null;
  const quantizedTimes = [];
  Object.values(events).forEach(event => quantizedTimes.push(event.range.start.epochNanoseconds, event.range.end.epochNanoseconds));
  Object.values(charts).forEach(chart => chart.data.forEach(point => quantizedTimes.push(point.epochNanoseconds)));
  if (quantizedTimes.length) {
    const minimum = quantizedTimes.reduce((a, b) => a < b ? a : b);
    const maximum = quantizedTimes.reduce((a, b) => a > b ? a : b);
    bounds = { start: normalizeTime(...fromEpochInput(minimum)), end: normalizeTime(...fromEpochInput(maximum)) };
  }
  return {
    references: Object.fromEntries(DATA_KEYS.map(key => [key, data[key]])),
    input: data, entityTypes, eventTypes, entities, events, charts, stacks, ordering,
    resolution, bounds,
  };
}

function fromEpochInput(value) {
  const milliseconds = value / 1000000n;
  const nanoseconds = Number(value - milliseconds * 1000000n);
  return [Number(milliseconds), nanoseconds];
}

function defaultRange(now) {
  return normalizeTimeRange({ start: Date.UTC(2011, 4, 6), end: now });
}

const ZOOM_UNITS_NS = {
  nanosecond: 1n, microsecond: 1000n, millisecond: 1000000n, second: 1000000000n,
  minute: 60000000000n, hour: 3600000000000n, day: 86400000000000n,
  week: 604800000000000n, month: 2629800000000000n, year: 31557600000000000n,
};

function idList(value, context) {
  const values = Array.isArray(value) ? value : [value];
  assertUniqueStringArray(values, context);
  return values;
}

export class TimelineModel {
  constructor(options = {}, { now = () => Date.now() } = {}) {
    validateOptions(options);
    this._options = merge(cloneDefaults(), options);
    this._options.entities.standardRowHeight = Math.max(14, this._options.entities.standardRowHeight);
    this._model = buildCandidate({ entities: {}, events: {} }, this._options, null);
    this._now = now;
    this._range = defaultRange(now());
    this._markers = [];
    this._focus = [];
    this._focusRoots = [];
    this._highlight = [];
    this._pinned = [];
    this._reveal = [];
    this._lens = null;
  }

  options(patch) {
    if (patch === undefined) return clone(this._options);
    validateOptions(patch);
    const candidateOptions = merge(this._options, patch);
    candidateOptions.entities.standardRowHeight = Math.max(14, candidateOptions.entities.standardRowHeight);
    const candidateModel = buildCandidate(this._model.input, candidateOptions, this._model);
    const wrappingChanged = candidateOptions.scales.wrapping !== this._options.scales.wrapping;
    this._options = candidateOptions;
    this._model = candidateModel;
    if (wrappingChanged) this.fit();
    return clone(this._options);
  }

  set(data) {
    const candidate = buildCandidate(data, this._options, this._model);
    this._model = candidate;
    this._focusRoots = this._focusRoots.filter(id => candidate.entities[id] || candidate.events[id]);
    this._focus = this._focus.filter(id => candidate.entities[id] || candidate.events[id]);
    this._highlight = this._highlight.filter(id => candidate.entities[id] || /^_(?:group|run)\|/.test(id));
    this._pinned = this._pinned.filter(id => candidate.entities[id]);
    this._reveal = this._reveal.filter(id => candidate.events[id]);
    if (this._lens && !candidate.entities[this._lens]) this._lens = null;
  }

  _dataBounds() {
    const ranges = [this._model.bounds, ...this._markers.map(marker => marker.range)].filter(Boolean);
    if (!ranges.length) return null;
    const start = ranges.reduce((minimum, range) => range.start.epochNanoseconds < minimum ? range.start.epochNanoseconds : minimum, ranges[0].start.epochNanoseconds);
    const end = ranges.reduce((maximum, range) => range.end.epochNanoseconds > maximum ? range.end.epochNanoseconds : maximum, ranges[0].end.epochNanoseconds);
    return { start: normalizeTime(...fromEpochInput(start)), end: normalizeTime(...fromEpochInput(end)) };
  }

  fit() {
    const wrapping = this._options.scales.wrapping;
    if (wrapping !== 'off') {
      const base = WRAP_BASE_RANGES[wrapping];
      this._range = normalizeTimeRange(base);
      return this.range();
    }
    const bounds = this._dataBounds();
    let start;
    let end;
    if (!bounds) {
      const center = toEpochNanoseconds(this._now());
      start = center - 43200000000000n;
      end = center + 43200000000000n;
    } else {
      start = bounds.start.epochNanoseconds;
      end = bounds.end.epochNanoseconds;
      if (start === end) {
        start -= 43200000000000n;
        end += 43200000000000n;
      }
    }
    const padding = (end - start) / 20n;
    start -= padding;
    end += padding;

    if (bounds) ({ start, end } = this._includeNearestItem(start, end));
    this._range = this._constrainRange({
      start: normalizeTime(...fromEpochInput(start)),
      end: normalizeTime(...fromEpochInput(end)),
    });
    return this.range();
  }

  /** Chronograph keeps time items inside the central 90% of a view; an empty view grows to the closer item. */
  _includeNearestItem(start, end) {
    const width = end - start;
    let innerStart = start + width / 20n;
    let innerEnd = start + width * 19n / 20n;
    const times = [
      ...Object.values(this._model.events).flatMap(event => [event.range.start.epochNanoseconds, event.range.end.epochNanoseconds]),
      ...Object.values(this._model.charts).flatMap(chart => chart.data.map(point => point.epochNanoseconds)),
      ...this._markers.flatMap(marker => [marker.range.start.epochNanoseconds, marker.range.end.epochNanoseconds]),
    ].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (times.length && !times.some(time => time >= innerStart && time <= innerEnd)) {
      const before = [...times].reverse().find(time => time <= innerStart);
      const after = times.find(time => time >= innerEnd);
      if (before !== undefined || after !== undefined) {
        if (after === undefined || (before !== undefined && after - innerEnd > innerStart - before)) innerStart = before;
        else innerEnd = after;
        const fittedWidth = (innerEnd - innerStart) * 10n / 9n;
        start = innerStart - fittedWidth / 20n;
        end = start + fittedWidth;
      }
    }
    return { start, end };
  }

  _constrainRange(candidate) {
    const wrapping = this._options.scales.wrapping;
    let start = candidate.start.epochNanoseconds;
    let end = candidate.end.epochNanoseconds;
    const resolution = this._model.resolution;
    const unit = BigInt(resolution.unitNanoseconds);
    start = floorDiv(start, unit) * unit;
    end = floorDiv(end, unit) * unit;
    if (end <= start) end = start + BigInt(resolution.unitNanoseconds);

    if (wrapping !== 'off') {
      const base = normalizeTimeRange(WRAP_BASE_RANGES[wrapping]);
      const minimum = base.start.epochNanoseconds;
      const maximum = base.end.epochNanoseconds;
      const width = end - start;
      if (width >= maximum - minimum) return base;
      if (start < minimum) { end += minimum - start; start = minimum; }
      if (end > maximum) { start -= end - maximum; end = maximum; }
    } else {
      const limit = this._options.scales.zoomOutLimit;
      let maximumWidth = null;
      const dataBounds = this._dataBounds();
      if (limit !== 'auto') maximumWidth = ZOOM_UNITS_NS[limit.unit] * BigInt(Math.round((limit.value ?? 1) * 1000000)) / 1000000n;
      else if (dataBounds) {
        const dataWidth = dataBounds.end.epochNanoseconds - dataBounds.start.epochNanoseconds;
        if (dataWidth > 0n) maximumWidth = dataWidth * 20n / 9n;
      }
      if (maximumWidth && end - start > maximumWidth) {
        // Chronograph keeps the requested start when narrowing an over-wide range.
        end = start + maximumWidth;
      }
      if (this._options.scales.panLimit === 'auto' && dataBounds) {
        const minimum = dataBounds.start.epochNanoseconds;
        const maximum = dataBounds.end.epochNanoseconds;
        if (maximum > minimum) {
          // Chronograph only keeps the view centre within the data extent.
          const centre = (start + end) / 2n; const shift = (centre < minimum ? minimum : centre > maximum ? maximum : centre) - centre;
          start += shift; end += shift;
        }
      }
    }
    return { start: normalizeTime(...fromEpochInput(start)), end: normalizeTime(...fromEpochInput(end)) };
  }

  range(start, end, startNanoseconds = 0, endNanoseconds = 0) {
    if (start === undefined) return exportTimeRange(this._range);
    assertValidTime(start, 'range start'); assertValidTime(end, 'range end');
    assertFiniteNumber(startNanoseconds, 'range startNanoseconds'); assertFiniteNumber(endNanoseconds, 'range endNanoseconds');
    let candidate = { start: normalizeTime(start, startNanoseconds), end: normalizeTime(end, endNanoseconds) };
    if (candidate.start.epochNanoseconds >= candidate.end.epochNanoseconds) fail('range', 'range start must be before range end');
    const grown = this._includeNearestItem(candidate.start.epochNanoseconds, candidate.end.epochNanoseconds);
    candidate = { start: normalizeTime(...fromEpochInput(grown.start)), end: normalizeTime(...fromEpochInput(grown.end)) };
    this._range = this._constrainRange(candidate);
    return this.range();
  }

  getEntity(id) { assertString(id, 'entity id'); return this._model.entities[id] ? clone(this._model.entities[id].input) : null; }
  getEvent(id) {
    assertString(id, 'event id');
    const event = this._model.events[id];
    if (!event) return null;
    const result = clone(event.input);
    if (isPlainObject(result.time)) result.time = exportTimeRange(event.range);
    else {
      result.time = new Date(event.range.start.time.getTime());
      result.timeNanoseconds = event.range.start.timeNanoseconds;
    }
    return result;
  }

  focus(ids) {
    if (ids === undefined) return [...this._focus];
    this._focusRoots = idList(ids, 'focus ids').filter(id => this._model.entities[id] || this._model.events[id]);
    this._focus = [...this._focusRoots];
    for (const id of [...this._focus]) {
      const event = this._model.events[id];
      if (event) event.endpoints.all.forEach(entityId => { if (!this._focus.includes(entityId)) this._focus.push(entityId); });
    }
    return [...this._focus];
  }

  highlight(ids) {
    if (ids === undefined) return [...this._highlight];
    this._highlight = idList(ids, 'highlight ids').filter(id => this._model.entities[id] || /^_(?:group|run)\|/.test(id));
    return [...this._highlight];
  }

  pin(ids, pinned = true) {
    assertBoolean(pinned, 'pinned');
    const known = idList(ids, 'entity ids').filter(id => this._model.entities[id]);
    const current = new Set(this._pinned);
    known.forEach(id => pinned ? current.add(id) : current.delete(id));
    this._pinned = Object.keys(this._model.entities).filter(id => current.has(id));
  }

  getPinnedEntityIds() { return [...this._pinned]; }

  reveal(ids) {
    if (ids === undefined) return [...this._reveal];
    this._reveal = idList(ids, 'reveal ids').filter(id => this._model.events[id]);
    return [...this._reveal];
  }

  lens(id) {
    if (id === undefined) return this._lens;
    if (id !== null) assertString(id, 'lens entity id');
    this._lens = id !== null && this._model.entities[id] ? id : null;
    return this._lens;
  }

  setOrdering(ordering) {
    assertOneOf(ordering, ALLOWED_VALUES.ordering, 'ordering');
    this._model.ordering = ordering;
  }

  markers(markers) {
    if (markers === undefined) return this._markers.map(marker => {
      const result = clone(marker.input);
      if (isPlainObject(result.time)) result.time = exportTimeRange(marker.range);
      else {
        result.time = new Date(marker.range.start.time.getTime());
        result.timeNanoseconds = marker.range.start.timeNanoseconds;
      }
      return result;
    });
    if (!Array.isArray(markers)) fail('markers', 'markers must be an array');
    const candidate = markers.map(normalizeMarker).map(marker => {
      const divisor = BigInt(this._model.resolution.unitNanoseconds);
      const quantize = point => {
        const relative = point.epochNanoseconds - this._model.resolution.origin;
        const epochNanoseconds = this._model.resolution.origin + relative / divisor * divisor;
        return normalizeTime(...fromEpochInput(epochNanoseconds));
      };
      return { ...marker, range: { start: quantize(marker.range.start), end: quantize(marker.range.end) } };
    });
    this._markers = candidate;
    return this.markers();
  }

  inRange(item, nanoseconds = 0) {
    let range;
    if (typeof item === 'string') {
      const event = this._model.events[item];
      if (!event) return false;
      range = event.range;
    } else if (isPlainObject(item)) {
      validateTimeRange(item, 'range item');
      range = normalizeTimeRange(item);
    } else {
      assertValidTime(item, 'range item');
      assertFiniteNumber(nanoseconds, 'nanoseconds');
      const point = normalizeTime(item, nanoseconds);
      range = { start: point, end: point };
    }
    return wrappedIntersects(range, this._range, this._options.scales.wrapping);
  }

  getInRangeItems({ focus = true } = {}) {
    assertBoolean(focus, 'getInRangeItems focus');
    const events = Object.create(null);
    const entities = Object.create(null);
    const focused = new Set(this._focus);
    const focusRoots = new Set(this._focusRoots);
    Object.values(this._model.events).forEach(event => {
      if (!this.inRange(event.id)) return;
      if (focus && focused.size) {
        const directlyConnected = focusRoots.has(event.id) || event.endpoints.all.some(id => focusRoots.has(id));
        const neighborConnected = this._options.focus.showEventsOnNeighbors && event.endpoints.all.some(id => focused.has(id));
        if (!directlyConnected && !neighborConnected) return;
      }
      events[event.id] = true;
      event.endpoints.all.forEach(id => { if (!focus || !focused.size || focused.has(id) || focused.has(event.id)) entities[id] = true; });
    });
    return { entities, events };
  }

  get normalized() { return this._model; }
}

export function createTimelineModel(options, environment) {
  return new TimelineModel(options, environment);
}
