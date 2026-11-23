import { cssFontFamily } from '../fontFamily.js';
import { DATE_TIME_FORMATS } from './defaults.js';
import { aggregateEvents, resolveEventColor } from './aggregation.js';
import { deriveRows } from './rows.js';
import {
  addInterval, formatTime, normalizeTime, roundToInterval, splitWrappedRange, toEpochNanoseconds, wrapTime,
} from './time.js';
import { averageColors, multiplyColorAlpha } from './validation.js';

const SCALE_ROWS = 3;
const LABEL_X = 35; // label text inset and trailing padding match Chronograph
const LABEL_PAD = 48;
const GLYPH_RADIUS = 4;
const CONTROL_SIZE = 12;

function unionBounds(current, next) {
  if (!current) return { ...next };
  return {
    x1: Math.min(current.x1, next.x1), x2: Math.max(current.x2, next.x2),
    y1: Math.min(current.y1, next.y1), y2: Math.max(current.y2, next.y2),
  };
}

function roundedRect(ctx, x, y, width, height, radius = 2) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function truncate(ctx, label, maximumWidth, maximumCharacters) {
  let value = label.length > maximumCharacters ? `${label.slice(0, Math.max(0, maximumCharacters))}…` : label;
  while (value.length && ctx.measureText(value).width > maximumWidth) value = value.length < 2 ? '' : `${value.slice(0, -2)}…`;
  return value;
}

function eventStroke(ctx, model, event, entityId, x1, y1, x2, y2) {
  const mode = event.style.color;
  if (['from', 'to', 'entity', 'inverse'].includes(mode) && event.endpoints.all.length > 1) {
    const from = averageColors(event.endpoints.from.map(id => model.normalized.entities[id]?.style.color || '#3ebd93'));
    const toIds = event.endpoints.to.length ? event.endpoints.to : event.endpoints.from;
    const to = averageColors(toIds.map(id => model.normalized.entities[id]?.style.color || '#3ebd93'));
    if (from !== to && ctx.createLinearGradient) {
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      return gradient;
    }
  }
  return resolveEventColor(model, event, entityId);
}

function eventLineWidth(event) {
  if (typeof event.style.lineWidth === 'number') return event.style.lineWidth;
  const value = event.input.data?.[event.style.lineWidth];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.5, Math.min(12, Math.sqrt(Math.abs(value)))) : 1.5;
}

function drawGlyph(ctx, row, x, y, options, hitRegions) {
  const entity = row.entity;
  if (!entity) return;
  const glyph = entity.style.glyph;
  if (!glyph) return;
  const color = typeof glyph === 'object' && glyph.color ? glyph.color : entity.style.color;
  const icon = (typeof glyph === 'object' && glyph.fontIcon) || entity.style.fontIcon;
  if (icon) {
    ctx.fillStyle = icon.color || color;
    ctx.font = `${icon.fontWeight || 'normal'} ${Math.max(8, row.height * 0.55 * (icon.scale ?? 1))}px ${cssFontFamily(icon.fontFamily || options.fontFamily)}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon.text || '', x + (icon.dx || 0), y + (icon.dy || 0));
  } else {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, GLYPH_RADIUS, 0, Math.PI * 2); ctx.fill();
  }
  hitRegions.push({ targetType: 'glyph', id: entity.id, x1: x - 7, x2: x + 7, y1: y - 7, y2: y + 7 });
}

function drawRows(ctx, model, rows, geometry, aggregation, hitRegions, entityPositions, xForTime) {
  const options = model.options();
  const focus = new Set(model.focus());
  const highlight = new Set(model.highlight());
  const reveal = new Set(aggregation.revealAlphas.keys());
  const revealedEntities = new Set([...reveal].flatMap(id => model.normalized.events[id]?.endpoints.all || []));
  rows.visibleRows.forEach(row => {
    ctx.save();
    if (reveal.size && !row.entityIds.some(id => revealedEntities.has(id))) {
      ctx.globalAlpha = Math.max(0.15, 1 - aggregation.revealAlpha * options.events.revealHeatmapAlpha * 0.75);
    }
    const centre = (row.y1 + row.y2) / 2;
    const active = row.entityIds.some(id => focus.has(id));
    const highlighted = highlight.has(row.id) || row.entityIds.some(id => highlight.has(id));
    if (active) { ctx.fillStyle = options.focus.backgroundColor; ctx.fillRect(0, row.y1, geometry.width, row.height); }
    if (highlighted) { ctx.fillStyle = options.highlightColor; ctx.fillRect(0, row.y1, geometry.width, row.height); }
    if (row.type === 'group' || row.type === 'run') {
      ctx.fillStyle = multiplyColorAlpha(options.highlightColor, row.type === 'group' ? 0.45 : 0.25);
      ctx.fillRect(0, row.y1, geometry.width, Math.max(1, row.height));
    }
    const representative = row.entity || model.normalized.entities[row.entityIds[0]];
    hitRegions.push({
      targetType: row.type === 'group' ? 'entityGroup' : row.type === 'run' ? 'entityRun' : row.type,
      id: row.id, label: row.label, entityIds: [...row.entityIds],
      x1: 0, x2: geometry.timeline.x2, y1: row.y1, y2: row.y2,
    });
    const lineColor = representative?.style.color || '#3ebd93';
    const showLine = options.entities.showLines === 'always'
      || (options.entities.showLines === 'individualEvents' && row.type === 'entity');
    if (showLine) {
      ctx.strokeStyle = multiplyColorAlpha(lineColor, 0.3);
      ctx.lineWidth = Math.max(0.5, representative?.style.lineWidth || 1);
      const drawLine = (x1, x2, alpha = 1) => {
        ctx.save(); ctx.globalAlpha *= alpha;
        ctx.beginPath(); ctx.moveTo(x1, centre); ctx.lineTo(x2, centre); ctx.stroke(); ctx.restore();
      };
      if (representative?.style.fadeOutsideRange && row.type === 'entity') {
        const related = Object.values(model.normalized.events).filter(event => event.endpoints.all.includes(row.id));
        drawLine(geometry.timeline.x1, geometry.timeline.x2, 0.2);
        if (related.length) {
          const first = related.reduce((value, event) => event.range.start.epochNanoseconds < value.epochNanoseconds ? event.range.start : value, related[0].range.start);
          const last = related.reduce((value, event) => event.range.end.epochNanoseconds > value.epochNanoseconds ? event.range.end : value, related[0].range.end);
          drawLine(Math.max(geometry.timeline.x1, xForTime(first)), Math.min(geometry.timeline.x2, xForTime(last)));
        }
      } else drawLine(geometry.timeline.x1, geometry.timeline.x2);
    }
    if (options.entities.showCircles && row.type === 'entity') {
      ctx.fillStyle = lineColor; ctx.beginPath(); ctx.arc(geometry.timeline.x1, centre, 3, 0, Math.PI * 2); ctx.fill();
    }
    const glyphX = options.entities.glyphPosition === 'left' ? 12 + row.depth * 8 : geometry.label.x2 - 12;
    if (row.type === 'group' && row.style?.typeGlyph !== false && row.style?.typeGlyph) {
      const glyph = row.style.typeGlyph;
      const icon = typeof glyph === 'object' ? glyph.fontIcon : null;
      ctx.fillStyle = typeof glyph === 'object' && glyph.color ? glyph.color : lineColor;
      if (icon) {
        ctx.font = `${icon.fontWeight || 'normal'} ${Math.max(8, row.height * 0.55 * (icon.scale ?? 1))}px ${cssFontFamily(icon.fontFamily || options.fontFamily)}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon.text || '', glyphX + (icon.dx || 0), centre + (icon.dy || 0));
      } else { ctx.beginPath(); ctx.arc(glyphX, centre, GLYPH_RADIUS, 0, Math.PI * 2); ctx.fill(); }
      hitRegions.push({ targetType: 'glyph', id: row.id, entityIds: [...row.entityIds], x1: glyphX - 7, x2: glyphX + 7, y1: centre - 7, y2: centre + 7 });
    } else drawGlyph(ctx, row, glyphX, centre, options, hitRegions);
    const hasGlyph = row.type === 'group' ? !!row.style?.typeGlyph : !!row.entity?.style.glyph;
    const textX = !hasGlyph ? LABEL_X + row.depth * 8 : options.entities.glyphPosition === 'left' ? glyphX + 10 : 8 + row.depth * 8;
    if (options.entities.labelBackgroundColor) {
      ctx.fillStyle = options.entities.labelBackgroundColor;
      ctx.fillRect(textX - 2, row.y1, Math.max(0, geometry.label.x2 - textX), row.height);
    }
    ctx.font = `${Math.max(8, row.height * 0.65)}px ${cssFontFamily(options.fontFamily)}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = representative?.style.labelColor || '#e5e8eb';
    ctx.fillText(truncate(ctx, row.label || '', Math.max(0, geometry.label.x2 - textX - 34), options.entities.truncateLabelsAt), textX, centre);
    const pinnedRow = model.getPinnedEntityIds().includes(row.id);
    if (row.type === 'entity' && (highlighted || active || pinnedRow || model.lens() === row.id)) {
      let right = geometry.label.x2 - 4;
      if (options.controls.pin.show) {
        ctx.strokeStyle = model.getPinnedEntityIds().includes(row.id) ? '#ffffff' : '#9aa5b1';
        ctx.strokeRect(right - CONTROL_SIZE, centre - CONTROL_SIZE / 2, CONTROL_SIZE, CONTROL_SIZE);
        hitRegions.push({ targetType: 'pin', id: row.id, label: row.label, x1: right - CONTROL_SIZE, x2: right, y1: centre - CONTROL_SIZE / 2, y2: centre + CONTROL_SIZE / 2 });
        right -= CONTROL_SIZE + 4;
      }
      if (options.controls.focus.show) {
        ctx.strokeStyle = focus.has(row.id) ? '#ffffff' : '#9aa5b1';
        ctx.beginPath(); ctx.arc(right - CONTROL_SIZE / 2, centre, CONTROL_SIZE / 2, 0, Math.PI * 2); ctx.stroke();
        hitRegions.push({ targetType: 'focus', id: row.id, label: row.label, x1: right - CONTROL_SIZE, x2: right, y1: centre - CONTROL_SIZE / 2, y2: centre + CONTROL_SIZE / 2 });
        right -= CONTROL_SIZE + 4;
      }
      ctx.strokeStyle = model.lens() === row.id ? '#ffffff' : '#9aa5b1';
      ctx.beginPath(); ctx.moveTo(right - CONTROL_SIZE / 2, centre - 5); ctx.lineTo(right, centre);
      ctx.lineTo(right - CONTROL_SIZE / 2, centre + 5); ctx.lineTo(right - CONTROL_SIZE, centre); ctx.closePath(); ctx.stroke();
      hitRegions.push({ targetType: 'lensControl', action: 'open', id: row.id, label: row.label, x1: right - CONTROL_SIZE, x2: right, y1: centre - CONTROL_SIZE / 2, y2: centre + CONTROL_SIZE / 2 });
    }
    row.entityIds.forEach(id => { entityPositions[id] = { x1: 23, x2: geometry.timeline.x2, y1: row.y1, y2: row.y2 }; });
    ctx.restore();
  });
}

function arrow(ctx, x, y, fromX, fromY, color) {
  const dx = x - fromX; const dy = y - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length; const uy = dy / length;
  const px = -uy; const py = ux;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * 7 + px * 4, y - uy * 7 + py * 4);
  ctx.lineTo(x - ux * 7 - px * 4, y - uy * 7 - py * 4);
  ctx.closePath(); ctx.fill();
}

function drawIndividualEvents(ctx, model, rows, aggregation, xForTime, hitRegions, eventPositions) {
  const options = model.options();
  aggregation.individual.forEach(event => {
    const eventAlpha = Math.max(aggregation.detailAlpha, aggregation.revealAlphas.get(event.id) || 0);
    if (eventAlpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= eventAlpha;
    const segments = splitWrappedRange(event.range, options.scales.wrapping);
    const eventBounds = [];
    segments.forEach(segment => {
      let x1 = xForTime(segment.start); let x2 = xForTime(segment.end);
      const fold = aggregation.folds.find(item => item.progress > 0 && item.eventIds.includes(event.id));
      if (fold) {
        const index = fold.eventIds.indexOf(event.id) - (fold.eventIds.length - 1) / 2;
        const offset = index * 12 * fold.progress;
        x1 += offset; x2 += offset;
      }
      const sources = event.endpoints.from.map(id => ({ id, row: rows.entityIndex[id] })).filter(item => item.row);
      const targets = event.endpoints.to.map(id => ({ id, row: rows.entityIndex[id] })).filter(item => item.row);
      const sourceRoles = sources.map(item => ({ ...item, role: 'from', x: x1 }));
      const targetRoles = targets.map(item => ({ ...item, role: 'to', x: x2 }));
      const terminalRoles = Math.abs(x2 - x1) >= 1 && !targets.length ? sources.map(item => ({ ...item, role: 'end', x: x2 })) : [];
      const roles = [...sourceRoles, ...targetRoles, ...terminalRoles];
      if (!roles.length) return;
      roles.forEach(item => { item.y = (item.row.y1 + item.row.y2) / 2; });
      const centres = roles.map(item => item.y);
      const top = Math.min(...centres); const bottom = Math.max(...centres);
      const sourceCentre = sources.length ? sources.reduce((sum, item) => sum + (item.row.y1 + item.row.y2) / 2, 0) / sources.length : top;
      const targetCentre = targets.length ? targets.reduce((sum, item) => sum + (item.row.y1 + item.row.y2) / 2, 0) / targets.length : sourceCentre;
      const lineWidth = eventLineWidth(event);
      const color = eventStroke(ctx, model, event, event.endpoints.from[0], x1, sourceCentre, x2, targetCentre);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lineWidth;
      const showConnections = options.events.showLines === 'all' || model.focus().includes(event.id)
        || event.endpoints.all.some(id => model.focus().includes(id));
      const duration = Math.abs(x2 - x1) >= 1;
      if (duration) {
        // Chronograph paints a bar on every endpoint row and joins rows with a vertical line at the start.
        ctx.lineWidth = Math.max(lineWidth, 8);
        ctx.beginPath();
        [...sources, ...targets].forEach(item => { ctx.moveTo(x1, item.y ?? (item.row.y1 + item.row.y2) / 2); ctx.lineTo(x2, item.y ?? (item.row.y1 + item.row.y2) / 2); });
        ctx.stroke(); ctx.lineWidth = lineWidth;
      }
      if (showConnections || (duration && targets.length)) {
        ctx.beginPath();
        if (!duration) {
          if (options.events.joinStyle === 'horizontal') {
            ctx.moveTo(x1, top); ctx.lineTo(x1 + 8, top); ctx.lineTo(x1 + 8, bottom); ctx.lineTo(x1, bottom);
          } else if (bottom > top) { ctx.moveTo(x1, top); ctx.lineTo(x1, bottom); }
        } else if (targets.length) { ctx.moveTo(x1, top); ctx.lineTo(x1, bottom); }
        ctx.stroke();
      }
      roles.forEach(item => {
        const itemColor = resolveEventColor(model, event, item.id);
        ctx.fillStyle = itemColor;
        if (!duration) { ctx.beginPath(); ctx.arc(item.x, item.y, Math.max(4, lineWidth + 1), 0, Math.PI * 2); ctx.fill(); }
        // Arrowheads only on targets; a source is marked by its dot alone.
        if (event.style.showArrows && item.role === 'to') arrow(ctx, duration ? x1 : item.x, item.y, x1, sourceCentre, itemColor);
        if (event.style.fontIcon) {
          const icon = event.style.fontIcon;
          ctx.fillStyle = icon.color || itemColor;
          ctx.font = `${icon.fontWeight || 'normal'} ${Math.max(8, 10 * (icon.scale ?? 1))}px ${cssFontFamily(icon.fontFamily || options.fontFamily)}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(icon.text || '', item.x + (icon.dx || 0), item.y + (icon.dy || 0));
        }
      });
      const bounds = { x1: Math.min(x1, x2) - 7, x2: Math.max(x1, x2) + 7, y1: top - 7, y2: bottom + 7 };
      eventBounds.push(bounds);
      hitRegions.push({ targetType: 'event', id: event.id, eventIds: [event.id], ...bounds });
    });
    if (eventBounds.length) {
      const combined = eventBounds.reduce(unionBounds, null);
      eventPositions[event.id] = eventBounds.length > 1 ? { ...combined, wrappedSegments: eventBounds.map(item => ({ ...item })) } : combined;
    }
    ctx.restore();
  });
}

function drawSummaries(ctx, aggregation, hitRegions, eventPositions) {
  if (aggregation.detailAlpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= aggregation.detailAlpha;
  aggregation.summaries.forEach(summary => {
    ctx.strokeStyle = summary.color; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(summary.x1, summary.y); ctx.lineTo(summary.x2, summary.y); ctx.stroke();
    if (summary.y2 > summary.y1) {
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(summary.x1, summary.y1); ctx.lineTo(summary.x1, summary.y2); ctx.stroke();
    }
    const bounds = {
      x1: Math.min(summary.x1, summary.x2) - 4, x2: Math.max(summary.x1, summary.x2) + 4,
      y1: Math.min(summary.y - 4, summary.y1), y2: Math.max(summary.y + 4, summary.y2),
    };
    hitRegions.push({ targetType: 'eventSummary', id: summary.id, eventIds: [...summary.eventIds], range: summary.range, ...bounds });
    summary.eventIds.forEach(id => { eventPositions[id] = bounds; });
  });
  ctx.restore();
}

function drawFolds(ctx, model, rows, aggregation, xForTime, hitRegions, eventPositions) {
  if (aggregation.detailAlpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= aggregation.detailAlpha;
  aggregation.folds.forEach(fold => {
    const x = xForTime(normalizeTime(Number(fold.time / 1000000n), Number(fold.time % 1000000n)));
    const relatedRows = new Set();
    fold.eventIds.forEach(id => model.normalized.events[id].endpoints.all.forEach(entityId => {
      const row = rows.entityIndex[entityId]; if (row) relatedRows.add(row);
    }));
    const rowList = [...relatedRows];
    if (!rowList.length) return;
    const y1 = Math.min(...rowList.map(row => row.y1)); const y2 = Math.max(...rowList.map(row => row.y2));
    ctx.strokeStyle = '#e5e8eb'; ctx.lineWidth = fold.open ? 3 : 1;
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
    const bounds = { x1: x - 5, x2: x + 5, y1, y2 };
    hitRegions.push({ targetType: 'fold', id: fold.id, eventIds: [...fold.eventIds], ...bounds });
    fold.eventIds.forEach(id => { eventPositions[id] = bounds; });
  });
  ctx.restore();
}

function drawHeatmap(ctx, aggregation, hitRegions, eventPositions) {
  aggregation.heatmap.forEach(cell => {
    ctx.fillStyle = cell.color; ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
    const bounds = { x1: cell.x, x2: cell.x + cell.width, y1: cell.y, y2: cell.y + cell.height };
    hitRegions.push({ targetType: 'cell', id: cell.rowId, eventIds: [...cell.eventIds], range: cell.range, subItem: { subId: cell.id, x: cell.x + cell.width / 2, y: cell.y + cell.height / 2, width: cell.width, height: cell.height, value: cell.value }, ...bounds });
    cell.eventIds.forEach(id => { eventPositions[id] = unionBounds(eventPositions[id], bounds); });
  });
}

function chartRows(model) {
  const assigned = new Set();
  const rows = [];
  Object.values(model.normalized.stacks).forEach(stack => {
    const charts = stack.chartIds.map(id => model.normalized.charts[id]);
    charts.forEach(chart => assigned.add(chart.id));
    rows.push({ id: stack.id, label: stack.label, labelColor: stack.labelColor, charts });
  });
  Object.values(model.normalized.charts).forEach(chart => {
    if (!assigned.has(chart.id)) rows.push({ id: chart.id, label: chart.style.label, labelColor: chart.style.labelColor, charts: [chart] });
  });
  return rows;
}

function drawCharts(ctx, model, geometry, xForTime, hitRegions, highlightedPointId) {
  if (model.options().scales.wrapping !== 'off' || geometry.chart.y2 <= geometry.chart.y1) return [];
  const rows = chartRows(model);
  const height = (geometry.chart.y2 - geometry.chart.y1) / Math.max(1, rows.length);
  rows.forEach((row, rowIndex) => {
    const y1 = geometry.chart.y1 + rowIndex * height; const y2 = y1 + height;
    ctx.fillStyle = row.labelColor; ctx.font = `11px ${cssFontFamily(model.options().fontFamily)}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(truncate(ctx, row.label, geometry.label.x2 - 8, 40), 8, (y1 + y2) / 2);
    hitRegions.push({ targetType: 'timeSeriesChart', id: row.id, label: row.label, x1: 0, x2: geometry.label.x2, y1, y2 });
    const values = row.charts.flatMap(chart => chart.data.map(point => point.value));
    const minimum = Math.min(...values); const maximum = Math.max(...values); const span = maximum - minimum || 1;
    const nearestPoints = [];
    row.charts.forEach(chart => {
      const points = chart.data.map(point => ({ point, x: xForTime(point), y: y2 - 4 - ((point.value - minimum) / span) * Math.max(1, height - 8) }))
        .filter(point => point.x >= geometry.timeline.x1 - 2 && point.x <= geometry.timeline.x2 + 2);
      if (!points.length) return;
      ctx.save();
      ctx.strokeStyle = chart.style.color; ctx.fillStyle = chart.style.color; ctx.lineWidth = 1.5;
      ctx.setLineDash(chart.style.lineStyle === 'dashed' ? [4, 4] : []);
      ctx.beginPath();
      points.forEach(({ x, y }, index) => {
        if (index === 0) ctx.moveTo(x, y);
        else if (chart.style.type === 'step') { ctx.lineTo(x, points[index - 1].y); ctx.lineTo(x, y); }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (chart.style.fillAreaAlpha > 0) {
        ctx.lineTo(points.at(-1).x, y2 - 3); ctx.lineTo(points[0].x, y2 - 3); ctx.closePath();
        ctx.fillStyle = multiplyColorAlpha(chart.style.color, chart.style.fillAreaAlpha); ctx.fill();
      }
      ctx.restore();
      points.forEach(({ point, x, y }) => {
        const subItem = { index: point.index, subId: point.id, time: new Date(point.time.getTime()), timeNanoseconds: point.timeNanoseconds, value: point.value, x, y };
        nearestPoints.push({ chartId: chart.id, subItem, x, y });
        if (highlightedPointId === point.id) {
          ctx.save(); ctx.fillStyle = chart.style.color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        }
      });
    });
    if (nearestPoints.length) hitRegions.push({
      targetType: 'timeSeriesChart', id: row.id, label: row.label, nearestPoints,
      x1: geometry.timeline.x1, x2: geometry.timeline.x2, y1, y2,
    });
  });
  return rows;
}

function drawMarkers(ctx, model, geometry, xForTime) {
  const markers = model._markers || [];
  const options = model.options();
  const labels = { top: [], bottom: [] };
  const left = geometry.timeline.x1; const right = geometry.timeline.x2;
  [...markers].reverse().forEach(marker => {
    const style = marker.style;
    const color = style.color || options.scales.borderColor || options.scales.textColor;
    const labelColor = style.labelColor || options.scales.textColor;
    const segments = splitWrappedRange(marker.range, options.scales.wrapping).map(segment => ({
      segment, x1: xForTime(segment.start), x2: xForTime(segment.end),
    }));
    const visible = segments.filter(item => Math.max(item.x1, item.x2) >= left && Math.min(item.x1, item.x2) <= right);
    if (!visible.length) return;
    visible.forEach(({ x1, x2 }) => {
      if (Math.abs(x2 - x1) >= 1) {
        const bandX = Math.max(left, Math.min(x1, x2)); const bandRight = Math.min(right, Math.max(x1, x2));
        ctx.fillStyle = multiplyColorAlpha(color, 0.2);
        ctx.fillRect(bandX, geometry.timeline.y1, Math.max(0, bandRight - bandX), geometry.timeline.y2 - geometry.timeline.y1);
      }
    });
    const markerX = xForTime(options.scales.wrapping === 'off' ? marker.range.start : wrapTime(marker.range.start.time, marker.range.start.timeNanoseconds, options.scales.wrapping));
    if (markerX < left || markerX > right) return;
    if (style.showLine) {
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(markerX, geometry.timeline.y1); ctx.lineTo(markerX, geometry.timeline.y2); ctx.stroke();
    }
    ['top', 'bottom'].forEach(position => {
      const suffix = `${position[0].toUpperCase()}${position.slice(1)}`;
      if (!style[`showAt${suffix}`]) return;
      const edgeY = position === 'top' ? geometry.timeline.y1 : geometry.timeline.y2;
      const direction = position === 'top' ? -1 : 1;
      const icon = style.fontIcon;
      if (icon) {
        ctx.fillStyle = icon.color || color;
        ctx.font = `${icon.fontWeight || 'normal'} ${Math.max(8, options.scales.textSize * (icon.scale ?? 1))}px ${cssFontFamily(icon.fontFamily || options.fontFamily)}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(icon.text || '', markerX + (icon.dx || 0), edgeY + direction * 9 + (icon.dy || 0));
      } else {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(markerX, edgeY + direction * 9, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `${options.scales.textSize}px ${cssFontFamily(options.fontFamily)}`;
      const text = style.label;
      if (!text) return;
      const labelX = markerX + 6;
      const placed = labels[position];
      if (placed.some(item => item.x1 < labelX && item.x2 > labelX)) return;
      const nextX = Math.min(Infinity, ...placed.filter(item => item.x1 >= labelX).map(item => item.x1));
      const shown = truncate(ctx, text, nextX - labelX - 2, Infinity);
      const bounds = { x1: labelX, x2: labelX + ctx.measureText(shown).width };
      ctx.fillStyle = labelColor; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(shown, labelX, edgeY + direction * 9);
      labels[position].push(bounds);
    });
  });
}

// Tick intervals Chronograph offers on the scale, smallest first.
const SCALE_INTERVALS = (() => {
  const list = [];
  const add = (unit, values, nanoseconds) => values.forEach(value => list.push({ unit, value, nanoseconds: value * nanoseconds }));
  const decades = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  add('nanosecond', decades, 1); add('microsecond', decades, 1e3); add('millisecond', decades, 1e6);
  add('second', [1, 2, 5, 10, 30], 1e9); add('minute', [1, 2, 5, 10, 15, 30], 60e9);
  add('hour', [1, 2, 3, 6, 12], 3600e9); add('day', [1], 86400e9); add('week', [1], 604800e9);
  add('month', [1, 2, 3, 6], 2629800e9); add('year', [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], 31557600e9);
  return list;
})();
const FRACTION_SLOTS = { 2: 'centiseconds', 3: 'milliseconds', 4: 'hundredMicroseconds', 5: 'tenMicroseconds', 6: 'microseconds', 7: 'hundredNanoseconds', 8: 'tenNanoseconds', 9: 'nanoseconds' };
const SCALE_LABEL_FACTOR = 1.55; // minimum tick spacing as a multiple of the label width

function scaleFormatSlot(interval, upper) {
  if (upper) {
    if (interval.unit === 'second') return 'dateTimeSeconds';
    if (interval.unit === 'day') return 'date';
    if (interval.unit === 'month') return 'fullMonthYear';
    return 'year';
  }
  if (interval.nanoseconds < 1e8) return FRACTION_SLOTS[Math.min(9, Math.max(2, Math.ceil(-Math.log10(interval.nanoseconds / 1e9) - 1e-9)))];
  if (interval.nanoseconds < 1e9) return 'timeSecondsTenths';
  if (interval.unit === 'second') return 'timeSeconds';
  if (interval.unit === 'minute' || interval.unit === 'hour') return 'time';
  if (interval.unit === 'day' || interval.unit === 'week') return 'dayOfMonth';
  if (interval.unit === 'month') return 'fullMonth';
  return 'year';
}

/** The coarser tier drawn above a lower tick interval; null when the lower tier already spans years. */
function upperScaleInterval(lower) {
  if (lower.nanoseconds < 1e8) return { unit: 'second', value: 1, nanoseconds: 1e9 };
  if (['day', 'week'].includes(lower.unit)) return { unit: 'month', value: 1, nanoseconds: 2629800e9 };
  if (lower.unit === 'month') return { unit: 'year', value: 1, nanoseconds: 31557600e9 };
  if (lower.unit === 'year') return null;
  return { unit: 'day', value: 1, nanoseconds: 86400e9 };
}

function scaleTierStart(range, interval) {
  const calendar = ['day', 'week', 'month', 'year'].includes(interval.unit);
  if (calendar) return normalizeTime(roundToInterval(range.start.time, interval, 'floor')).epochNanoseconds;
  const step = BigInt(Math.max(1, Math.round(interval.nanoseconds)));
  const start = range.start.epochNanoseconds;
  return start - (((start % step) + step) % step);
}

/** Smallest interval whose ticks leave room for their own labels (thresholds fitted to Chronograph's choices). */
function selectScaleInterval(ctx, options, range, pixels) {
  const span = Number(range.end.epochNanoseconds - range.start.epochNanoseconds) || 1;
  const widest = (interval, slot) => {
    // Chronograph sizes ticks from the built-in formats, so custom dateTimeFormats never change the interval.
    const builtIn = { ...options.scales, dateTimeFormats: undefined };
    const format = defaultScaleFormat(slot, builtIn);
    let width = 0; let tick = scaleTierStart(range, interval);
    for (let index = 0; index < 4; index++) {
      const time = normalizeTime(Number(tick / 1000000n), Number(tick % 1000000n));
      width = Math.max(width, ctx.measureText(formatTime(time.time, time.timeNanoseconds, format, builtIn)).width);
      tick += BigInt(Math.max(1, Math.round(interval.nanoseconds)));
    }
    return width;
  };
  for (const interval of SCALE_INTERVALS) {
    const spacing = interval.nanoseconds / span * pixels;
    if (interval.nanoseconds < 1e8) {
      const slot = scaleFormatSlot(interval, false);
      if (spacing >= widest(interval, slot) * 2.4 + 20) return { interval, slot };
      continue;
    }
    if (interval.unit === 'month') {
      // Whole month names only fit single-month ticks; otherwise abbreviations.
      if (interval.value === 1 && spacing >= 100) return { interval, slot: 'fullMonth' };
      if (spacing >= 62) return { interval, slot: 'shortMonth' };
      continue;
    }
    const slot = scaleFormatSlot(interval, false);
    const floor = interval.unit === 'day' ? 22 : interval.unit === 'week' ? 32 : interval.unit === 'year' ? 52 : 0;
    if (spacing >= Math.max(floor, widest(interval, slot) * SCALE_LABEL_FACTOR)) return { interval, slot };
  }
  return { interval: SCALE_INTERVALS.at(-1), slot: 'year' };
}

function defaultScaleFormat(slot, options) {
  let format = DATE_TIME_FORMATS[slot] || DATE_TIME_FORMATS.dateTimeSeconds;
  if ((slot === 'fullMonth' || slot === 'fullMonthYear') && !options.dateTimeFormats?.[slot]) format = format.replace('MMMM', 'MMMMM');
  if (options.dateOrder === 'dmy') {
    format = format.replace(/^MMMM d, yyyy/, 'd MMMM yyyy').replace(/^MMMM d/, 'd MMMM');
  }
  if (options.dateTimeFormats?.[slot]) return options.dateTimeFormats[slot];
  return options.twelveHourClock ? format.replace(/HH/g, 'h') : format;
}

function drawScaleTier(ctx, model, geometry, position, xForTime, range, hitRegions, interval, slot, upper, y1, y2) {
  const options = model.options();
  const calendar = ['day', 'week', 'month', 'year'].includes(interval.unit);
  const step = BigInt(Math.max(1, Math.round(interval.nanoseconds)));
  // The scale spans the full canvas width, including the area under the entity labels.
  const lead = BigInt(Math.round(Number(range.end.epochNanoseconds - range.start.epochNanoseconds) * geometry.timeline.x1 / Math.max(1, geometry.timeline.x2 - geometry.timeline.x1)));
  let tick = scaleTierStart({ start: normalizeTime(Number((range.start.epochNanoseconds - lead) / 1000000n), Number((range.start.epochNanoseconds - lead) % 1000000n)) }, interval);
  const format = defaultScaleFormat(slot, options.scales);
  const direction = position === 'top' ? -1 : 1;
  const baseline = position === 'top' ? y2 : y1;
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  let count = 0;
  while (tick <= range.end.epochNanoseconds && count++ < 1000) {
    const time = normalizeTime(Number(tick / 1000000n), Number(tick % 1000000n));
    const intervalEnd = calendar ? normalizeTime(addInterval(time.time, interval)) : normalizeTime(Number((tick + step) / 1000000n), Number((tick + step) % 1000000n));
    const endTick = intervalEnd.epochNanoseconds;
    const x = xForTime(time); const nextX = xForTime(intervalEnd);
    if (nextX >= 0) {
      ctx.beginPath(); ctx.moveTo(x, baseline); ctx.lineTo(x, baseline + direction * 4); ctx.stroke();
      const label = formatTime(time.time, time.timeNanoseconds, format, options.scales);
      ctx.fillText(label, x + 4, y2 - 1);
      hitRegions.push({
        targetType: 'scale', id: `_scale-${position}-${upper ? 'upper' : 'lower'}-${tick}-${endTick}`,
        range: { start: time, end: intervalEnd }, subItem: { tier: upper ? 'upper' : 'lower', position, formatSlot: slot, label },
        x1: Math.max(geometry.timeline.x1, x), x2: Math.min(geometry.timeline.x2, nextX), y1, y2,
      });
    }
    tick = endTick;
  }
}

function drawScale(ctx, model, geometry, position, xForTime, range, hitRegions) {
  const options = model.options();
  if (!options.scales[`showAt${position === 'top' ? 'Top' : 'Bottom'}`]) return;
  const y1 = position === 'top' ? 0 : geometry.height - geometry.scaleHeight;
  const y2 = y1 + geometry.scaleHeight;
  if (options.scales.backgroundColor) { ctx.fillStyle = options.scales.backgroundColor; ctx.fillRect(0, y1, geometry.width, geometry.scaleHeight); }
  if (options.scales.borderColor) { ctx.strokeStyle = options.scales.borderColor; ctx.beginPath(); ctx.moveTo(0, position === 'top' ? y2 - 0.5 : y1 + 0.5); ctx.lineTo(geometry.width, position === 'top' ? y2 - 0.5 : y1 + 0.5); ctx.stroke(); }
  const pixels = Math.max(1, geometry.timeline.x2 - geometry.timeline.x1);
  ctx.font = `${options.scales.textSize}px ${cssFontFamily(options.fontFamily)}`; ctx.fillStyle = options.scales.textColor;
  ctx.strokeStyle = options.scales.borderColor || options.scales.textColor;
  const middle = y1 + geometry.scaleHeight / 2;
  const { interval: lower, slot: lowerSlot } = selectScaleInterval(ctx, options, range, pixels);
  const upper = upperScaleInterval(lower);
  // The coarse tier sits on the outer edge of the scale: above at the top, below at the bottom.
  const [upperY1, upperY2, lowerY1, lowerY2] = position === 'top' ? [y1, middle, middle, y2] : [middle, y2, y1, middle];
  if (upper) drawScaleTier(ctx, model, geometry, position, xForTime, range, hitRegions, upper, scaleFormatSlot(upper, true), true, upperY1, upperY2);
  drawScaleTier(ctx, model, geometry, position, xForTime, range, hitRegions, lower, lowerSlot, false, lowerY1, lowerY2);
}

function drawScaleGuide(ctx, model, geometry, state, xForTime) {
  if (!state.guide || state.guide.x < geometry.timeline.x1 || state.guide.x > geometry.timeline.x2) return null;
  const options = model.options();
  let x = state.guide.x;
  let time = state.guide.time;
  const candidates = Object.values(model.normalized.events).map(event => ({ x: xForTime(event.range.start), time: event.range.start }));
  const nearest = candidates.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  if (nearest && Math.abs(nearest.x - x) <= options.scaleGuide.snapDistance) { x = nearest.x; time = nearest.time; }
  ctx.save();
  ctx.strokeStyle = options.scaleGuide.lineColor; ctx.lineWidth = options.scaleGuide.width;
  ctx.beginPath(); ctx.moveTo(x, geometry.timeline.y1); ctx.lineTo(x, geometry.timeline.y2); ctx.stroke();
  const slot = options.scaleGuide.textFormat === 'auto' ? 'dateTimeSeconds' : null;
  const format = slot ? defaultScaleFormat(slot, options.scales) : options.scaleGuide.textFormat;
  const label = formatTime(time.time, time.timeNanoseconds, format, options.scales);
  ctx.font = `${options.scales.textSize}px ${cssFontFamily(options.fontFamily)}`; ctx.fillStyle = options.scaleGuide.textColor; ctx.textAlign = 'center';
  if (options.scaleGuide.showAtTop) { ctx.textBaseline = 'top'; ctx.fillText(label, x, 1); }
  if (options.scaleGuide.showAtBottom) { ctx.textBaseline = 'bottom'; ctx.fillText(label, x, geometry.height - 1); }
  ctx.restore();
  return { x, time, label };
}

function drawPings(ctx, model, rows, pings, xForTime, now) {
  const paintedBounds = [];
  pings.forEach(ping => {
    const elapsed = now - ping.start;
    const cycle = elapsed / ping.options.time;
    if (cycle >= ping.options.repeat) return;
    const amount = Math.max(0, cycle % 1);
    const sineOut = Math.sin(amount * Math.PI / 2);
    const alpha = Math.cos(amount * Math.PI / 2);
    const spread = 0.1 + (ping.options.spread - 0.1) * sineOut;
    const strokeWidth = 0.1 + (ping.options.strokeWidth - 0.1) * sineOut;
    const bounds = ping.ids.map(id => {
      const event = model.normalized.events[id];
      if (!event) return null;
      const eventRows = event.endpoints.all.map(entityId => rows.entityIndex[entityId]).filter(Boolean);
      if (!eventRows.length) return null;
      const centers = eventRows.map(row => (row.y1 + row.y2) / 2);
      return {
        id, x1: xForTime(event.range.start), x2: xForTime(event.range.end),
        y1: Math.min(...centers), y2: Math.max(...centers),
      };
    }).filter(Boolean);
    const painted = ping.options.mode === 'grouped' && bounds.length
      ? [{
        id: ping.ids.join('|'), x1: Math.min(...bounds.map(item => item.x1)), x2: Math.max(...bounds.map(item => item.x2)),
        y1: Math.min(...bounds.map(item => item.y1)), y2: Math.max(...bounds.map(item => item.y2)),
      }]
      : bounds;
    painted.forEach(bound => {
      const point = bound.x1 === bound.x2 && bound.y1 === bound.y2;
      const output = { ...bound, x: (bound.x1 + bound.x2) / 2, y: (bound.y1 + bound.y2) / 2, mode: ping.options.mode, alpha, spread, strokeWidth };
      paintedBounds.push(output);
      ctx.strokeStyle = multiplyColorAlpha(ping.options.color, alpha); ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      if (point) ctx.arc(bound.x1, bound.y1, spread, 0, Math.PI * 2);
      else {
        const margin = spread / Math.SQRT2;
        const x1 = bound.x1 - margin; const x2 = bound.x2 + margin;
        const y1 = bound.y1 - margin; const y2 = bound.y2 + margin;
        const radius = bound.x1 === bound.x2 && bound.y1 !== bound.y2 ? margin : Math.min(4, (x2 - x1) / 2, (y2 - y1) / 2);
        ctx.moveTo(x1 + radius, y1); ctx.lineTo(x2 - radius, y1); ctx.arcTo(x2, y1, x2, y1 + radius, radius);
        ctx.lineTo(x2, y2 - radius); ctx.arcTo(x2, y2, x2 - radius, y2, radius);
        ctx.lineTo(x1 + radius, y2); ctx.arcTo(x1, y2, x1, y2 - radius, radius);
        ctx.lineTo(x1, y1 + radius); ctx.arcTo(x1, y1, x1 + radius, y1, radius); ctx.closePath();
      }
      ctx.stroke();
    });
  });
  return paintedBounds;
}

function markerMargins(model) {
  const markers = model._markers || [];
  return {
    top: markers.some(marker => marker.style.showAtTop) ? 28 : 0,
    bottom: markers.some(marker => marker.style.showAtBottom) ? 28 : 0,
  };
}

export function renderTimeline(ctx, size, model, state = {}) {
  const options = model.options();
  const width = Math.max(1, size.width); const height = Math.max(1, size.height);
  const scaleHeight = Math.round(options.scales.textSize * SCALE_ROWS);
  const margins = markerMargins(model);
  const top = (options.scales.showAtTop ? scaleHeight : 0) + margins.top;
  const bottom = (options.scales.showAtBottom ? scaleHeight : 0) + margins.bottom;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = options.backgroundColor; ctx.fillRect(0, 0, width, height);
  ctx.font = `12px ${cssFontFamily(options.fontFamily)}`;
  const allLabels = Object.values(model.normalized.entities).map(entity => entity.style.label);
  ctx.font = `${options.entities.standardRowHeight * 0.65}px ${cssFontFamily(options.fontFamily)}`;
  const autoWidth = Math.min(width * 0.95, LABEL_X + LABEL_PAD + Math.max(0, ...allLabels.map(label => ctx.measureText(truncate(ctx, label, Infinity, options.entities.truncateLabelsAt)).width)));
  const labelWidth = state.labelAreaMode === 'fixed' ? Math.max(40, Math.min(width - 40, state.labelAreaWidth)) : autoWidth;
  const chartAvailable = options.scales.wrapping === 'off' && Object.keys(model.normalized.charts).length > 0;
  const contentHeight = Math.max(0, height - top - bottom);
  const chartHeight = chartAvailable ? contentHeight * Math.min(100, options.timeSeriesCharts.sizePercent) / 100 : 0;
  const chartAtTop = options.timeSeriesCharts.position === 'top';
  const chart = chartAtTop ? { y1: top, y2: top + chartHeight } : { y1: height - bottom - chartHeight, y2: height - bottom };
  const events = chartAtTop ? { y1: chart.y2, y2: height - bottom } : { y1: top, y2: chart.y1 };
  const geometry = {
    width, height, scaleHeight, label: { x1: 0, x2: labelWidth },
    timeline: { x1: labelWidth, x2: width, y1: top, y2: height - bottom }, chart, events,
  };
  const publicRange = model.range();
  const range = { start: normalizeTime(publicRange.start, publicRange.startNanoseconds), end: normalizeTime(publicRange.end, publicRange.endNanoseconds) };
  const xForTime = value => {
    const raw = value.epochNanoseconds === undefined ? normalizeTime(value.time, value.timeNanoseconds || 0) : value;
    const wrapped = options.scales.wrapping === 'off' ? raw : wrapTime(raw.time, raw.timeNanoseconds, options.scales.wrapping);
    return geometry.timeline.x1 + Number(wrapped.epochNanoseconds - range.start.epochNanoseconds) / Number(range.end.epochNanoseconds - range.start.epochNanoseconds) * (geometry.timeline.x2 - geometry.timeline.x1);
  };
  const rows = deriveRows(model, { y1: events.y1, y2: events.y2, lensOffset: state.lensOffset || 0 });
  const hitRegions = [];
  const entityPositions = Object.create(null); const eventPositions = Object.create(null);
  const now = state.now ?? Date.now();
  const aggregation = aggregateEvents(model, rows, {
    xForTime, timelineBounds: geometry.timeline, range, foldState: state.foldState,
    aggregationState: state.aggregationState, now,
  });
  drawRows(ctx, model, rows, geometry, aggregation, hitRegions, entityPositions, xForTime);
  // Events that start before the visible range must not paint over the label area, nor claim
  // clicks there: clip the event layers to the timeline and trim their hit regions to match.
  const firstEventRegion = hitRegions.length;
  ctx.save();
  ctx.beginPath(); ctx.rect(geometry.timeline.x1, 0, geometry.timeline.x2 - geometry.timeline.x1, height); ctx.clip();
  drawHeatmap(ctx, aggregation, hitRegions, eventPositions);
  drawSummaries(ctx, aggregation, hitRegions, eventPositions);
  drawFolds(ctx, model, rows, aggregation, xForTime, hitRegions, eventPositions);
  drawIndividualEvents(ctx, model, rows, aggregation, xForTime, hitRegions, eventPositions);
  ctx.restore();
  for (let i = hitRegions.length - 1; i >= firstEventRegion; i--) {
    const region = hitRegions[i];
    region.x1 = Math.max(region.x1, geometry.timeline.x1);
    if (region.x2 <= region.x1) hitRegions.splice(i, 1);
  }
  const charts = drawCharts(ctx, model, geometry, xForTime, hitRegions, state.chartHighlight || null);
  drawMarkers(ctx, model, geometry, xForTime);
  const pingPoints = drawPings(ctx, model, rows, state.pings || [], xForTime, now);
  drawScale(ctx, model, geometry, 'top', xForTime, range, hitRegions); drawScale(ctx, model, geometry, 'bottom', xForTime, range, hitRegions);
  const scaleGuide = drawScaleGuide(ctx, model, geometry, state, xForTime);
  hitRegions.push({ targetType: 'labelAreaBorder', id: '_labelAreaBorder', x1: labelWidth - 4, x2: labelWidth + 4, y1: top, y2: height - bottom });
  if (rows.lens) {
    const lensY1 = rows.rows[rows.lens.start]?.y1 || events.y1;
    const lensY2 = rows.rows[rows.lens.end - 1]?.y2 || events.y2;
    ctx.strokeStyle = options.showLensHighlight ? '#ffffff' : '#9aa5b1'; ctx.strokeRect(1, lensY1, width - 2, Math.max(1, lensY2 - lensY1));
    ctx.strokeRect(2, events.y1 + 2, 16, 16); ctx.beginPath(); ctx.moveTo(6, events.y1 + 6); ctx.lineTo(14, events.y1 + 14); ctx.moveTo(14, events.y1 + 6); ctx.lineTo(6, events.y1 + 14); ctx.stroke();
    hitRegions.push({ targetType: 'lensControl', action: 'close', id: '_lensClose', x1: 2, x2: 18, y1: events.y1 + 2, y2: events.y1 + 18 });
    const track = { x1: 20, x2: 28, y1: events.y1 + 2, y2: events.y2 - 2 };
    ctx.strokeRect(track.x1, track.y1, track.x2 - track.x1, Math.max(1, track.y2 - track.y1));
    const rowCount = Math.max(1, rows.lens.entityCount); const visibleCount = Math.max(1, rows.lens.end - rows.lens.start);
    const thumbHeight = Math.max(10, (track.y2 - track.y1) * visibleCount / rowCount);
    const travel = Math.max(0, track.y2 - track.y1 - thumbHeight);
    const thumbY = track.y1 + travel * rows.lens.entityStart / Math.max(1, rowCount - visibleCount);
    ctx.fillStyle = '#9aa5b1'; ctx.fillRect(track.x1 + 1, thumbY, track.x2 - track.x1 - 2, thumbHeight);
    hitRegions.push({ targetType: 'lensScrollbar', id: '_lensScrollbar', subItem: { x: track.x1, y: thumbY, width: track.x2 - track.x1, height: thumbHeight }, ...track });
  }
  if (state.marquee) { ctx.fillStyle = 'rgba(229,232,235,0.2)'; ctx.fillRect(state.marquee.x1, events.y1, state.marquee.x2 - state.marquee.x1, events.y2 - events.y1); }
  return { geometry, rows, aggregation, charts, pingPoints, scaleGuide, hitRegions, entityPositions, eventPositions, xForTime, range };
}
