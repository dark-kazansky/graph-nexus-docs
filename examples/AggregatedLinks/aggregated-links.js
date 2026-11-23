import GraphNexus from 'graph-nexus';
import { data, combineNodes } from './data.js';

let chart;

const aggregateOptions = {
  false: false,
  true: true,
  via: { aggregateBy: 'via' },
};

/** Styles each aggregate link: width and a counter glyph for its child count, plus the transport icon. */
function styleAggregate({ change, links, aggregateByValue, id }) {
  if (change === 'deleted') return;
  let colour = '#57534e';
  let typeGlyph;
  if (aggregateByValue) {
    const child = chart.getItem(links[0]);
    colour = child.c;
    typeGlyph = child.g[0];
  }
  const glyphs = [{ c: 'white', b: colour, t: links.length, fc: colour }];
  if (typeGlyph) glyphs.push(typeGlyph);
  chart.setProperties({ id, w: links.length, c: colour, g: glyphs });
}

function initialiseInteractions() {
  document.querySelectorAll('input[name="aggregateLinks"]').forEach(radio => {
    radio.addEventListener('change', e => chart.options({ aggregateLinks: aggregateOptions[e.target.value] }));
  });

  // Bound before load so the first aggregates get styled too.
  chart.on('link-aggregation', styleAggregate);

  // Double-click a combo to open or close it.
  chart.on('double-click', ({ id, button, preventDefault }) => {
    if (id && button === 0) {
      const combo = chart.combo();
      if (combo.isCombo(id)) {
        if (combo.isOpen(id)) combo.close(id);
        else combo.open(id);
      }
      preventDefault();
    }
  });
}

async function start() {
  await Promise.all(['900 16px FontAwesomeSolid', '16px Muli', 'bold 16px Muli'].map(f => document.fonts.load(f)));
  chart = await GraphNexus.create({ container: 'klchart', options: {
    handMode: true,
    selectionColour: '#1f1a17',
    backColour: '#ffffff',
    combos: { shape: 'rectangle' },
    iconFontFamily: 'FontAwesomeSolid',
    fontFamily: 'Muli',
    aggregateLinks: aggregateOptions.via,
  } });
  initialiseInteractions();
  await chart.load(data);
  await combineNodes(chart);
  await chart.layout('sequential', { orientation: 'right', stretch: 2, level: 'level' });
  if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
}

window.addEventListener('DOMContentLoaded', start);
