// Type declarations for Graph Nexus (src/graph-nexus.js).

export type IdMap<T> = { [id: string]: T };
export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type Corner = 'ne' | 'nw' | 'se' | 'sw';
export type Spacing = number | string | number[] | { top?: number; right?: number; bottom?: number; left?: number };
export type Radii = number | string | number[] | { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number };

/* ---------------------------------------------------------------- items */

export interface FontIcon { t: string | number; c?: string; ff?: string }
export interface Halo { c: string; r?: number; w?: number }
export interface Donut { v: number[]; c?: string[]; w?: number; b?: string; bw?: number }

export interface Glyph {
  /** Fill colour; omit with `u` / `fi` to show only the icon. */
  c?: string;
  b?: string;
  e?: number;
  t?: string;
  fc?: string;
  ff?: string;
  fb?: boolean;
  fi?: FontIcon;
  u?: string;
  /** Compass point, or degrees clockwise from north. */
  p?: Compass | number;
  /** Distance from the node centre (numeric `p` only). */
  r?: number;
  /** Pill-shaped glyph that fits up to 25 characters. */
  w?: boolean;
  /** Pulse animation. */
  a?: boolean;
}

export interface Bubble { t: string; p?: Corner; c?: string; b?: string; fc?: string; ff?: string; fs?: number; fb?: boolean; g?: Glyph }

export interface NodeLabel {
  t?: string;
  fi?: FontIcon;
  fs?: number | 'auto';
  fc?: string;
  fbc?: string;
  ff?: string;
  fb?: boolean;
  b?: string;
  bw?: number;
  borderRadius?: Radii;
  padding?: Spacing;
  margin?: Spacing;
  minWidth?: number | 'stretch';
  minHeight?: number | 'stretch';
  maxWidth?: number;
  maxHeight?: number;
  /** Compass point (outside the node) or a position inside it. */
  position?: Compass | { horizontal?: 'left' | 'centre' | 'right' | number; vertical?: 'top' | 'middle' | 'bottom' | number };
  textAlignment?: { horizontal?: 'left' | 'centre' | 'right'; vertical?: 'top' | 'middle' | 'bottom' };
  textWrap?: 'initial' | 'normal';
}

export interface OpenComboStyle { c?: string; b?: string; bw?: number; bs?: 'solid' | 'dashed'; borderRadius?: Radii; t?: string | NodeLabel | NodeLabel[]; g?: Glyph[] }

export interface NodeStyle {
  c?: string;
  b?: string;
  bw?: number;
  bs?: 'solid' | 'dashed';
  borderRadius?: Radii;
  e?: number;
  sh?: 'circle' | 'box';
  w?: number | 'auto';
  h?: number | 'auto';
  minWidth?: number;
  minHeight?: number;
  t?: string | NodeLabel | NodeLabel[];
  fs?: number;
  fc?: string;
  fbc?: string;
  ff?: string;
  fb?: boolean;
  /** Label below the node instead of inside (default false for image nodes). */
  tc?: boolean;
  u?: string;
  /** Cut the image out as a circle. */
  ci?: boolean;
  fi?: FontIcon | null;
  g?: Glyph[];
  bu?: Bubble;
  donut?: Donut;
  ha0?: Halo; ha1?: Halo; ha2?: Halo; ha3?: Halo; ha4?: Halo; ha5?: Halo; ha6?: Halo; ha7?: Halo; ha8?: Halo; ha9?: Halo;
  oc?: OpenComboStyle;
  bg?: boolean;
  hi?: boolean;
  du?: boolean;
  re?: boolean;
  pos?: { lat: number; lng: number };
  x?: number;
  y?: number;
  /** Depth, used only when options.view3d is on. */
  z?: number;
  d?: any;
}

export interface Node extends NodeStyle { type: 'node'; id: string; parentId?: string | null }

export interface LinkEndLabel { t?: string; fc?: string; fbc?: string; ff?: string; fs?: number; fb?: boolean; g?: Glyph[] }

export interface LinkStyle {
  c?: string;
  /** Gradient end colour (at id2). */
  c2?: string;
  w?: number;
  ls?: 'solid' | 'dashed' | 'dotted';
  a1?: boolean;
  a2?: boolean;
  /** Back-off from each end, as a fraction of the link length. */
  b1?: number;
  b2?: number;
  /** Arc offset in world units. */
  off?: number;
  flow?: boolean | { velocity?: number };
  t?: string;
  t1?: string | LinkEndLabel;
  t2?: string | LinkEndLabel;
  fs?: number;
  fc?: string;
  fbc?: string;
  ff?: string;
  fb?: boolean;
  g?: Glyph[];
  bu?: Bubble;
  bg?: boolean;
  hi?: boolean;
  d?: any;
}

export interface Link extends LinkStyle { type: 'link'; id: string; id1: string; id2: string }

export type Item = Node | Link;
export interface ChartData { type?: 'LinkChart'; items: Item[] }

/* ---------------------------------------------------------------- options */

export interface ChartOptions {
  aggregateLinks?: boolean | { aggregateBy?: string; aggregateByDirection?: boolean };
  arrows?: 'normal' | 'small' | 'large' | 'xlarge' | 'none';
  backColour?: string;
  backgroundAlpha?: number;
  bands?: { bands?: { x?: number; w?: number; c?: string; t?: string; fc?: string; fs?: number; ff?: string; fb?: boolean }[]; top?: boolean; bottom?: boolean } | null;
  combos?: { shape: 'circle' | 'rectangle' };
  controlColour?: string;
  controlTheme?: 'light' | 'dark';
  defaultStyles?: { comboGlyph?: Glyph | null; comboGlyphOnOpen?: boolean; comboLinks?: Partial<LinkStyle>; openCombos?: OpenComboStyle };
  drag?: { links?: boolean };
  dragPan?: boolean;
  fontFamily?: string;
  gradient?: { stops: { r: number; c: string }[] } | null;
  handMode?: boolean;
  /** Hover event delay in ms (default 150). */
  hover?: number;
  iconFontFamily?: string;
  imageAlignment?: IdMap<{ dx?: number; dy?: number; e?: number }>;
  labelOffset?: number;
  legacyGlyphAndLabelOrdering?: boolean;
  legacyShapeNodeBehaviour?: boolean;
  linkEnds?: { avoidLabels?: boolean; spacing?: 'loose' | 'tight' };
  linkStyle?: { glyphs?: 'along' | 'horizontal'; transition?: number; inline?: boolean; path?: 'direct' | 'horizontal' | 'vertical' };
  logo?: { u?: string | null; p?: Corner; x?: number; y?: number };
  marqueeLinkSelection?: 'centre' | 'ends' | 'off';
  maxItemZoom?: number;
  /**
   * Draw nodes at (x, y, z) through an orbit camera; see chart.camera(). Ignored in map mode.
   * `{ fog: true }` fades items with depth; `{ shading: true }` shades round nodes like spheres;
   * `labelMinRadius` (px, default 0) hides labels on smaller discs, except the selection.
   */
  view3d?: boolean | { fog?: boolean; shading?: boolean; labelMinRadius?: number };
  minZoom?: number;
  navigation?: { shown?: boolean; p?: Corner; x?: number; y?: number; wheel?: boolean };
  overview?: { shown?: boolean; icon?: boolean; p?: Corner; size?: number; backColour?: string; borderColour?: string };
  selectedLink?: Partial<LinkStyle> | null;
  selectedNode?: Partial<NodeStyle> | null;
  selectionColour?: string;
  selectionFontColour?: string;
  selfLinks?: boolean;
  truncateLabels?: { maxLength?: number; showOnHover?: boolean };
  watermark?: { t?: string; u?: string; a?: 'top' | 'centre' | 'bottom'; fc?: string; fbc?: string; fs?: number; ff?: string; fb?: boolean } | null;
  zoom?: { adaptiveStyling?: boolean };
  [key: string]: any;
}

export type LayoutName = 'organic' | 'hierarchy' | 'sequential' | 'lens' | 'radial' | 'structural' | 'tweak';
export type Packing = 'adaptive' | 'aligned' | 'circle' | 'rectangle' | 'none';

export interface Camera3D { yaw: number; pitch: number; focal: number; targetX: number; targetY: number; targetZ: number }

export interface LayoutOptions {
  animate?: boolean;
  time?: number;
  easing?: 'linear' | 'cubic';
  fit?: boolean;
  consistent?: boolean;
  fixed?: string[];
  mode?: 'full' | 'adaptive';
  tightness?: number;
  /** 3 gives the layout depth: organic, tweak and structural place nodes in z; radial and lens become concentric spheres; hierarchy and sequential become cone trees (each level a ring around the level axis). Defaults to 3 when options.view3d is on. */
  dimensions?: 2 | 3;
  packing?: Packing;
  top?: string | string[];
  level?: string;
  orientation?: 'down' | 'up' | 'left' | 'right';
  orderBy?: string | { property?: string; sortBy?: 'ascending' | 'descending' };
  spacing?: 'auto' | 'equal' | 'stretched';
  stacking?: { arrange: 'grid' | 'none' };
  stretch?: number;
  stretchType?: 'auto' | 'equal';
  flatten?: boolean;
  linkShape?: 'direct' | 'curved';
  straighten?: boolean;
}

export interface ExpandOptions {
  animate?: boolean;
  time?: number;
  layout?: LayoutOptions & { name?: LayoutName; fix?: 'all' | 'none' | 'adaptive' | 'adjacent' | 'nonadjacent' };
}

export interface ComboArrangement extends Pick<LayoutOptions, 'tightness' | 'level' | 'top' | 'orientation' | 'orderBy' | 'spacing' | 'stacking' | 'stretch' | 'stretchType' | 'linkShape' | 'packing'> {
  name?: 'lens' | 'concentric' | 'grid' | 'sequential' | 'none';
  gridShape?: 'auto' | { rows: number } | { columns: number };
}

export interface ComboDefinition { ids: string[]; label?: string; style?: NodeStyle; openStyle?: OpenComboStyle; open?: boolean; position?: 'average' | 'first'; dx?: number; dy?: number; glyph?: Glyph | null; d?: any }

export interface TimeBarOptions {
  backColour?: string;
  fontColour?: string;
  fontFamily?: string;
  fontSize?: number;
  type?: 'histogram' | 'area';
  histogram?: { colour?: string; highlightColour?: string; markColour?: string; markHiColour?: string };
  area?: { colour?: string };
  groups?: { groupBy?: string | null; categories?: (string | number)[] | null; colours?: string[] | null };
  sliders?: 'fixed' | 'free' | 'none';
  sliderColour?: string;
  sliderLineColour?: string;
  playSpeed?: number;
  showControlBar?: boolean;
  showPlay?: boolean;
  showExtend?: boolean;
  showFit?: boolean;
  controlBarTheme?: 'light' | 'dark';
  locale?: { shortMonths?: string[]; longMonths?: string[]; order?: 'dmy' | 'mdy'; h12?: boolean; ampm?: string[] };
  maxRange?: { value?: number; units?: TimeUnit } | null;
  minScale?: { value?: number; units?: TimeUnit } | null;
  heightChange?: { animate?: boolean; time?: number };
}
export type TimeUnit = 'sec' | 'min' | 'hour' | 'day' | 'week' | 'month' | 'year';
export interface TimeBarItem { id: string; dt: Date | number | { dt1?: Date | number; dt2?: Date | number } | (Date | number | { dt1?: Date | number; dt2?: Date | number })[]; v?: number | number[]; d?: any }

/* ---------------------------------------------------------------- timeline */

export type TimelineTime = Date | number;
export type TimelineOrdering = 'firstevent' | 'lastevent' | 'keyorder' | 'alphabetical' | 'shorteneventlines';
export type TimelineZoomUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond' | 'nanosecond';
export interface TimelineTimeRange {
  start: TimelineTime;
  end: TimelineTime;
  startNanoseconds?: number;
  endNanoseconds?: number;
}
export interface TimelineRangeResult {
  start: Date;
  end: Date;
  startNanoseconds: number;
  endNanoseconds: number;
}
export interface TimelineFontIcon {
  color?: string;
  dx?: number;
  dy?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  scale?: number;
  text?: string;
}
export interface TimelineGlyph { color?: string; fontIcon?: TimelineFontIcon }
export interface TimelineEntity {
  color?: string;
  data?: Record<string, any>;
  fadeOutsideRange?: boolean;
  fontIcon?: TimelineFontIcon;
  glyph?: boolean | TimelineGlyph;
  label?: string;
  labelColor?: string;
  lineWidth?: number;
  type?: string;
}
export interface TimelineEntityType {
  baseType?: string;
  color?: string;
  fadeOutsideRange?: boolean;
  fontIcon?: TimelineFontIcon;
  glyph?: boolean | TimelineGlyph;
  groupBy?: string[];
  labelColor?: string;
  lineWidth?: number;
  order?: number;
  priority?: number;
  typeGlyph?: boolean | TimelineGlyph;
  typeLabel?: string | false;
}
export type TimelineEventEntityIds = string[] | { from: string | string[]; to?: string | string[] };
export interface TimelineEvent {
  color?: string | 'from' | 'to' | 'entity' | 'inverse';
  data?: Record<string, any>;
  entityIds: TimelineEventEntityIds;
  fontIcon?: TimelineFontIcon;
  lineWidth?: number | string;
  showArrows?: boolean;
  time: TimelineTime | TimelineTimeRange;
  timeNanoseconds?: number;
  type?: string;
}
export interface TimelineEventType {
  baseType?: string;
  color?: string | 'from' | 'to' | 'entity' | 'inverse';
  fontIcon?: TimelineFontIcon;
  lineWidth?: number | string;
  showArrows?: boolean;
}
export interface TimelineChartPoint { time: TimelineTime; timeNanoseconds?: number; value: number }
export interface TimelineChart {
  color?: string;
  data: TimelineChartPoint[];
  fillAreaAlpha?: number;
  label?: string;
  labelColor?: string;
  lineStyle?: 'solid' | 'dashed';
  type?: 'linear' | 'step';
}
export interface TimelineChartStack { chartIds: string[]; label?: string; labelColor?: string }
export interface TimelineData {
  entities: IdMap<TimelineEntity>;
  events: IdMap<TimelineEvent>;
  entityTypes?: IdMap<TimelineEntityType>;
  eventTypes?: IdMap<TimelineEventType>;
  ordering?: TimelineOrdering;
  timeSeriesCharts?: IdMap<TimelineChart>;
  timeSeriesChartStacks?: IdMap<TimelineChartStack>;
}
export interface TimelineMarker {
  color?: string;
  fontIcon?: TimelineFontIcon;
  label: string;
  labelColor?: string;
  showAtBottom?: boolean;
  showAtTop?: boolean;
  showLine?: boolean;
  time: TimelineTime | TimelineTimeRange;
  timeNanoseconds?: number;
}
export type TimelineHeatmapColor = string | null | string[] | { eventType: string; color: string }[] | { value: number; color: string }[];
export type TimelineDateTimeFormatSlot = 'centiseconds' | 'date' | 'dateNoYear' | 'dateNoYearTime' | 'dateNoYearTimeSeconds' | 'dateTimeSeconds' | 'dayOfMonth' | 'dayOfMonthTime' | 'dayOfMonthTimeSeconds' | 'fullDayOfWeek' | 'fullDayOfWeekTime' | 'fullDayOfWeekTimeSeconds' | 'fullMonth' | 'fullMonthYear' | 'hundredMicroseconds' | 'hundredNanoseconds' | 'microseconds' | 'milliseconds' | 'nanoseconds' | 'shortDayOfWeek' | 'shortMonth' | 'tenMicroseconds' | 'tenNanoseconds' | 'time' | 'timeSeconds' | 'timeSecondsTenths' | 'timeMilliseconds' | 'timeMicroseconds' | 'timeNanoseconds' | 'year';
export type TimelineDateTimeFormats = Partial<Record<TimelineDateTimeFormatSlot, string>>;
export interface TimelineDateTimeNames {
  ampmNames?: string[];
  fullDayOfWeekNames?: string[];
  fullMonthNames?: string[];
  fullMonthNamesInDate?: string[];
  shortDayOfWeekNames?: string[];
  shortMonthNames?: string[];
}
export interface TimelineOptions {
  backgroundColor?: string;
  controls?: { focus?: { show?: boolean }; pin?: { show?: boolean } };
  scaleGuide?: { lineColor?: string; textColor?: string; textFormat?: string; width?: number; snapDistance?: number; showAtBottom?: boolean; showAtTop?: boolean };
  entities?: { glyphPosition?: 'left' | 'right'; labelBackgroundColor?: string | null; showCircles?: boolean; showLines?: 'always' | 'individualEvents' | 'never'; standardRowHeight?: number; truncateLabelsAt?: number };
  events?: { heatmapColor?: TimelineHeatmapColor; heatmapDirection?: 'any' | 'from' | 'to'; heatmapPadding?: boolean; heatmapThreshold?: number; heatmapValue?: string | null; joinStyle?: 'auto' | 'horizontal'; revealHeatmapAlpha?: number; showEventFolds?: boolean; showLines?: 'all' | 'focus' };
  focus?: { backgroundColor?: string; reorder?: boolean; showEventsOnNeighbors?: boolean };
  fontFamily?: string;
  highlightColor?: string;
  hover?: number;
  scales?: { backgroundColor?: string | null; borderColor?: string | null; dateOrder?: 'dmy' | 'mdy'; dateTimeFormats?: TimelineDateTimeFormats; dateTimeNames?: TimelineDateTimeNames; panLimit?: 'auto' | 'off'; showAtBottom?: boolean; showAtTop?: boolean; textColor?: string; textSize?: number; twelveHourClock?: boolean; wrapping?: 'off' | 'day' | 'week' | 'month' | 'year'; zoomOutLimit?: 'auto' | { unit: TimelineZoomUnit; value?: number } };
  showLensHighlight?: boolean;
  showWarnings?: boolean;
  timeSeriesCharts?: { position?: 'top' | 'bottom'; sizePercent?: number };
}

/* ---------------------------------------------------------------- events */

export interface PointerEventProps {
  id: string | null;
  x: number;
  y: number;
  button: number;
  pointerType: string;
  pointerId: number;
  subItem: object;
  modifierKeys: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; consistentCtrl: boolean };
  preventDefault(): void;
}

export interface ChartEvents {
  click: PointerEventProps;
  'double-click': PointerEventProps;
  'context-menu': PointerEventProps;
  hover: PointerEventProps;
  'pointer-down': PointerEventProps;
  'pointer-move': PointerEventProps;
  'pointer-up': PointerEventProps;
  'drag-start': PointerEventProps & { type: string };
  'drag-move': PointerEventProps & { type: string };
  'drag-over': PointerEventProps & { type: string };
  'drag-end': PointerEventProps & { type: string };
  wheel: PointerEventProps & { deltaX: number; deltaY: number };
  'key-down': { key: string; keyCode: number; code: string; preventDefault(): void };
  'key-up': { key: string; keyCode: number; code: string; preventDefault(): void };
  'selection-change': undefined;
  /** Delete / Backspace pressed while items are selected. */
  delete: undefined;
  'view-change': undefined;
  prechange: { type: string };
  progress: { task: string; progress: number };
  map: { type: 'showstart' | 'showend' | 'hidestart' | 'hideend' };
  'link-aggregation': { id: string; id1: string; id2: string; links: string[]; change: 'created' | 'updated' | 'deleted'; aggregateByValue: any; aggregateByDirection?: string };
}

export type TimelineTargetType = null | 'scale' | 'entity' | 'entityGroup' | 'entityRun' | 'event' | 'eventSummary' | 'fold' | 'cell' | 'glyph' | 'focus' | 'pin' | 'labelAreaBorder' | 'lensControl' | 'lensScrollbar' | 'timeSeriesChart';
export type TimelineDragType = 'lensScrollbar' | 'pan' | 'marqueeRange' | 'labelAreaWidth' | null;
export interface TimelineBounds { x1: number; x2: number; y1: number; y2: number }
export interface TimelineEventPosition extends TimelineBounds { wrappedSegments?: TimelineBounds[] }
export interface TimelineCellSubItem { subId: string; x: number; y: number; width: number; height: number; value: number }
export interface TimelineChartSubItem { index: number; subId: string; time: Date; timeNanoseconds: number; value: number; x: number; y: number }
export interface TimelinePointerEvent {
  button: number;
  pointerId: number;
  pointerType: string;
  modifierKeys: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; consistentCtrl: boolean };
  x: number;
  y: number;
  id: string | null;
  targetType: TimelineTargetType;
  label?: string;
  time: Date;
  timeNanoseconds: number;
  startTime?: Date;
  startNanoseconds?: number;
  endTime?: Date;
  endNanoseconds?: number;
  eventIds?: string[];
  subItem?: TimelineCellSubItem | TimelineChartSubItem | { subId?: string; x?: number; y?: number; width?: number; height?: number; value?: number };
  defaultPrevented: boolean;
  preventDefault(): void;
  synthetic?: boolean;
}
export interface TimelineDragEvent extends TimelinePointerEvent {
  dragType: TimelineDragType;
  canceled?: boolean;
  setDragOptions?(options: { type: TimelineDragType }): void;
}
export interface TimelineStateEvent { why: 'auto' | 'user' }
export interface TimelineCancelableEvent { defaultPrevented: boolean; preventDefault(): void }
export interface TimelineKeyEvent extends TimelineCancelableEvent {
  key: string;
  keyCode: number;
  modifierKeys: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; consistentCtrl: boolean };
  keyboardEvent: KeyboardEvent;
}
export interface TimelineEvents {
  click: TimelinePointerEvent;
  'context-menu': TimelinePointerEvent;
  'double-click': TimelinePointerEvent;
  'drag-start': TimelineDragEvent;
  'drag-move': TimelineDragEvent;
  'drag-end': TimelineDragEvent;
  draw: undefined;
  focus: TimelineStateEvent & { focus: string[] };
  highlight: TimelineStateEvent & { highlight: string[] };
  hover: TimelinePointerEvent;
  lens: TimelineStateEvent & { lens: string | null };
  'key-down': TimelineKeyEvent;
  'key-up': TimelineKeyEvent;
  pin: TimelineStateEvent & { pin: string[] };
  'pointer-down': TimelinePointerEvent;
  'pointer-up': TimelinePointerEvent;
  'pointer-move': TimelinePointerEvent;
  range: TimelineStateEvent & TimelineRangeResult;
  wheel: TimelinePointerEvent & { deltaX: number; deltaY: number; deltaMode: number };
}

/* ---------------------------------------------------------------- APIs */

export interface Graph {
  load(data: ChartData): void;
  clear(): void;
  degrees(opts?: { direction?: 'from' | 'to' | 'any'; value?: string; all?: boolean }): IdMap<number>;
  pageRank(opts?: { directed?: boolean; value?: string; all?: boolean }): IdMap<number>;
  eigenCentrality(opts?: { value?: string; all?: boolean }): IdMap<number>;
  closeness(opts?: { direction?: 'from' | 'to' | 'any'; normalization?: 'unnormalized' | 'chart' | 'component'; value?: string; weights?: boolean; all?: boolean; onProgress?: (p: number) => void }): Promise<IdMap<number>>;
  betweenness(opts?: { directed?: boolean; normalization?: 'unnormalized' | 'chart' | 'component'; value?: string; weights?: boolean; all?: boolean; onProgress?: (p: number) => void }): Promise<IdMap<number>>;
  distances(id: string, opts?: { direction?: 'from' | 'to' | 'any'; value?: string; weights?: boolean; all?: boolean }): IdMap<number>;
  shortestPaths(id1: string, id2: string, opts?: { direction?: 'from' | 'to' | 'any'; value?: string; weights?: boolean; all?: boolean }): { onePath: string[]; one: string[]; items: string[]; distance: number };
  neighbours(ids: string | string[], opts?: { direction?: 'from' | 'to' | 'any'; hops?: number; all?: boolean }): { nodes: string[]; links: string[] };
  components(opts?: { all?: boolean }): { nodes: string[]; links: string[] }[];
  clusters(opts?: { value?: string; factor?: number; consistent?: boolean; all?: boolean }): string[][];
  kCores(opts?: { all?: boolean }): { maximumK: number; values: IdMap<number> };
}

export interface Combo {
  combine(defs: ComboDefinition | ComboDefinition[], opts?: { arrange?: ComboArrangement['name'] | ComboArrangement; select?: boolean; animate?: boolean; time?: number }): Promise<string[]>;
  uncombine(ids: string | string[], opts?: { full?: boolean; select?: boolean; animate?: boolean; time?: number }): Promise<void>;
  open(ids: string | string[], opts?: { animate?: boolean; time?: number }): Promise<void>;
  close(ids: string | string[], opts?: { animate?: boolean; time?: number }): Promise<void>;
  isOpen(id: string): boolean;
  isCombo(ids: string | string[], opts?: { type?: 'node' | 'link' | 'all' }): boolean;
  find(id: string, opts?: { parent?: 'top' | 'first' }): string | null;
  find(ids: string[], opts?: { parent?: 'top' | 'first' }): (string | null)[];
  info(id: string): { nodes: Node[]; links: Link[] } | null;
  reveal(ids?: string | string[]): string[];
  transfer(ids: string | string[], comboId: string | null, opts?: { arrange?: ComboArrangement['name'] | ComboArrangement }): Promise<void>;
  arrange(ids: string | string[], opts?: ComboArrangement & { animate?: boolean; time?: number }): Promise<void>;
}

export interface GraphMap {
  show(): Promise<void>;
  hide(): Promise<void>;
  isShown(): boolean;
  options(): { animate?: boolean; leaflet?: any; padding?: number; tiles?: object | string | null; time?: number; transition?: string };
  options(val: { animate?: boolean; leaflet?: any; padding?: number; tiles?: object | string | null; time?: number; transition?: string }): Promise<void>;
  leafletMap(): any;
  mapCoordinates(x: number, y: number): { lat: number; lng: number } | null;
  viewCoordinates(lat: number, lng: number): { x: number; y: number } | null;
}

export interface ExportOptions { type: 'png' | 'jpeg' | 'svg' | 'pdf'; extents?: 'view' | 'chart'; fitTo?: { width?: number; height?: number } | 'page' }

export interface Chart {
  load(data: ChartData | Item[]): Promise<void>;
  merge(items: ChartData | Item[]): Promise<void>;
  expand(items: ChartData | Item[], opts?: ExpandOptions): Promise<void>;
  setItem(item: Item): Promise<void>;
  removeItem(ids: string | string[]): void;
  getItem(id: string): Item | null;
  getItem(ids: string[]): (Item | null)[];
  clear(): void;
  serialize(): ChartData;
  each(opts: { type?: 'node' | 'link' | 'all'; items?: 'underlying' | 'toplevel' | 'all' }, fn: (item: Item) => void): void;
  selection(): string[];
  selection(ids: string[]): string[];
  setProperties(props: Partial<Item> & { id: string } | (Partial<Item> & { id: string })[], useRegEx?: boolean): Promise<void>;
  animateProperties(props: Partial<Item> & { id: string } | (Partial<Item> & { id: string })[], opts?: { time?: number; easing?: 'linear' | 'cubic'; queue?: boolean }): Promise<void>;
  hide(ids: string | string[], opts?: { animate?: boolean; time?: number }): Promise<void>;
  show(ids: string | string[], showLinks?: boolean, opts?: { animate?: boolean; time?: number }): Promise<void>;
  filter(fn: (item: Item) => boolean, opts?: { type?: 'node' | 'link' | 'all'; hideSingletons?: boolean; animate?: boolean; time?: number }): Promise<{ shown: { nodes: string[]; links: string[] }; hidden: { nodes: string[]; links: string[] }; combos: { nodes: any[]; links: any[] } }>;
  foreground(fn: (item: Item) => boolean, opts?: { type?: 'node' | 'link' | 'all' }): Promise<{ foreground: { nodes: string[]; links: string[] }; background: { nodes: string[]; links: string[] } }>;
  ping(ids: string | string[], opts?: { c?: string; r?: number; w?: number; lw?: number; time?: number; repeat?: number }): Promise<void>;
  layout(name?: LayoutName, opts?: LayoutOptions): Promise<void>;
  arrange(name: 'grid' | 'circle' | 'radial' | 'concentric' | 'lens' | 'sequential', ids: string[], opts?: { animate?: boolean; fit?: boolean; position?: 'absolute' | 'average' | 'tidy'; tightness?: number; time?: number; x?: number; y?: number; gridShape?: ComboArrangement['gridShape'] }): Promise<void>;
  zoom(how: 'in' | 'out' | 'one' | 'fit' | 'height' | 'selection', opts?: { animate?: boolean; time?: number; ids?: string | string[] }): Promise<void>;
  pan(direction: 'up' | 'down' | 'left' | 'right' | 'selection', opts?: { animate?: boolean; time?: number }): Promise<void>;
  viewOptions(): { zoom: number; offsetX: number; offsetY: number; width: number; height: number };
  viewOptions(val: { zoom?: number; offsetX?: number; offsetY?: number }, transition?: { animate?: boolean; time?: number }): Promise<void>;
  /** 3D camera: angles in radians, focal (perspective) and orbit pivot in world units. */
  camera(next?: Partial<Camera3D>, opts?: { animate?: boolean; time?: number }): Camera3D;
  /** In 3D, z is the world depth; returns null for a point behind the camera. */
  viewCoordinates(x: number, y: number, z?: number): { x: number; y: number } | null;
  /** In 3D, the point on the camera-facing plane through the orbit pivot (z included). */
  worldCoordinates(x: number, y: number): { x: number; y: number; z?: number };
  getItemInfoAt(x: number, y: number): { id: string; subItem: object } | undefined;
  contains(shape: { x: number; y: number; w: number; h: number; sh?: 'box' | 'circle' }): string[];
  labelPosition(id: string): { x1: number; x2: number; y1: number; y2: number; fs: number } | null;
  lock(val?: boolean): boolean;
  createLink(id: string, linkId: string, opts?: { style?: LinkStyle }): Promise<string | null>;
  getAggregateInfo(id: string): { isAggregate?: boolean; aggregateChildren?: string[]; parentAggregate?: string; aggregateDirection?: string } | null;
  getAggregateInfo(ids: string[]): ({ isAggregate?: boolean; aggregateChildren?: string[]; parentAggregate?: string } | null)[];
  toDataURL(width?: number, height?: number, opts?: { fit?: 'view' | 'chart' | 'exact' | 'oneToOne'; selection?: boolean; logo?: boolean; watermark?: boolean }): Promise<string>;
  export(opts: ExportOptions): Promise<{ url: string; blob: Blob; warnings: { type: string; message: string }[] }>;
  options(): ChartOptions;
  options(val: ChartOptions): Promise<void>;
  graph(): Graph;
  combo(): Combo;
  map(): GraphMap;
  setContainer(element: string | HTMLElement | null): void;
  destroy(): void;
  on<K extends keyof ChartEvents>(name: K, handler: (props: ChartEvents[K]) => void): void;
  on(name: 'all', handler: (e: { name: string; event: any }) => void): void;
  off(name?: string, handler?: Function): void;
  bind(name: string, handler: (...args: any[]) => any): void;
  unbind(name?: string, handler?: Function): void;
}

export interface TimeBar {
  load(data: { items: TimeBarItem[] }): Promise<void>;
  merge(items: TimeBarItem[] | { items: TimeBarItem[] }): Promise<void>;
  removeItem(ids: string | string[]): void;
  clear(): void;
  range(): { dt1: Date; dt2: Date };
  range(dt1: Date | number, dt2: Date | number, opts?: { animate?: boolean; time?: number }): Promise<void>;
  getIds(dt1: Date | number, dt2: Date | number): string[];
  inRange(item: string | TimeBarItem): boolean;
  zoom(how?: 'in' | 'out' | 'fit', opts?: { animate?: boolean; time?: number; id?: string | string[] }): Promise<void>;
  pan(direction?: 'back' | 'forward', opts?: { animate?: boolean; time?: number }): Promise<void>;
  play(opts?: { extend?: boolean }): void;
  pause(): void;
  mark(): (Date | { dt1: Date; dt2: Date })[];
  mark(marks: (Date | number | { dt1?: Date | number; dt2?: Date | number })[]): number;
  selection(): (string[] | null)[];
  selection(lines: { id?: string | string[]; index?: number; c?: string } | { id?: string | string[]; index?: number; c?: string }[]): (string[] | null)[];
  options(): TimeBarOptions;
  options(val: TimeBarOptions): Promise<void>;
  setContainer(element: string | HTMLElement | null): void;
  destroy(): void;
  on(name: string, handler: (props: any) => void): void;
  off(name?: string, handler?: Function): void;
  bind(name: string, handler: (...args: any[]) => any): void;
  unbind(name?: string, handler?: Function): void;
}

export type TimelineScaleWrapping = 'off' | 'day' | 'week' | 'month' | 'year';
export interface TimelineScaleInfoRange { start: number; end: number; }
export interface TimelineScaleInfo {
  resolution: 0 | 1 | 2;
  zeroTime: number;
  scaleWrapping: TimelineScaleWrapping;
  wrappingInfo?: {
    baseRanges: [TimelineScaleInfoRange, TimelineScaleInfoRange, TimelineScaleInfoRange];
    intervalStep: { unit: Exclude<TimelineScaleWrapping, 'off'>; count: 1 };
  };
  wrappedZeroTime: number;
}
export interface TimelinePrivate {
  getScaleInfo(): TimelineScaleInfo;
  options(): TimelineOptions;
  options(value: TimelineOptions): TimelineOptions;
}

export interface Timeline {
  set(data: TimelineData): void;
  fit(): void;
  range(): TimelineRangeResult;
  range(start: TimelineTime, end: TimelineTime, startNanoseconds?: number, endNanoseconds?: number): TimelineRangeResult;
  pan(direction: 'left' | 'right', amount?: number): void;
  zoom(direction: 'in' | 'out'): void;
  focus(): string[];
  focus(ids: string | string[]): string[];
  highlight(): string[];
  highlight(ids: string | string[]): string[];
  pin(ids: string | string[], pinned?: boolean): void;
  getPinnedEntityIds(): string[];
  lens(): string | null;
  lens(id: string | null): string | null;
  labelAreaWidth(): { mode: 'auto' | 'fixed'; width: number };
  labelAreaWidth(mode: 'auto' | 'fixed', width?: number): { mode: 'auto' | 'fixed'; width: number };
  markers(): TimelineMarker[];
  markers(markers: TimelineMarker[]): TimelineMarker[];
  reveal(): string[];
  reveal(ids: string | string[]): string[];
  ping(ids: string | string[], options?: { color?: string; mode?: 'individual' | 'grouped'; repeat?: number; spread?: number; strokeWidth?: number; time?: number }): void;
  setOrdering(ordering: TimelineOrdering): void;
  getEntity(id: string): TimelineEntity | null;
  getEvent(id: string): TimelineEvent | null;
  getEntityPosition(id: string): TimelineBounds | null;
  getEventPosition(id: string): TimelineEventPosition | null;
  getRowEntityIds(id: string): string[] | null;
  getInRangeItems(options?: { focus?: boolean }): { entities: IdMap<boolean>; events: IdMap<boolean> };
  inRange(item: string | TimelineTime | TimelineTimeRange, nanoseconds?: number): boolean;
  options(): TimelineOptions;
  options(value: TimelineOptions): TimelineOptions;
  on<K extends keyof TimelineEvents>(name: K, handler: (event: TimelineEvents[K]) => void): void;
  off<K extends keyof TimelineEvents>(name: K, handler: (event: TimelineEvents[K]) => void): void;
  export(options: { type: 'png' }): Promise<{ url: string }>;
  setContainer(element: string | HTMLElement | null): void;
  destroy(): void;
  readonly private: TimelinePrivate;
}

export interface TimelineComponentDefinition { container: string | HTMLElement; id?: string; type: 'timeline'; options?: TimelineOptions }
export interface ComponentDefinition { container?: string | HTMLElement; id?: string; element?: HTMLElement; type?: 'chart' | 'timebar' | 'timeline'; options?: ChartOptions | TimeBarOptions | TimelineOptions }

export interface GraphNexusStatic {
  create(target: string | HTMLElement): Promise<Chart>;
  create(def: ComponentDefinition & { type?: 'chart'; options?: ChartOptions }): Promise<Chart>;
  create(def: ComponentDefinition & { type: 'timebar'; options?: TimeBarOptions }): Promise<TimeBar>;
  create(def: TimelineComponentDefinition): Promise<Timeline>;
  create(defs: ComponentDefinition[]): Promise<(Chart | TimeBar | Timeline)[]>;
  create(def: ComponentDefinition): Promise<Chart | TimeBar | Timeline>;
  createTimeline(definition: string | HTMLElement | Omit<TimelineComponentDefinition, 'type'>): Timeline;
  components: IdMap<Chart | TimeBar | Timeline>;
  callbacks(): GraphNexusStatic;
  coords(evt: Event): { x: number; y: number };
  corsAdapter(adapter: ((url: string) => string) | null): void;
  dashedLineSupport(): boolean;
  fullScreenCapable(): boolean;
  getFontIcon(classes: string): number;
  getGraphEngine(opts?: { selfLinks?: boolean }): Graph;
  /** `wasm`: true when layouts and graph measures run in the WebAssembly core. */
  info(): { version: string; mode: string; webgl: boolean; wasm: boolean };
  mode(value?: 'auto' | 'webgl' | 'canvas'): string;
  /** images: base for node image URLs; assets: base URL of the assets/ folder (bundled Leaflet) for dist builds. */
  paths(value?: { images?: string; assets?: string }): { images?: string; assets?: string };
  setSize(target: string | HTMLElement, width: number, height: number): void;
  toggleFullScreen(element: string | HTMLElement, handler?: (isFull: boolean) => void): void;
  webGLSupport(): boolean;
}

declare const GraphNexus: GraphNexusStatic;
export default GraphNexus;
export { GraphNexus };
export declare class ChronoGraphValidationError extends Error {}
export declare function create(defs: string | HTMLElement | ComponentDefinition | ComponentDefinition[]): Promise<Chart | TimeBar | Timeline | (Chart | TimeBar | Timeline)[]>;
export declare function createTimeline(definition: string | HTMLElement | Omit<TimelineComponentDefinition, 'type'>): Timeline;
export declare function createTimelineWithController(controller: object): Timeline;
