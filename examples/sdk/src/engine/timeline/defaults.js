const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const ALLOWED_VALUES = deepFreeze({
  dateOrder: ['dmy', 'mdy'],
  eventColor: ['from', 'to', 'entity', 'inverse'],
  glyphPosition: ['left', 'right'],
  heatmapDirection: ['any', 'from', 'to'],
  joinStyle: ['auto', 'horizontal'],
  lineStyle: ['solid', 'dashed'],
  ordering: ['firstevent', 'lastevent', 'keyorder', 'alphabetical', 'shorteneventlines'],
  panDirection: ['left', 'right'],
  panLimit: ['auto', 'off'],
  scaleWrapping: ['off', 'day', 'week', 'month', 'year'],
  timeSeriesChartPosition: ['top', 'bottom'],
  timeSeriesChartType: ['linear', 'step'],
  zoomDirection: ['in', 'out'],
  zoomUnit: ['year', 'month', 'week', 'day', 'hour', 'minute', 'second', 'millisecond', 'microsecond', 'nanosecond'],
});

export const SUPPORTED_EVENTS = deepFreeze([
  'click', 'context-menu', 'double-click', 'drag-start', 'drag-move', 'drag-end',
  'draw', 'focus', 'highlight', 'hover', 'lens', 'key-down', 'key-up', 'pin',
  'pointer-down', 'pointer-up', 'pointer-move', 'range', 'wheel',
]);

export const DATE_TIME_FORMAT_SLOTS = deepFreeze([
  'centiseconds', 'date', 'dateNoYear', 'dateNoYearTime', 'dateNoYearTimeSeconds',
  'dateTimeSeconds', 'dayOfMonth', 'dayOfMonthTime', 'dayOfMonthTimeSeconds',
  'fullDayOfWeek', 'fullDayOfWeekTime', 'fullDayOfWeekTimeSeconds', 'fullMonth',
  'fullMonthYear', 'hundredMicroseconds', 'hundredNanoseconds', 'microseconds',
  'milliseconds', 'nanoseconds', 'shortDayOfWeek', 'shortMonth', 'tenMicroseconds',
  'tenNanoseconds', 'time', 'timeSeconds', 'timeSecondsTenths', 'timeMilliseconds',
  'timeMicroseconds', 'timeNanoseconds', 'year',
]);

export const DATE_TIME_NAMES = deepFreeze({
  ampmNames: ['AM', 'PM'],
  fullDayOfWeekNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fullMonthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fullMonthNamesInDate: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  shortDayOfWeekNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  shortMonthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
});

export const DATE_TIME_FORMATS = deepFreeze({
  centiseconds: '.ff',
  date: 'MMMM d, yyyy',
  dateNoYear: 'MMMM d',
  dateNoYearTime: 'MMMM d  HH:mm',
  dateNoYearTimeSeconds: 'MMMM d  HH:mm:ss',
  dateTimeSeconds: 'MMMM d, yyyy  HH:mm:ss',
  dayOfMonth: 'd',
  dayOfMonthTime: 'd  HH:mm',
  dayOfMonthTimeSeconds: 'd  HH:mm:ss',
  fullDayOfWeek: 'dddd',
  fullDayOfWeekTime: 'dddd  HH:mm',
  fullDayOfWeekTimeSeconds: 'dddd  HH:mm:ss',
  fullMonth: 'MMMM',
  fullMonthYear: 'MMMM yyyy',
  hundredMicroseconds: '.ffff',
  hundredNanoseconds: '.fffffff',
  microseconds: '.ffffff',
  milliseconds: '.fff',
  nanoseconds: '.fffffffff',
  shortDayOfWeek: 'ddd',
  shortMonth: 'MMM',
  tenMicroseconds: '.fffff',
  tenNanoseconds: '.ffffffff',
  time: 'HH:mm',
  timeSeconds: 'HH:mm:ss',
  timeSecondsTenths: 'HH:mm:ss.f',
  timeMilliseconds: 'HH:mm:ss.fff',
  timeMicroseconds: 'HH:mm:ss.ffffff',
  timeNanoseconds: 'HH:mm:ss.fffffffff',
  year: 'yyyy',
});

const NS = 1;
export const INTERVAL_CANDIDATES = deepFreeze([
  { unit: 'nanosecond', value: 1, nanoseconds: NS },
  { unit: 'nanosecond', value: 10, nanoseconds: 10 * NS },
  { unit: 'nanosecond', value: 100, nanoseconds: 100 * NS },
  { unit: 'microsecond', value: 1, nanoseconds: 1e3 },
  { unit: 'microsecond', value: 10, nanoseconds: 1e4 },
  { unit: 'microsecond', value: 100, nanoseconds: 1e5 },
  { unit: 'millisecond', value: 1, nanoseconds: 1e6 },
  { unit: 'millisecond', value: 10, nanoseconds: 1e7 },
  { unit: 'millisecond', value: 100, nanoseconds: 1e8 },
  { unit: 'second', value: 1, nanoseconds: 1e9 },
  { unit: 'second', value: 5, nanoseconds: 5e9 },
  { unit: 'second', value: 15, nanoseconds: 15e9 },
  { unit: 'minute', value: 1, nanoseconds: 60e9 },
  { unit: 'minute', value: 5, nanoseconds: 300e9 },
  { unit: 'minute', value: 15, nanoseconds: 900e9 },
  { unit: 'hour', value: 1, nanoseconds: 3600e9 },
  { unit: 'hour', value: 6, nanoseconds: 21600e9 },
  { unit: 'day', value: 1, nanoseconds: 86400e9 },
  { unit: 'week', value: 1, nanoseconds: 604800e9 },
  { unit: 'month', value: 1, nanoseconds: 2629800e9 },
  { unit: 'year', value: 1, nanoseconds: 31557600e9 },
  { unit: 'year', value: 10, nanoseconds: 315576000e9 },
  { unit: 'year', value: 100, nanoseconds: 3155760000e9 },
  { unit: 'year', value: 1000, nanoseconds: 31557600000e9 },
]);

export const DEFAULT_ENTITY_TYPE = deepFreeze({
  color: '#3ebd93', fadeOutsideRange: false, labelColor: '#e5e8eb', lineWidth: 1,
});

export const DEFAULT_EVENT_TYPE = deepFreeze({ color: 'entity', lineWidth: 1.5, showArrows: true });

export const DEFAULT_CHART = deepFreeze({
  color: '#e5e8eb', fillAreaAlpha: 0.3, lineStyle: 'solid', type: 'linear',
});

export const DEFAULT_MARKER = deepFreeze({ showAtBottom: true, showAtTop: true, showLine: true });

export const DEFAULT_OPTIONS = deepFreeze({
  backgroundColor: '#242c32',
  controls: { focus: { show: true }, pin: { show: true } },
  scaleGuide: {
    lineColor: '#e5e8eb', textColor: '#e5e8eb', textFormat: 'auto', width: 1,
    snapDistance: 10, showAtBottom: false, showAtTop: false,
  },
  entities: {
    glyphPosition: 'left', labelBackgroundColor: null, showCircles: false,
    showLines: 'individualEvents', standardRowHeight: 24, truncateLabelsAt: 40,
  },
  events: {
    heatmapColor: null, heatmapDirection: 'any', heatmapPadding: true,
    heatmapThreshold: 100, heatmapValue: null, joinStyle: 'auto',
    revealHeatmapAlpha: 1, showEventFolds: true, showLines: 'all',
  },
  focus: { backgroundColor: '#8b041b', reorder: true, showEventsOnNeighbors: false },
  fontFamily: 'sans-serif',
  highlightColor: '#515f6c',
  hover: 150,
  scales: {
    backgroundColor: null, borderColor: '#e5e8eb', dateOrder: 'mdy',
    dateTimeFormats: {}, dateTimeNames: {}, panLimit: 'auto', showAtBottom: true,
    showAtTop: true, textColor: '#e5e8eb', textSize: 14, twelveHourClock: true,
    wrapping: 'off', zoomOutLimit: 'auto',
  },
  showLensHighlight: true,
  showWarnings: true,
  timeSeriesCharts: { position: 'top', sizePercent: 25 },
});

export function cloneDefaults() {
  return structuredClone(DEFAULT_OPTIONS);
}
