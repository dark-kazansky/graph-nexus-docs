import GraphNexus from 'graph-nexus';
import { data as enronData, colours } from './enron-data.js';
import { buildLargeData } from './large-data.js';

// Datasets the panel can switch between. The large one is generated on first use.
const datasets = {
  enron: () => enronData,
  large: (() => { let cached; return () => (cached = cached || buildLargeData()); })(),
};

let chart;
let miniChart;
let restoreIds = [];

// Track UI state
const state = {
  view: '2d',
  sizeBy: 'same',
  volume: 'off',
  direction: 'any',
};

const colourMap = {};

/**
 * debounce - delays execution of "fn" until "timeToWait" ms have passed since
 * the last call, keeping drag interactions performant.
 */
function debounce(fn, timeToWait = 100) {
  let timeoutId;
  return function debouncedFn(...args) {
    const timeoutFn = () => {
      timeoutId = undefined;
      fn.apply(this, args);
    };
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(timeoutFn, timeToWait);
  };
}

// Avoid reloading the mini chart too often while dragging a selection marquee.
const loadMiniChart = debounce((items) => {
  miniChart.load({
    type: 'LinkChart',
    items,
  });
  layoutMini();
});

function isLink(id) {
  return id.match('-');
}

function updateHighlight(itemIds) {
  const props = [];

  // Remove previous styles
  if (restoreIds) {
    props.push(
      ...restoreIds.map((id) => {
        const colour = colourMap[id] || (isLink(id) ? colours.link : colours.node);
        return {
          id,
          c: colour,
          b: colour,
          ha0: null,
        };
      }),
    );
    restoreIds = [];
  }

  // Add new styles
  if (itemIds.length) {
    const toHighlight = [];
    itemIds.forEach((id) => {
      if (isLink(id)) {
        const link = chart.getItem(id);
        toHighlight.push(id, link.id1, link.id2);
      } else {
        const neighbours = chart.graph().neighbours(id);
        toHighlight.push(id, ...neighbours.nodes, ...neighbours.links);
      }
    });

    toHighlight.forEach((id) => {
      restoreIds.push(id);
      const style = { id };
      if (isLink(id)) {
        style.c = colours.selected;
      } else {
        style.ha0 = {
          c: colours.selected,
          r: 34,
          w: 6,
        };
      }
      props.push(style);
    });
  }

  chart.setProperties(props);
}

// All demo animations run at 2x the reference speed.
const ANIM_TIME = 250;

async function runLayout(inconsistent, mode) {
  const packing = mode === 'adaptive' ? 'adaptive' : 'circle';
  await chart.layout('organic', {
    time: ANIM_TIME, tightness: 4, consistent: !inconsistent, packing, mode, fit: false,
  });
  return chart.zoom('fit', { animate: true, time: ANIM_TIME * 0.6 });
}

function layoutMini() {
  return miniChart.layout('organic', { consistent: true, time: ANIM_TIME, fit: false })
    .then(() => miniChart.zoom('fit', { animate: true, time: ANIM_TIME * 0.6 }));
}

/**
 * Load a dataset into the main chart: reset highlight state and the mini
 * chart, lay it out, then re-apply the current Size / Volume / Direction.
 */
async function loadDataset(name) {
  restoreIds = [];
  Object.keys(colourMap).forEach((id) => { delete colourMap[id]; });
  miniChart.load({ type: 'LinkChart', items: [] });
  await chart.load(JSON.parse(JSON.stringify(datasets[name]())));
  await chart.zoom('fit', { animate: false });
  await runLayout();
  if (state.sizeBy !== 'same' || state.volume !== 'off') await analyseChart();
}

function klReady(charts) {
  [chart, miniChart] = charts;

  loadDataset('enron');

  // On selection change:
  //   1) style the targeted and neighbouring items
  //   2) copy the selected item and its neighbours to the miniChart
  chart.on('selection-change', () => {
    const ids = chart.selection();

    updateHighlight(ids);
    // 3D: the camera turns about the clicked node and brings it to the centre.
    if (state.view === '3d' && ids.length === 1 && !isLink(ids[0])) chart.pan('selection', { animate: true, time: 450 });

    const miniChartItems = [];

    if (ids.length > 0) {
      const { nodes, links } = chart.graph().neighbours(ids);

      chart.each({ type: 'node' }, (node) => {
        if (ids.includes(node.id) || nodes.includes(node.id)) {
          // Copy before mutating: the main chart holds these live node objects,
          // so mutating them here (resetting position, stripping the selection
          // halo) would erase the main chart's highlight and collapse the
          // highlighted nodes to the origin. The mini-chart gets its own copy.
          // z cleared too, so the mini layout starts fresh in 3D as well.
          miniChartItems.push({ ...node, x: 0, y: 0, z: undefined, ha0: null });
        }
      });

      chart.each({ type: 'link' }, (link) => {
        if (ids.includes(link.id) || links.includes(link.id)) {
          miniChartItems.push({ ...link, c: colours.link });
        }
      });
    }
    loadMiniChart(miniChartItems);
  });
}

// Pick a colour from a range of bands based on the normalized value.
function colourPicker(value) {
  const { bands, node } = colours;
  if (value > 0.75) {
    return bands[2];
  }
  if (value > 0.5) {
    return bands[1];
  }
  if (value > 0.25) {
    return bands[0];
  }
  return node;
}

function normalize(max, min, value) {
  if (max === min) {
    return min;
  }
  return (value - min) / (max - min);
}

function miniChartFilter(items) {
  return items.filter(({ id }) => miniChart.getItem(id));
}

async function animateValues(values, links) {
  const valuesArray = Object.values(values);

  const max = Math.max(...valuesArray);
  const min = Math.min(...valuesArray);

  const items = Object.entries(values).map(([id, value]) => {
    const normalized = normalize(max, min, value);
    const e = Math.max(1, normalized * 5);
    const c = max !== min ? colourPicker(normalized) : colours.node;
    colourMap[id] = c;
    return { id, e, c, b: c };
  }).concat(links);

  const miniItems = miniChartFilter(items);

  return Promise.all([
    chart.animateProperties(items, { time: ANIM_TIME }).then(() => runLayout(undefined, 'adaptive')),
    miniChart.animateProperties(miniItems, { time: ANIM_TIME }).then(layoutMini),
  ]);
}

function same() {
  return new Promise((resolve) => {
    const sizes = {};
    chart.each({ type: 'node' }, (node) => {
      sizes[node.id] = 0;
    });
    resolve(sizes);
  });
}

function wrapCallback(fn) {
  return (options) => new Promise((resolve) => resolve(fn(options)));
}

function getAnalysisFunction(name) {
  if (name.match(/^(degrees|pageRank|eigenCentrality)$/)) {
    return wrapCallback(chart.graph()[name]);
  }
  if (name.match(/^(closeness|betweenness)$/)) {
    return chart.graph()[name];
  }
  return same;
}

async function analyseChart() {
  const { sizeBy, volume } = state;

  const options = {};
  if (volume === 'on') {
    if (sizeBy.match(/^(betweenness|closeness)$/)) {
      options.weights = true;
    }
    options.value = 'count';
  }
  if (sizeBy.match(/^(betweenness|pageRank)$/)) {
    options.directed = state.direction !== 'any';
  } else {
    options.direction = state.direction;
  }

  const analyse = getAnalysisFunction(sizeBy);
  const values = await analyse(options);
  const linkWidths = calculateLinkWidths(volume === 'on');
  return animateValues(values, linkWidths);
}

function calculateLinkWidths(showValue) {
  const links = [];
  chart.each({ type: 'link' }, (link) => {
    const linkcount = link.d.count;
    let width = 1;
    if (showValue) {
      if (linkcount > 300) {
        width = 36;
      } else if (linkcount > 200) {
        width = 27;
      } else if (linkcount > 100) {
        width = 18;
      } else if (linkcount > 50) {
        width = 9;
      }
    }
    links.push({ id: link.id, w: width });
  });
  return links;
}

/**
 * Drag-mode button: hand (pan) or edit (select) in 2D. Hidden in 3D, where the
 * left button always rotates and the right button pans.
 */
function syncModeIcon() {
  const icon = document.getElementById('iconMode');
  const link = document.getElementById('changeMode');
  if (!icon || !link) return;
  const hand = !!chart.options().handMode;
  icon.className = `fa ${hand ? 'fa-arrows-alt' : 'fa-edit'}`;
  link.title = hand ? 'Drag mode' : 'Select mode';
  link.parentElement.hidden = state.view === '3d';
}

/** Switch both charts between the 2D and 3D view, then lay them out again. */
async function setViewMode(view) {
  state.view = view;
  const three = view === '3d';
  // Same node style as 2D (flat discs, no shading); fog fades the far side as a depth cue.
  const view3d = three ? { fog: true } : false;
  await Promise.all([chart.options({ view3d }), miniChart.options({ view3d })]);
  if (three) {
    chart.camera({ yaw: 0.6, pitch: -0.35 });
    miniChart.camera({ yaw: 0.6, pitch: -0.35 });
  }
  syncModeIcon();
  // organic places nodes in z when view3d is on; switching back to 2D flattens them.
  await Promise.all([runLayout(), layoutMini()]);
}

function doZoom(name) {
  chart.zoom(name, { animate: true, time: 175 });
}

function registerClickHandler(id, fn) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', fn);
  }
}

function updateActiveState(nodes, activeValue) {
  nodes.forEach((node) => {
    if (node.value === activeValue) {
      node.classList.add('active');
    } else {
      node.classList.remove('active');
    }
  });
}

function registerButtonGroup(className, handler) {
  const nodes = document.querySelectorAll(`.${className}`);
  nodes.forEach((node) => {
    node.addEventListener('click', () => {
      const { value } = node;
      updateActiveState(nodes, value);
      handler(value);
    });
  });
}

function initUI() {
  registerClickHandler('home', () => doZoom('fit'));
  registerClickHandler('zoomIn', () => doZoom('in'));
  registerClickHandler('zoomOut', () => doZoom('out'));
  registerClickHandler('layout', () => runLayout(true, 'full'));
  registerClickHandler('changeMode', async () => {
    await chart.options({ handMode: !chart.options().handMode });
    syncModeIcon();
  });

  registerButtonGroup('view', (view) => {
    setViewMode(view);
  });
  registerButtonGroup('dataset', (name) => {
    loadDataset(name);
  });
  registerButtonGroup('volume', (volume) => {
    state.volume = volume;
    analyseChart();
  });
  registerButtonGroup('size', (sizeBy) => {
    state.sizeBy = sizeBy;
    analyseChart();
  });
  registerButtonGroup('direction', (direction) => {
    state.direction = direction;
    analyseChart();
  });
}

async function loadGraphNexus() {
  initUI();

  const baseOpts = {
    arrows: 'normal',
    handMode: true,
    // Effectively no zoom-out limit (library default floor is 0.05; 0 would divide by zero).
    minZoom: 1e-6,
    navigation: { shown: false },
    overview: { icon: false },
    selectedNode: {
      c: colours.selected,
      b: colours.selected,
      fbc: colours.selected,
    },
    selectedLink: {
      c: colours.selected,
    },
  };

  const mainChartConfig = {
    container: 'klchart',
    options: Object.assign({}, baseOpts, {
      drag: { links: false },
      logo: { u: '' },
    }),
  };

  const miniChartConfig = {
    container: 'minikl',
    options: baseOpts,
  };

  // GraphNexus comes from the parent repo via the "graph-nexus" dependency (native ES modules, no bundle).
  const charts = await GraphNexus.create([mainChartConfig, miniChartConfig]);
  klReady(charts);
}

window.addEventListener('DOMContentLoaded', loadGraphNexus);
