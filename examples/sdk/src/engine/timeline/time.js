import { DATE_TIME_FORMATS, DATE_TIME_NAMES, INTERVAL_CANDIDATES } from './defaults.js';
import { assertFiniteNumber, assertOneOf, assertValidTime, fail, warn } from './validation.js';

export const RESOLUTIONS = Object.freeze({
  millisecond: 1e6,
  microsecond: 1e3,
  nanosecond: 1,
});

const NS_PER_MS = 1000000n;
const MS_PER_DAY = 86400000;
const SAFE_INTEGER_SPAN = BigInt(Number.MAX_SAFE_INTEGER) - BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_SPAN_NANOSECONDS = Object.freeze({
  nanosecond: SAFE_INTEGER_SPAN / 1000000n * 1000000n,
  microsecond: SAFE_INTEGER_SPAN / 1000n * 1000000n,
});

function utcFromComponents(year, month, day, hours, minutes, seconds, milliseconds) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hours, minutes, seconds, milliseconds);
  return date.getTime();
}

export function toWallMilliseconds(value) {
  assertValidTime(value, 'time');
  if (typeof value === 'number') return value;
  return utcFromComponents(
    value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(),
    value.getMinutes(), value.getSeconds(), value.getMilliseconds(),
  );
}

export function fromWallMilliseconds(value) {
  assertFiniteNumber(value, 'wall-clock milliseconds');
  const utc = new Date(value);
  const local = new Date(0);
  local.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  local.setHours(utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), utc.getUTCMilliseconds());
  return local;
}

export function toEpochNanoseconds(time, nanoseconds = 0) {
  assertValidTime(time, 'time');
  assertFiniteNumber(nanoseconds, 'nanoseconds');
  const milliseconds = toWallMilliseconds(time);
  const wholeMilliseconds = Math.floor(milliseconds);
  const fractionalNanoseconds = Math.round((milliseconds - wholeMilliseconds) * 1e6);
  return BigInt(wholeMilliseconds) * NS_PER_MS + BigInt(fractionalNanoseconds) + BigInt(Math.round(nanoseconds));
}

function floorDiv(value, divisor) {
  let result = value / divisor;
  if (value < 0n && value % divisor !== 0n) result -= 1n;
  return result;
}

export function fromEpochNanoseconds(value) {
  const epochNanoseconds = typeof value === 'bigint' ? value : BigInt(value);
  const milliseconds = floorDiv(epochNanoseconds, NS_PER_MS);
  const nanoseconds = Number(epochNanoseconds - milliseconds * NS_PER_MS);
  return { time: fromWallMilliseconds(Number(milliseconds)), timeNanoseconds: nanoseconds };
}

export function normalizeTime(time, nanoseconds = 0) {
  const epochNanoseconds = toEpochNanoseconds(time, nanoseconds);
  const output = fromEpochNanoseconds(epochNanoseconds);
  return { epochNanoseconds, ...output };
}

export function normalizeTimeRange(value, context = 'time range') {
  if (value?.start?.epochNanoseconds !== undefined && value?.end?.epochNanoseconds !== undefined) {
    const start = normalizeTime(value.start.time, value.start.timeNanoseconds || 0);
    const end = normalizeTime(value.end.time, value.end.timeNanoseconds || 0);
    return start.epochNanoseconds <= end.epochNanoseconds ? { start, end } : { start: end, end: start };
  }
  const isRange = value && typeof value === 'object' && !(value instanceof Date) && 'start' in value;
  const start = isRange ? normalizeTime(value.start, value.startNanoseconds || 0) : normalizeTime(value, 0);
  const end = isRange ? normalizeTime(value.end, value.endNanoseconds || 0) : start;
  return start.epochNanoseconds <= end.epochNanoseconds
    ? { start, end }
    : { start: end, end: start };
}

export function exportTimeRange(range) {
  return {
    start: new Date(range.start.time.getTime()),
    end: new Date(range.end.time.getTime()),
    startNanoseconds: range.start.timeNanoseconds,
    endNanoseconds: range.end.timeNanoseconds,
  };
}

export function chooseResolution(times, showWarnings = false) {
  if (!Array.isArray(times)) fail('times', 'times must be an array');
  if (times.length === 0) return { resolution: 'millisecond', unitNanoseconds: RESOLUTIONS.millisecond, origin: 0n };
  const values = times.map(value => typeof value === 'bigint'
    ? value
    : toEpochNanoseconds(value.time ?? value, value.timeNanoseconds ?? value.nanoseconds ?? 0));
  const minimum = values.reduce((a, b) => a < b ? a : b);
  const maximum = values.reduce((a, b) => a > b ? a : b);
  const requiresNanoseconds = values.some(value => value % 1000n !== 0n);
  const requiresMicroseconds = requiresNanoseconds || values.some(value => value % NS_PER_MS !== 0n);
  const requested = requiresNanoseconds ? 'nanosecond' : requiresMicroseconds ? 'microsecond' : 'millisecond';
  const candidates = requested === 'nanosecond'
    ? ['nanosecond', 'microsecond', 'millisecond']
    : requested === 'microsecond' ? ['microsecond', 'millisecond'] : ['millisecond'];
  const midpoint = (minimum + maximum) / 2n;
  const resolution = candidates.find(name => {
    const divisor = BigInt(RESOLUTIONS[name]);
    const origin = floorDiv(midpoint, divisor) * divisor;
    const encodedMinimum = (minimum - origin) / divisor;
    const encodedMaximum = (maximum - origin) / divisor;
    const safeSpan = SAFE_SPAN_NANOSECONDS[name];
    return (!safeSpan || maximum - minimum < safeSpan)
      && encodedMinimum >= BigInt(Number.MIN_SAFE_INTEGER)
      && encodedMaximum <= BigInt(Number.MAX_SAFE_INTEGER);
  }) || 'millisecond';
  if (resolution !== requested) {
    warn(`Timeline ${requested} precision is unsafe for this time span; using ${resolution} precision.`, showWarnings);
  }
  const divisor = BigInt(RESOLUTIONS[resolution]);
  const origin = floorDiv(midpoint, divisor) * divisor;
  return { resolution, unitNanoseconds: RESOLUTIONS[resolution], origin };
}

export function encodeTime(epochNanoseconds, resolution) {
  const value = typeof epochNanoseconds === 'bigint' ? epochNanoseconds : BigInt(epochNanoseconds);
  const divisor = BigInt(resolution.unitNanoseconds);
  const encoded = Number((value - resolution.origin) / divisor);
  if (!Number.isSafeInteger(encoded)) fail('time', 'time exceeds safe integer range');
  return encoded;
}

export function decodeTime(value, resolution) {
  if (!Number.isSafeInteger(value)) fail('time', 'encoded time must be a safe integer');
  return resolution.origin + BigInt(value) * BigInt(resolution.unitNanoseconds);
}

export function selectInterval(startNanoseconds, endNanoseconds, pixels, minimumPixels = 80) {
  const start = typeof startNanoseconds === 'bigint' ? startNanoseconds : BigInt(startNanoseconds);
  const end = typeof endNanoseconds === 'bigint' ? endNanoseconds : BigInt(endNanoseconds);
  assertFiniteNumber(pixels, 'pixels', { positive: true });
  assertFiniteNumber(minimumPixels, 'minimumPixels', { positive: true });
  const desired = Number(end - start) * minimumPixels / pixels;
  return INTERVAL_CANDIDATES.find(interval => interval.nanoseconds >= desired)
    || INTERVAL_CANDIDATES[INTERVAL_CANDIDATES.length - 1];
}

const AGGREGATION_INTERVALS = Object.freeze([
  ...['nanosecond', 'microsecond', 'millisecond'].flatMap((unit, unitIndex) => [1, 2, 5, 10, 20, 50, 100, 200, 500]
    .map(value => ({ unit, value, nanoseconds: value * (1000 ** unitIndex) }))),
  ...[1, 2, 5, 10, 15, 30].map(value => ({ unit: 'second', value, nanoseconds: value * 1e9 })),
  ...[1, 2, 5, 10, 15, 30].map(value => ({ unit: 'minute', value, nanoseconds: value * 60e9 })),
  ...[1, 2, 6, 12].map(value => ({ unit: 'hour', value, nanoseconds: value * 3600e9 })),
  ...[1, 2].map(value => ({ unit: 'day', value, nanoseconds: value * 86400e9 })),
  { unit: 'week', value: 1, nanoseconds: 604800e9 },
  ...[1, 3, 6].map(value => ({ unit: 'month', value, nanoseconds: value * 2629800e9 })),
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map(value => ({ unit: 'year', value, nanoseconds: value * 31557600e9 })),
]);

export function selectAggregationInterval(startNanoseconds, endNanoseconds, pixels) {
  const start = typeof startNanoseconds === 'bigint' ? startNanoseconds : BigInt(startNanoseconds);
  const end = typeof endNanoseconds === 'bigint' ? endNanoseconds : BigInt(endNanoseconds);
  assertFiniteNumber(pixels, 'pixels', { positive: true });
  const desired = Number(end - start) * 8 / pixels;
  return AGGREGATION_INTERVALS.find(interval => interval.nanoseconds >= desired)
    || AGGREGATION_INTERVALS[AGGREGATION_INTERVALS.length - 1];
}

const FIXED_INTERVAL_MS = {
  nanosecond: 1e-6, microsecond: 1e-3, millisecond: 1, second: 1000,
  minute: 60000, hour: 3600000, day: MS_PER_DAY, week: 7 * MS_PER_DAY,
};

export function addInterval(time, interval, count = 1) {
  assertValidTime(time, 'time');
  assertFiniteNumber(count, 'interval count');
  const milliseconds = toWallMilliseconds(time);
  const date = new Date(milliseconds);
  const amount = (interval.value ?? interval.count ?? 1) * count;
  if (interval.unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + amount);
  else if (interval.unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
  else if (interval.unit === 'week') date.setUTCDate(date.getUTCDate() + 7 * amount);
  else if (interval.unit === 'day') date.setUTCDate(date.getUTCDate() + amount);
  else return fromWallMilliseconds(milliseconds + FIXED_INTERVAL_MS[interval.unit] * amount);
  return fromWallMilliseconds(date.getTime());
}

function roundCalendarDown(milliseconds, interval) {
  const date = new Date(milliseconds);
  const multiple = interval.value ?? interval.count ?? 1;
  if (interval.unit === 'year') return utcFromComponents(Math.floor(date.getUTCFullYear() / multiple) * multiple, 0, 1, 0, 0, 0, 0);
  if (interval.unit === 'month') return utcFromComponents(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / multiple) * multiple, 1, 0, 0, 0, 0);
  if (interval.unit === 'day') return utcFromComponents(date.getUTCFullYear(), date.getUTCMonth(), Math.floor(date.getUTCDate() / multiple) * multiple, 0, 0, 0, 0);
  if (interval.unit === 'week') {
    const mondayAnchor = utcFromComponents(2000, 0, 3, 0, 0, 0, 0);
    const day = utcFromComponents(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
    return mondayAnchor + Math.floor((day - mondayAnchor) / (multiple * 7 * MS_PER_DAY)) * multiple * 7 * MS_PER_DAY;
  }
  return null;
}

export function roundToInterval(time, interval, direction = 'floor') {
  assertOneOf(direction, ['floor', 'ceil'], 'rounding direction');
  assertValidTime(time, 'time');
  const milliseconds = toWallMilliseconds(time);
  if (['year', 'month', 'week', 'day'].includes(interval.unit)) {
    const floor = roundCalendarDown(milliseconds, interval);
    if (direction === 'floor' || floor === milliseconds) return fromWallMilliseconds(floor);
    return addInterval(fromWallMilliseconds(floor), interval);
  }
  const size = FIXED_INTERVAL_MS[interval.unit] * (interval.value ?? interval.count ?? 1);
  const operation = direction === 'ceil' ? Math.ceil : Math.floor;
  return fromWallMilliseconds(operation(milliseconds / size) * size);
}

function pad(value, width = 2) { return String(value).padStart(width, '0'); }

export function formatTime(time, nanoseconds = 0, format = DATE_TIME_FORMATS.dateTimeSeconds, options = {}) {
  const normalized = normalizeTime(time, nanoseconds);
  const date = new Date(toWallMilliseconds(normalized.time));
  const names = { ...DATE_TIME_NAMES, ...(options.dateTimeNames || {}) };
  const hour24 = date.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const fraction = `${pad(date.getUTCMilliseconds(), 3)}${pad(normalized.timeNanoseconds, 6)}`;
  const values = {
    yyyy: pad(date.getUTCFullYear(), 4), yy: pad(date.getUTCFullYear() % 100, 2),
    MMMMM: names.fullMonthNames[date.getUTCMonth()],
    MMMM: names.fullMonthNamesInDate[date.getUTCMonth()], MMM: names.shortMonthNames[date.getUTCMonth()],
    MM: pad(date.getUTCMonth() + 1), M: date.getUTCMonth() + 1,
    EEEE: names.fullDayOfWeekNames[date.getUTCDay()], EEE: names.shortDayOfWeekNames[date.getUTCDay()],
    dddd: names.fullDayOfWeekNames[date.getUTCDay()], ddd: names.shortDayOfWeekNames[date.getUTCDay()],
    dd: pad(date.getUTCDate()), d: date.getUTCDate(),
    HH: pad(hour24), H: hour24, hh: pad(hour12), h: hour12,
    mm: pad(date.getUTCMinutes()), m: date.getUTCMinutes(),
    ss: pad(date.getUTCSeconds()), s: date.getUTCSeconds(),
    tt: names.ampmNames[hour24 < 12 ? 0 : 1],
    t: names.ampmNames[hour24 < 12 ? 0 : 1].charAt(0),
  };
  let effective = options.twelveHourClock
    ? format.replace(/HH/g, 'hh').replace(/\bH\b/g, 'h')
    : format;
  if (options.twelveHourClock && /(?:hh|\bh\b)/.test(effective) && !/(^|[^A-Za-z])tt?([^A-Za-z]|$)/.test(effective)) effective += ' tt';
  return effective.replace(/f{1,9}|yyyy|MMMMM|MMMM|dddd|MMM|ddd|yy|MM|dd|HH|hh|mm|ss|tt|M|d|H|h|m|s|t/g, token => {
    if (token[0] === 'f') return fraction.slice(0, token.length);
    return String(values[token]);
  });
}

export const WRAP_BASE_RANGES = Object.freeze({
  day: { start: utcFromComponents(2000, 0, 1, 0, 0, 0, 0), end: utcFromComponents(2000, 0, 2, 0, 0, 0, 0) },
  week: { start: utcFromComponents(2000, 0, 3, 0, 0, 0, 0), end: utcFromComponents(2000, 0, 10, 0, 0, 0, 0) },
  month: { start: utcFromComponents(2000, 0, 1, 0, 0, 0, 0), end: utcFromComponents(2000, 1, 1, 0, 0, 0, 0) },
  year: { start: utcFromComponents(2000, 0, 1, 0, 0, 0, 0), end: utcFromComponents(2001, 0, 1, 0, 0, 0, 0) },
});

export function wrapTime(time, nanoseconds = 0, wrapping = 'off') {
  assertOneOf(wrapping, ['off', 'day', 'week', 'month', 'year'], 'scale wrapping');
  const normalized = normalizeTime(time, nanoseconds);
  if (wrapping === 'off') return normalized;
  const date = new Date(toWallMilliseconds(normalized.time));
  const parts = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()];
  let milliseconds;
  if (wrapping === 'day') milliseconds = utcFromComponents(2000, 0, 1, ...parts);
  if (wrapping === 'week') {
    const mondayIndex = (date.getUTCDay() + 6) % 7;
    milliseconds = utcFromComponents(2000, 0, 3 + mondayIndex, ...parts);
  }
  if (wrapping === 'month') milliseconds = utcFromComponents(2000, 0, date.getUTCDate(), ...parts);
  if (wrapping === 'year') milliseconds = utcFromComponents(2000, date.getUTCMonth(), date.getUTCDate(), ...parts);
  return normalizeTime(milliseconds, normalized.timeNanoseconds);
}

function nextBoundary(milliseconds, wrapping) {
  const date = new Date(milliseconds);
  if (wrapping === 'day') return utcFromComponents(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0);
  if (wrapping === 'week') {
    const days = 7 - ((date.getUTCDay() + 6) % 7);
    return utcFromComponents(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 0, 0, 0, 0);
  }
  if (wrapping === 'month') return utcFromComponents(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return utcFromComponents(date.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0);
}

export function splitWrappedRange(range, wrapping) {
  const normalized = normalizeTimeRange(range);
  if (wrapping === 'off') return [normalized];
  assertOneOf(wrapping, ['day', 'week', 'month', 'year'], 'scale wrapping');
  const result = [];
  let cursor = normalized.start;
  while (cursor.epochNanoseconds < normalized.end.epochNanoseconds) {
    const cursorMs = toWallMilliseconds(cursor.time);
    const boundary = normalizeTime(nextBoundary(cursorMs, wrapping));
    const segmentEnd = boundary.epochNanoseconds < normalized.end.epochNanoseconds ? boundary : normalized.end;
    let start = wrapTime(cursor.time, cursor.timeNanoseconds, wrapping);
    let end;
    if (segmentEnd === boundary) {
      const base = WRAP_BASE_RANGES[wrapping];
      end = normalizeTime(base.end);
    } else end = wrapTime(segmentEnd.time, segmentEnd.timeNanoseconds, wrapping);
    result.push({ start, end });
    cursor = segmentEnd;
  }
  if (result.length === 0) {
    const point = wrapTime(normalized.start.time, normalized.start.timeNanoseconds, wrapping);
    result.push({ start: point, end: point });
  }
  return result;
}

export function wrappedIntersects(itemRange, visibleRange, wrapping = 'off') {
  const items = splitWrappedRange(itemRange, wrapping);
  const visible = normalizeTimeRange(visibleRange);
  return items.some(item => item.end.epochNanoseconds >= visible.start.epochNanoseconds
    && item.start.epochNanoseconds <= visible.end.epochNanoseconds);
}
