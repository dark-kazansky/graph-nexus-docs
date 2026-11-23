import { averageColors, interpolateColor, multiplyColorAlpha } from './validation.js';
import {
  addInterval, normalizeTime, roundToInterval, selectAggregationInterval, splitWrappedRange,
} from './time.js';

const DENSITY_TRANSITION_TIME = 300;
const REVEAL_TRANSITION_TIME = 150;
const FOLD_TRANSITION_TIME = 150;
const MAX_REVEALED_CELL_FADE = 0.5;
const SUMMARY_JOIN_DISTANCE = 8;

function eventValue(event, key) {
  if (key === null) return 1;
  const value = event.input.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function contributes(event, entityId, direction) {
  if (direction === 'any') return event.endpoints.all.includes(entityId);
  return event.endpoints[direction].includes(entityId);
}

function entityColor(model, id) {
  return model.normalized.entities[id]?.style.color || '#3ebd93';
}

export function resolveEventColor(model, event, rowEntityId) {
  const mode = event.style.color;
  if (!['from', 'to', 'entity', 'inverse'].includes(mode)) return mode;
  const from = event.endpoints.from.map(id => entityColor(model, id));
  const to = event.endpoints.to.map(id => entityColor(model, id));
  if (mode === 'entity') return entityColor(model, rowEntityId || event.endpoints.all[0]);
  if (mode === 'from') return averageColors(from);
  if (mode === 'to') return averageColors(to.length ? to : from);
  const inTarget = event.endpoints.to.includes(rowEntityId);
  return averageColors(inTarget && from.length ? from : to.length ? to : from);
}

function percentile(values, value) {
  if (values.length < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = sorted.findLastIndex(item => item <= value);
  return Math.max(0, index) / (sorted.length - 1);
}

function heatmapColor(option, model, entries, value, values) {
  if (typeof option === 'string') return option;
  if (option === null) return averageColors(entries.map(({ event, entityId }) => resolveEventColor(model, event, entityId)));
  if (option.length === 0) return '#3ebd93';
  if (typeof option[0] === 'string') {
    const amount = percentile(values, value);
    const scaled = amount * (option.length - 1);
    const index = Math.min(option.length - 2, Math.floor(scaled));
    return option.length === 1 ? option[0] : interpolateColor(option[index], option[index + 1], scaled - index);
  }
  if (Object.prototype.hasOwnProperty.call(option[0], 'value')) {
    const sorted = [...option].sort((a, b) => a.value - b.value);
    return (sorted.find(step => value <= step.value) || sorted.at(-1)).color;
  }
  for (const priority of option) {
    if (entries.some(({ event }) => event.typeName === priority.eventType)) return priority.color;
  }
  return resolveEventColor(model, entries[0].event, entries[0].entityId);
}

function visibleEvents(model, rows) {
  const rowEntities = new Set(rows.rows.flatMap(row => row.entityIds));
  return Object.values(model.normalized.events).filter(event => model.inRange(event.id)
    && event.endpoints.all.some(id => rowEntities.has(id)));
}

function transitionValue(transition, now, duration) {
  if (!transition) return 0;
  const amount = Math.max(0, Math.min(1, (now - transition.startedAt) / duration));
  return transition.from + (transition.target - transition.from) * amount;
}

export class AggregationState {
  constructor() {
    this.density = null;
    this.reveals = new Map();
  }

  reset() {
    this.density = null;
    this.reveals.clear();
  }

  densityAlpha(target, now) {
    if (!this.density) {
      this.density = { from: target, target, startedAt: now };
      return target;
    }
    const current = transitionValue(this.density, now, DENSITY_TRANSITION_TIME);
    if (target !== this.density.target) this.density = { from: current, target, startedAt: now };
    const value = transitionValue(this.density, now, DENSITY_TRANSITION_TIME);
    if (Math.abs(value - this.density.target) < 1e-9) this.density = { from: target, target, startedAt: now };
    return value;
  }

  revealAlphas(ids, now) {
    const active = new Set(ids);
    active.forEach(id => {
      const prior = this.reveals.get(id);
      if (!prior) this.reveals.set(id, { from: 0, target: 1, startedAt: now });
      else if (prior.target !== 1) this.reveals.set(id, { from: transitionValue(prior, now, REVEAL_TRANSITION_TIME), target: 1, startedAt: now });
    });
    this.reveals.forEach((prior, id) => {
      if (!active.has(id) && prior.target !== 0) {
        this.reveals.set(id, { from: transitionValue(prior, now, REVEAL_TRANSITION_TIME), target: 0, startedAt: now });
      }
    });
    const values = new Map();
    this.reveals.forEach((transition, id) => {
      const value = transitionValue(transition, now, REVEAL_TRANSITION_TIME);
      if (value > 0) values.set(id, value);
      if (transition.target === 0 && value <= 0) this.reveals.delete(id);
      else if (Math.abs(value - transition.target) < 1e-9) this.reveals.set(id, { from: transition.target, target: transition.target, startedAt: now });
    });
    return values;
  }

  isActive(now) {
    const densityActive = this.density && Math.abs(transitionValue(this.density, now, DENSITY_TRANSITION_TIME) - this.density.target) > 1e-9;
    const revealActive = [...this.reveals.values()].some(transition => Math.abs(transitionValue(transition, now, REVEAL_TRANSITION_TIME) - transition.target) > 1e-9);
    return !!densityActive || revealActive;
  }
}

function fixedBucketRange(time, interval) {
  const size = BigInt(Math.round(interval.nanoseconds));
  let start = time.epochNanoseconds / size * size;
  if (time.epochNanoseconds < 0n && time.epochNanoseconds % size !== 0n) start -= size;
  return {
    start: normalizeTime(Number(start / 1000000n), Number(start % 1000000n)),
    end: normalizeTime(Number((start + size) / 1000000n), Number((start + size) % 1000000n)),
  };
}

function bucketRange(time, interval) {
  if (interval.unit !== 'month' && interval.unit !== 'year') return fixedBucketRange(time, interval);
  const start = normalizeTime(roundToInterval(time.time, interval));
  return { start, end: normalizeTime(addInterval(start.time, interval)) };
}

function buildHeatmap(model, rows, events, xForTime, timelineBounds, range, alpha, revealAlphas) {
  if (alpha <= 0) return [];
  const options = model.options().events;
  const pixels = Math.max(1, timelineBounds.x2 - timelineBounds.x1);
  const interval = selectAggregationInterval(range.start.epochNanoseconds, range.end.epochNanoseconds, pixels);
  const buckets = new Map();
  const eventRows = [...new Set(Object.values(rows.entityIndex))];
  events.forEach(event => {
    eventRows.forEach(row => row.entityIds.forEach(entityId => {
      if (!contributes(event, entityId, options.heatmapDirection)) return;
      splitWrappedRange(event.range, model.options().scales.wrapping).forEach(segment => {
        const visibleStart = segment.start.epochNanoseconds < range.start.epochNanoseconds ? range.start : segment.start;
        const visibleEnd = segment.end.epochNanoseconds > range.end.epochNanoseconds ? range.end : segment.end;
        if (visibleStart.epochNanoseconds > visibleEnd.epochNanoseconds) return;
        let bucket = bucketRange(visibleStart, interval);
        while (bucket.start.epochNanoseconds <= visibleEnd.epochNanoseconds) {
          const key = `${row.id}|${bucket.start.epochNanoseconds}`;
          if (!buckets.has(key)) buckets.set(key, { row, entries: [], value: 0, range: bucket });
          const item = buckets.get(key);
          item.entries.push({ event, entityId });
          item.value += eventValue(event, options.heatmapValue);
          if (bucket.end.epochNanoseconds > visibleEnd.epochNanoseconds) break;
          bucket = bucketRange(bucket.end, interval);
        }
      });
    }));
  });
  const values = [...buckets.values()].map(item => item.value);
  const maximum = Math.max(1, ...values.map(Math.abs));
  return [...buckets.values()].map(item => {
    const padding = options.heatmapPadding ? 0.5 : 0;
    const x1 = xForTime(item.range.start); const x2 = xForTime(item.range.end);
    const color = heatmapColor(options.heatmapColor, model, item.entries, item.value, values);
    const revealAlpha = Math.max(0, ...item.entries.map(({ event }) => revealAlphas.get(event.id) || 0));
    const cellAlpha = alpha * (1 - revealAlpha * model.options().events.revealHeatmapAlpha * MAX_REVEALED_CELL_FADE);
    return {
      id: `_heatmap|${item.row.id}|${item.range.start.epochNanoseconds}`,
      rowId: item.row.id,
      eventIds: [...new Set(item.entries.map(entry => entry.event.id))],
      x: Math.min(x1, x2) + padding,
      y: item.row.y1 + padding,
      width: Math.max(1, Math.abs(x2 - x1) - padding * 2),
      height: Math.max(1, item.row.height - padding * 2),
      value: item.value,
      range: item.range,
      color: multiplyColorAlpha(color, Math.min(1, Math.abs(item.value) / maximum) * cellAlpha),
      alpha: cellAlpha,
      interval,
    };
  });
}

function buildSummaries(model, rows, events, xForTime) {
  const byRow = new Map();
  events.forEach(event => {
    const eventRows = new Set(event.endpoints.all.map(entityId => rows.entityIndex[entityId]).filter(Boolean));
    eventRows.forEach(row => {
      if (!byRow.has(row.id)) byRow.set(row.id, { row, entries: [] });
      byRow.get(row.id).entries.push({ event, x: xForTime(event.range.start) });
    });
  });
  const summaries = [];
  byRow.forEach(({ row, entries }) => {
    entries.sort((left, right) => left.x - right.x || left.event.id.localeCompare(right.event.id));
    let chain = [];
    const flush = () => {
      if (chain.length < 2) { chain = []; return; }
      const chainEvents = chain.map(item => item.event);
      const relatedRows = chainEvents.flatMap(event => event.endpoints.all.map(id => rows.entityIndex[id]).filter(Boolean));
      summaries.push({
        id: `_eventSummary|${row.id}|${chain[0].event.id}|${chain.at(-1).event.id}`,
        rowId: row.id,
        eventIds: [...new Set(chainEvents.map(event => event.id))],
        range: {
          start: chainEvents.reduce((a, event) => event.range.start.epochNanoseconds < a.epochNanoseconds ? event.range.start : a, chainEvents[0].range.start),
          end: chainEvents.reduce((a, event) => event.range.end.epochNanoseconds > a.epochNanoseconds ? event.range.end : a, chainEvents[0].range.end),
        },
        x1: chain[0].x,
        x2: chain.at(-1).x,
        y: (row.y1 + row.y2) / 2,
        y1: Math.min(...relatedRows.map(item => (item.y1 + item.y2) / 2)),
        y2: Math.max(...relatedRows.map(item => (item.y1 + item.y2) / 2)),
        color: averageColors(chainEvents.map(event => resolveEventColor(model, event, row.entityIds[0]))),
      });
      chain = [];
    };
    entries.forEach(entry => {
      if (chain.length && entry.x - chain.at(-1).x > SUMMARY_JOIN_DISTANCE) flush();
      chain.push(entry);
    });
    flush();
  });
  return summaries;
}

function buildFolds(model, events, revealAlphas, foldState, xForTime, now) {
  if (!model.options().events.showEventFolds || revealAlphas.size) return [];
  const distinctX = [...new Set(events.map(event => Math.round(xForTime(event.range.start))))].sort((a, b) => a - b);
  const minimumGap = distinctX.length < 2 ? Infinity : Math.min(...distinctX.slice(1).map((value, index) => value - distinctX[index]));
  if (minimumGap < 8) return [];
  const groups = new Map();
  events.forEach(event => {
    if (event.range.start.epochNanoseconds !== event.range.end.epochNanoseconds) return;
    const key = event.range.start.epochNanoseconds.toString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([time, items]) => {
    const progress = foldState.progress(time, now);
    return {
      id: `_fold|${time}`, time: BigInt(time), eventIds: items.map(item => item.id),
      open: foldState.openTime === time, progress,
    };
  });
}

export class FoldState {
  constructor() {
    this.openTime = null;
    this.closingTime = null;
    this.changedAt = 0;
  }

  toggle(time, now = Date.now()) {
    const value = time === null ? null : String(time);
    if (this.openTime === value) {
      this.closingTime = this.openTime;
      this.openTime = null;
    } else {
      this.openTime = value;
      this.closingTime = null;
    }
    this.changedAt = now;
    return this.openTime;
  }

  progress(time, now) {
    const value = String(time);
    if (this.openTime === value) return Math.min(1, Math.max(0, (now - this.changedAt) / FOLD_TRANSITION_TIME));
    if (this.closingTime === value) {
      const progress = 1 - Math.min(1, Math.max(0, (now - this.changedAt) / FOLD_TRANSITION_TIME));
      if (progress <= 0) this.closingTime = null;
      return progress;
    }
    return 0;
  }

  isActive(now) {
    return (this.openTime !== null || this.closingTime !== null) && now - this.changedAt < FOLD_TRANSITION_TIME;
  }

  clearForReveal(revealIds) {
    if (revealIds.length) {
      this.openTime = null;
      this.closingTime = null;
      this.changedAt = 0;
    }
  }
}

/** Select detail, summary, fold, and heatmap presentations from one event snapshot. */
export function aggregateEvents(model, rows, {
  xForTime, timelineBounds, range, foldState = new FoldState(), aggregationState = new AggregationState(), now = Date.now(),
} = {}) {
  const events = visibleEvents(model, rows);
  const reveal = new Set(model.reveal());
  const revealAlphas = aggregationState.revealAlphas(reveal, now);
  foldState.clearForReveal([...reveal]);
  const threshold = model.options().events.heatmapThreshold;
  const heatmapTarget = threshold === 0 || events.length >= threshold ? 1 : 0;
  const heatmapAlpha = aggregationState.densityAlpha(heatmapTarget, now);
  const detailAlpha = 1 - heatmapAlpha;
  const folds = detailAlpha > 0 ? buildFolds(model, events, reveal, foldState, xForTime, now) : [];
  const foldEvents = new Set(folds.flatMap(fold => fold.eventIds));
  const summaries = detailAlpha > 0 ? buildSummaries(model, rows, events.filter(event => !revealAlphas.has(event.id) && !foldEvents.has(event.id)), xForTime) : [];
  const summarized = new Set(summaries.flatMap(summary => summary.eventIds));
  const closedFoldEvents = new Set(folds.filter(fold => fold.progress <= 0).flatMap(fold => fold.eventIds));
  const movingFoldEvents = new Set(folds.filter(fold => fold.progress > 0).flatMap(fold => fold.eventIds));
  const individual = events.filter(event => revealAlphas.has(event.id) || movingFoldEvents.has(event.id)
    || (!summarized.has(event.id) && !closedFoldEvents.has(event.id)));
  const publicRange = model.range();
  const visibleRange = range || {
    start: normalizeTime(publicRange.start, publicRange.startNanoseconds),
    end: normalizeTime(publicRange.end, publicRange.endNanoseconds),
  };
  const heatmap = buildHeatmap(model, rows, events, xForTime, timelineBounds, visibleRange, heatmapAlpha, revealAlphas);
  return {
    events, individual, summaries, folds, heatmap, detailAlpha, heatmapAlpha,
    revealAlphas,
    revealAlpha: Math.max(0, ...revealAlphas.values()),
    revealedEventIds: [...reveal],
    active: aggregationState.isActive(now) || foldState.isActive(now),
  };
}
