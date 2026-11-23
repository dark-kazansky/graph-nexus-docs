import GraphNexus from 'graph-nexus';
import { data, invertedNode } from './data.js';

let chart;

const DOCS_URL = 'https://dark-kazansky.github.io/graph-nexus-docs/graph-nexus/features/node-and-combo-styling.html';

/** Foregrounds the selected node only; no selection foregrounds everything. */
function highlightSelection(id) {
  chart.foreground(item => !id || item.id === id);
}

// Font Awesome / Material code points -> the call that produced them, for the code panel.
const iconNames = {};
['fa-user', 'fa-circle', 'fa-shuffle', 'fa-caret-down', 'fa-envelope', 'fa-code', 'fa-bug', 'fa-database',
  'fa-hdd', 'fa-server', 'fa-desktop', 'fa-up-right-from-square'].forEach(name => {
  iconNames[GraphNexus.getFontIcon(`fa-solid ${name}`)] = name;
});

/** JSON.stringify replacer: hides positions and state, collapses equal corner radii, names icons. */
function formatPrintString(key, value) {
  if (key === 'x' || key === 'y' || key === 'bg' || key.startsWith('_')) return undefined;
  if (key === 'fi' && iconNames[value.t]) return { ...value, t: `GraphNexus.getFontIcon('fa-solid ${iconNames[value.t]}')` };
  if (key === 'borderRadius' && Array.isArray(value) && new Set(value).size === 1) return value[0];
  return value;
}

/** Shows the selected node's definition so it can be copied. */
function prettyPrint(id) {
  const item = id && chart.getItem(id);
  const display = document.getElementById('display');
  if (!item) { display.textContent = 'No node selected'; return; }
  display.textContent = JSON.stringify(item, formatPrintString, 1)
    .replace(/"(t)":\s?"(GraphNexus\.getFontIcon[^"]+)"/g, '"$1": $2');
}

/** Labels that act as buttons: { nodeId: { labelIndex: onClick } }. */
const labelButtons = {};
const nodeStyles = {};
let styleInverted = false;
let hoveredButton = null;

const buttonAt = (id, subItem) => subItem.type === 'label' && labelButtons[id] && labelButtons[id][subItem.index];

function setHovered({ id, labelIndex }, isHovered) {
  const node = chart.getItem(id);
  if (!node || node.t.length <= labelIndex) return;
  const labels = node.t.map(l => ({ ...l }));
  // Hover colour is the midpoint of the two styles' colours.
  labels[labelIndex].fbc = isHovered ? '#9A9B9B' : nodeStyles[styleInverted ? 'inverted' : 'normal'].t[labelIndex].fbc;
  chart.setProperties({ id, t: labels });
}

function initialiseInteractions() {
  chart.on('selection-change', () => {
    const id = chart.selection()[0];
    highlightSelection(id);
    prettyPrint(id);
  });

  // Double-click the background to fit the chart; never zoom in.
  chart.on('double-click', ({ id, preventDefault }) => {
    if (!chart.getItem(id)) chart.zoom('fit', { animate: true, time: 500 });
    preventDefault();
  });

  // Nodes stay where they were designed.
  chart.on('drag-start', ({ type, preventDefault }) => {
    if (type === 'move') preventDefault();
  });

  nodeStyles.normal = JSON.parse(JSON.stringify(chart.getItem('t2')));
  nodeStyles.inverted = invertedNode;

  labelButtons.t2 = {
    // "Invert Style"
    2: () => {
      styleInverted = !styleInverted;
      chart.setProperties(nodeStyles[styleInverted ? 'inverted' : 'normal']);
      hoveredButton = null;
    },
    // "Go to Docs"
    3: () => window.open(DOCS_URL, '_blank'),
  };

  chart.on('click', ({ id, subItem, preventDefault }) => {
    const onClick = buttonAt(id, subItem);
    if (onClick) {
      onClick();
      prettyPrint(id);
      preventDefault();
    }
  });

  chart.on('pointer-move', ({ id, subItem }) => {
    if (hoveredButton) { setHovered(hoveredButton, false); hoveredButton = null; }
    if (buttonAt(id, subItem)) {
      hoveredButton = { id, labelIndex: subItem.index };
      setHovered(hoveredButton, true);
    }
    document.getElementById('klchart').style.cursor = hoveredButton ? 'pointer' : '';
  });
}

async function start() {
  await Promise.all([
    document.fonts.load('900 16px FontAwesomeSolid'),
    document.fonts.load('16px MaterialIcons'),
    document.fonts.load('16px Raleway'),
    document.fonts.load('bold 16px Raleway'),
    document.fonts.load('16px Muli'),
    document.fonts.load('bold 16px Muli'),
  ]);
  chart = await GraphNexus.create({
    container: 'klchart',
    options: {
      handMode: true,
      selectionColour: '#FF9933',
      iconFontFamily: 'FontAwesomeSolid',
      fontFamily: 'Muli',
      overview: { icon: false },
      navigation: { shown: false },
      backColour: 'rgb(238,238,238)',
    },
  });
  await chart.load(data);
  await chart.zoom('fit');
  initialiseInteractions();
  if (new URLSearchParams(location.search).has('debug')) window.__chart = chart;
}

window.addEventListener('DOMContentLoaded', start);
