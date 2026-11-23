import {
  ALLOWED_VALUES, DATE_TIME_FORMAT_SLOTS, DATE_TIME_NAMES, SUPPORTED_EVENTS,
} from './defaults.js';

export class ChronoGraphValidationError extends Error {
  constructor(message, context = []) {
    const lines = Array.isArray(message) ? message : [...context, message];
    super(lines.join('\n'));
    this.name = 'ChronoGraphValidationError';
  }
}

export class ChronoGraphValidationWarning extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChronoGraphValidationWarning';
  }
}

const NAMED_COLORS = Object.freeze({
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c', cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function fail(context, message) {
  throw new ChronoGraphValidationError(message, context ? [context] : []);
}

export function assertPlainObject(value, context) {
  if (!isPlainObject(value)) fail(context, `${context} must be a plain object`);
  return value;
}

export function assertAllowedProperties(value, allowed, context) {
  assertPlainObject(value, context);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(context, `${context} has an unrecognized property '${key}'`);
  }
}

export function assertString(value, context) {
  if (typeof value !== 'string') fail(context, `${context} must be a string`);
}

export function assertBoolean(value, context) {
  if (typeof value !== 'boolean') fail(context, `${context} must be a boolean`);
}

export function assertFiniteNumber(value, context, { min = -Infinity, max = Infinity, positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(context, `${context} must be a finite number`);
  if (positive ? value <= 0 : value < min) fail(context, `${context} is outside its allowed range`);
  if (value > max) fail(context, `${context} is outside its allowed range`);
}

export function assertOneOf(value, allowed, context) {
  if (!allowed.includes(value)) fail(context, `${context} must be one of: ${allowed.join(', ')}`);
}

export function assertValidTime(value, context) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(context, `${context} is an invalid Date`);
  } else if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(context, `${context} must be a valid Date or finite UTC millisecond number`);
  }
}

export function assertUniqueStringArray(value, context, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(context, `${context} must be an array of strings`);
  if (nonEmpty && value.length === 0) fail(context, `${context} must not be empty`);
  if (new Set(value).size !== value.length) fail(context, `${context} contains duplicate values`);
}

export function parseColor(value) {
  if (typeof value !== 'string') fail('color', 'color must be a string');
  const color = value.toLowerCase();
  const source = NAMED_COLORS[color] || color;
  let match = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(source);
  if (match) match = match.slice(1).map(part => parseInt(part + part, 16));
  else {
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(source);
    if (hex) match = hex.slice(1).map(part => parseInt(part, 16));
  }
  if (!match) {
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(source);
    const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0\.\d{1,20}|1\.0)\s*\)$/i.exec(source);
    match = rgb || rgba;
    if (match) match = match.slice(1).map(Number);
  }
  if (!match || match.slice(0, 3).some(channel => channel < 0 || channel > 255)) {
    fail('color', `Invalid color string "${value}"`);
  }
  return { red: match[0], green: match[1], blue: match[2], alpha: match[3] ?? 1 };
}

export function colorToString({ red, green, blue, alpha = 1 }) {
  const channels = [red, green, blue].map(value => Math.round(value));
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return safeAlpha === 1
    ? `rgb(${channels.join(',')})`
    : `rgba(${channels.join(',')},${safeAlpha > 0 && safeAlpha < 1e-4 ? 0 : safeAlpha})`;
}

export function multiplyColorAlpha(color, multiplier) {
  assertFiniteNumber(multiplier, 'alpha multiplier', { min: 0 });
  const parsed = parseColor(color);
  return colorToString({ ...parsed, alpha: parsed.alpha * multiplier });
}

export function compositeColors(foreground, background) {
  const front = parseColor(foreground);
  const back = parseColor(background);
  const alpha = front.alpha + back.alpha * (1 - front.alpha);
  if (alpha === 0) return 'rgba(0,0,0,0)';
  return colorToString({
    red: (front.red * front.alpha + back.red * back.alpha * (1 - front.alpha)) / alpha,
    green: (front.green * front.alpha + back.green * back.alpha * (1 - front.alpha)) / alpha,
    blue: (front.blue * front.alpha + back.blue * back.alpha * (1 - front.alpha)) / alpha,
    alpha,
  });
}

export function interpolateColor(start, end, amount) {
  assertFiniteNumber(amount, 'gradient amount', { min: 0, max: 1 });
  const a = parseColor(start);
  const b = parseColor(end);
  const mix = key => a[key] + (b[key] - a[key]) * amount;
  return colorToString({ red: mix('red'), green: mix('green'), blue: mix('blue'), alpha: mix('alpha') });
}

export function averageColors(colors) {
  if (!Array.isArray(colors) || colors.length === 0) fail('colors', 'averageColors requires at least one color');
  const parsed = colors.map(parseColor);
  const rms = key => Math.sqrt(parsed.reduce((sum, color) => sum + color[key] ** 2, 0) / parsed.length);
  return colorToString({ red: rms('red'), green: rms('green'), blue: rms('blue'), alpha: rms('alpha') });
}

export function warn(message, showWarnings = false) {
  const warning = new ChronoGraphValidationWarning(message);
  if (showWarnings) console.warn(warning);
  return warning;
}

const OPTION_KEYS = {
  root: ['backgroundColor', 'controls', 'scaleGuide', 'entities', 'events', 'focus', 'fontFamily', 'highlightColor', 'hover', 'scales', 'showLensHighlight', 'showWarnings', 'timeSeriesCharts'],
  controls: ['focus', 'pin'], control: ['show'],
  scaleGuide: ['lineColor', 'textColor', 'textFormat', 'width', 'snapDistance', 'showAtBottom', 'showAtTop'],
  entities: ['glyphPosition', 'labelBackgroundColor', 'showCircles', 'showLines', 'standardRowHeight', 'truncateLabelsAt'],
  events: ['heatmapColor', 'heatmapDirection', 'heatmapPadding', 'heatmapThreshold', 'heatmapValue', 'joinStyle', 'revealHeatmapAlpha', 'showEventFolds', 'showLines'],
  focus: ['backgroundColor', 'reorder', 'showEventsOnNeighbors'],
  scales: ['backgroundColor', 'borderColor', 'dateOrder', 'dateTimeFormats', 'dateTimeNames', 'panLimit', 'showAtBottom', 'showAtTop', 'textColor', 'textSize', 'twelveHourClock', 'wrapping', 'zoomOutLimit'],
  timeSeriesCharts: ['position', 'sizePercent'], zoomOutLimit: ['unit', 'value'],
};

const optionalColor = (value, context) => { if (value !== null) { try { parseColor(value); } catch { fail(context, `${context} must be a supported CSS color or null`); } } };
const color = (value, context) => { try { parseColor(value); } catch { fail(context, `${context} must be a supported CSS color`); } };

function validateHeatmapColor(value, context) {
  if (value === null || typeof value === 'string') { if (value !== null) color(value, context); return; }
  if (!Array.isArray(value)) fail(context, `${context} must be a color, array, or null`);
  const modes = new Set(value.map(entry => typeof entry === 'string'
    ? 'palette'
    : isPlainObject(entry) && own(entry, 'eventType') ? 'eventType' : 'value'));
  if (modes.size > 1) fail(context, `${context} entries must all use the same heatmap color mode`);
  value.forEach((entry, index) => {
    if (typeof entry === 'string') return color(entry, `${context}[${index}]`);
    assertAllowedProperties(entry, own(entry, 'eventType') ? ['eventType', 'color'] : ['value', 'color'], `${context}[${index}]`);
    if (!own(entry, 'color')) fail(context, `${context}[${index}] is missing 'color'`);
    color(entry.color, `${context}[${index}].color`);
    if (own(entry, 'eventType')) assertString(entry.eventType, `${context}[${index}].eventType`);
    else {
      if (!own(entry, 'value')) fail(context, `${context}[${index}] is missing 'value'`);
      assertFiniteNumber(entry.value, `${context}[${index}].value`);
    }
  });
}

export function validateOptions(options, context = 'Timeline options') {
  assertAllowedProperties(options, OPTION_KEYS.root, context);
  const bool = ['showLensHighlight', 'showWarnings'];
  bool.forEach(key => { if (own(options, key)) assertBoolean(options[key], `${context}.${key}`); });
  ['backgroundColor', 'highlightColor'].forEach(key => { if (own(options, key)) color(options[key], `${context}.${key}`); });
  if (own(options, 'fontFamily')) assertString(options.fontFamily, `${context}.fontFamily`);
  if (own(options, 'hover')) assertFiniteNumber(options.hover, `${context}.hover`, { min: 0 });
  if (own(options, 'controls')) {
    assertAllowedProperties(options.controls, OPTION_KEYS.controls, `${context}.controls`);
    for (const key of Object.keys(options.controls)) {
      assertAllowedProperties(options.controls[key], OPTION_KEYS.control, `${context}.controls.${key}`);
      if (own(options.controls[key], 'show')) assertBoolean(options.controls[key].show, `${context}.controls.${key}.show`);
    }
  }
  if (own(options, 'scaleGuide')) {
    const item = options.scaleGuide; assertAllowedProperties(item, OPTION_KEYS.scaleGuide, `${context}.scaleGuide`);
    ['lineColor', 'textColor'].forEach(key => { if (own(item, key)) color(item[key], `${context}.scaleGuide.${key}`); });
    if (own(item, 'textFormat')) assertString(item.textFormat, `${context}.scaleGuide.textFormat`);
    ['width', 'snapDistance'].forEach(key => { if (own(item, key)) assertFiniteNumber(item[key], `${context}.scaleGuide.${key}`, { min: 0 }); });
    ['showAtBottom', 'showAtTop'].forEach(key => { if (own(item, key)) assertBoolean(item[key], `${context}.scaleGuide.${key}`); });
  }
  if (own(options, 'entities')) {
    const item = options.entities; assertAllowedProperties(item, OPTION_KEYS.entities, `${context}.entities`);
    if (own(item, 'glyphPosition')) assertOneOf(item.glyphPosition, ALLOWED_VALUES.glyphPosition, `${context}.entities.glyphPosition`);
    if (own(item, 'labelBackgroundColor')) optionalColor(item.labelBackgroundColor, `${context}.entities.labelBackgroundColor`);
    ['showCircles'].forEach(key => { if (own(item, key)) assertBoolean(item[key], `${context}.entities.${key}`); });
    if (own(item, 'showLines')) assertOneOf(item.showLines, ['always', 'individualEvents', 'never'], `${context}.entities.showLines`);
    ['standardRowHeight', 'truncateLabelsAt'].forEach(key => { if (own(item, key)) assertFiniteNumber(item[key], `${context}.entities.${key}`, { min: 0 }); });
  }
  if (own(options, 'events')) {
    const item = options.events; assertAllowedProperties(item, OPTION_KEYS.events, `${context}.events`);
    if (own(item, 'heatmapColor')) validateHeatmapColor(item.heatmapColor, `${context}.events.heatmapColor`);
    if (own(item, 'heatmapDirection')) assertOneOf(item.heatmapDirection, ALLOWED_VALUES.heatmapDirection, `${context}.events.heatmapDirection`);
    ['heatmapPadding', 'showEventFolds'].forEach(key => { if (own(item, key)) assertBoolean(item[key], `${context}.events.${key}`); });
    ['heatmapThreshold'].forEach(key => { if (own(item, key)) assertFiniteNumber(item[key], `${context}.events.${key}`, { min: 0 }); });
    if (own(item, 'heatmapValue') && item.heatmapValue !== null) assertString(item.heatmapValue, `${context}.events.heatmapValue`);
    if (own(item, 'joinStyle')) assertOneOf(item.joinStyle, ALLOWED_VALUES.joinStyle, `${context}.events.joinStyle`);
    if (own(item, 'revealHeatmapAlpha')) assertFiniteNumber(item.revealHeatmapAlpha, `${context}.events.revealHeatmapAlpha`, { min: 0, max: 1 });
    if (own(item, 'showLines')) assertOneOf(item.showLines, ['all', 'focus'], `${context}.events.showLines`);
  }
  if (own(options, 'focus')) {
    const item = options.focus; assertAllowedProperties(item, OPTION_KEYS.focus, `${context}.focus`);
    if (own(item, 'backgroundColor')) color(item.backgroundColor, `${context}.focus.backgroundColor`);
    ['reorder', 'showEventsOnNeighbors'].forEach(key => { if (own(item, key)) assertBoolean(item[key], `${context}.focus.${key}`); });
  }
  if (own(options, 'scales')) validateScaleOptions(options.scales, `${context}.scales`);
  if (own(options, 'timeSeriesCharts')) {
    const item = options.timeSeriesCharts; assertAllowedProperties(item, OPTION_KEYS.timeSeriesCharts, `${context}.timeSeriesCharts`);
    if (own(item, 'position')) assertOneOf(item.position, ALLOWED_VALUES.timeSeriesChartPosition, `${context}.timeSeriesCharts.position`);
    if (own(item, 'sizePercent')) assertFiniteNumber(item.sizePercent, `${context}.timeSeriesCharts.sizePercent`, { min: 0 });
  }
  return options;
}

function validateScaleOptions(item, context) {
  assertAllowedProperties(item, OPTION_KEYS.scales, context);
  ['backgroundColor', 'borderColor'].forEach(key => { if (own(item, key)) optionalColor(item[key], `${context}.${key}`); });
  if (own(item, 'textColor')) color(item.textColor, `${context}.textColor`);
  ['showAtBottom', 'showAtTop', 'twelveHourClock'].forEach(key => { if (own(item, key)) assertBoolean(item[key], `${context}.${key}`); });
  if (own(item, 'textSize')) assertFiniteNumber(item.textSize, `${context}.textSize`, { positive: true });
  if (own(item, 'dateOrder')) assertOneOf(item.dateOrder, ALLOWED_VALUES.dateOrder, `${context}.dateOrder`);
  if (own(item, 'panLimit')) assertOneOf(item.panLimit, ALLOWED_VALUES.panLimit, `${context}.panLimit`);
  if (own(item, 'wrapping')) assertOneOf(item.wrapping, ALLOWED_VALUES.scaleWrapping, `${context}.wrapping`);
  if (own(item, 'dateTimeFormats')) {
    assertAllowedProperties(item.dateTimeFormats, DATE_TIME_FORMAT_SLOTS, `${context}.dateTimeFormats`);
    Object.entries(item.dateTimeFormats).forEach(([key, value]) => assertString(value, `${context}.dateTimeFormats.${key}`));
  }
  if (own(item, 'dateTimeNames')) {
    const keys = Object.keys(DATE_TIME_NAMES); assertAllowedProperties(item.dateTimeNames, keys, `${context}.dateTimeNames`);
    Object.entries(item.dateTimeNames).forEach(([key, value]) => {
      assertUniqueStringArray(value, `${context}.dateTimeNames.${key}`);
      const expected = key === 'ampmNames' ? 2 : key.includes('Month') ? 12 : 7;
      if (value.length !== expected) fail(context, `${context}.dateTimeNames.${key} must contain ${expected} names`);
    });
  }
  if (own(item, 'zoomOutLimit') && item.zoomOutLimit !== 'auto') {
    assertAllowedProperties(item.zoomOutLimit, OPTION_KEYS.zoomOutLimit, `${context}.zoomOutLimit`);
    if (!own(item.zoomOutLimit, 'unit')) fail(context, `${context}.zoomOutLimit is missing 'unit'`);
    assertOneOf(item.zoomOutLimit.unit, ALLOWED_VALUES.zoomUnit, `${context}.zoomOutLimit.unit`);
    if (own(item.zoomOutLimit, 'value')) assertFiniteNumber(item.zoomOutLimit.value, `${context}.zoomOutLimit.value`, { positive: true });
  }
}

export function validateEventName(name, context = 'Timeline event name') {
  assertString(name, context);
  assertOneOf(name, SUPPORTED_EVENTS, context);
}

export function validateTimeRange(value, context) {
  assertAllowedProperties(value, ['start', 'end', 'startNanoseconds', 'endNanoseconds'], context);
  if (!own(value, 'start') || !own(value, 'end')) fail(context, `${context} requires start and end`);
  assertValidTime(value.start, `${context}.start`); assertValidTime(value.end, `${context}.end`);
  ['startNanoseconds', 'endNanoseconds'].forEach(key => { if (own(value, key)) assertFiniteNumber(value[key], `${context}.${key}`); });
}
