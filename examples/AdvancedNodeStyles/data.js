import GraphNexus from 'graph-nexus';

// Nodes with custom shapes, multiple styled labels, font icons and label "buttons".
// Font Awesome icons resolve through the page's Font Awesome CSS classes.
const icon = name => GraphNexus.getFontIcon(`fa-solid ${name}`);

function makeProfileCardNode(id, x, y) {
  return {
    type: 'node',
    id,
    x,
    y,
    c: 'white',
    w: 300,
    h: 'auto',
    borderRadius: '10 10 6 6',
    t: [
      {
        fi: { t: icon('fa-user') },
        fs: 64,
        fc: 'rgb(109, 59, 110)',
        fbc: 'white',
        b: 'rgb(74, 35, 75)',
        bw: 5,
        borderRadius: 60,
        minHeight: 100,
        minWidth: 100,
        margin: '-50 0 0 0',
        position: {
          vertical: 'top',
        },
      },
      {
        t: 'John Doe',
        fs: 30,
        fb: true,
        fc: 'rgb(74, 35, 75)',
        fbc: 'transparent',
        margin: '10 0 0 0',
      },
      {
        fi: { t: icon('fa-envelope') },
        fs: 12,
        fc: 'rgb(109, 59, 110)',
        fbc: 'transparent',
        margin: '10 0 0 0',
      },
      {
        t: 'john.doe@example.com',
        fs: 10,
        fc: 'rgb(109, 59, 110)',
        fbc: 'transparent',
        margin: '10 0 0 0',
        position: {
          vertical: 'inherit',
        },
      },
      {
        fi: { t: icon('fa-code') },
        fs: 12,
        fc: 'rgb(109, 59, 110)',
        fbc: 'transparent',
        margin: '10 0 0 0',
      },
      {
        t: 'Software Developer',
        fs: 10,
        margin: '10 0 0 0',
        fc: 'black',
        fbc: 'transparent',
        position: {
          vertical: 'inherit',
        },
      },      
      {
        t: 'john.doe@example.com',
        fs: 10,
        fc: 'white',
        fbc: 'rgb(109, 59, 110)',
        borderRadius: '0 0 6 6',
        margin: '10 0 0 0',
        padding: '10 0 10 0',
        minWidth: 300,
        position: {
          vertical: 'bottom',
        },
      },
    ],
  };
}

function makeBusinessProcessNode(id, x, y) {
  return {
    type: 'node',
    id,
    x,
    y,
    c: '#fdf8f1',
    w: 480,
    h: 120,
    b: '#e6dccd',
    bw: 2,
    borderRadius: 10,
    t: [
      {
        t: 'Business Process 1',
        fs: 32,
        fc: 'black',
        fbc: 'transparent',
        margin: {
          top: 8,
          right: 0,
          bottom: 0,
          left: 8,
        },
        position: {
          vertical: 'top',
          horizontal: 'left',
        },
      },
      {
        t: '2140.0',
        fs: 36,
        fc: 'black',
        fbc: 'transparent',
        textAlignment: {
          vertical: 'bottom',
        },
        margin: {
          left: 8,
          bottom: 23
        },
        position: {
          vertical: 'bottom',
          horizontal: 'left',
        },
      },
      {
        t: 'GBP',
        fs: 24,
        fc: 'black',
        fbc: 'transparent',
        textAlignment: {
          vertical: 'bottom',
        },
        minHeight: 36,
        margin: {
          bottom: 20,
        },
        position: {
          vertical: 'bottom',
        },
      },
      {
        fi: {
          t: icon('fa-caret-down'),
          c: '#c8553d',
        },
        fs: 36,
        fbc: 'transparent',
        textAlignment: {
          vertical: 'bottom',
        },
        minHeight: 36,
        margin: {
          right: 2,
          bottom: 20,
        },
        position: {
          vertical: 'bottom',
          horizontal: 'right',
        },
      },
      {
        t: '45.12%',
        fs: 24,
        fc: '#c8553d',
        fbc: 'transparent',
        textAlignment: {
          vertical: 'bottom',
        },
        position: {
          vertical: 'inherit',
        },
        margin: {
          bottom: 20,
        },
        minHeight: 36,
      },
      {
        fs: 0,
        fbc: '#e6dccd',
        minWidth: 482,
        minHeight: 18,
        borderRadius: [0, 0, 9, 9],
        position: {
          vertical: 103,
          horizontal: 'centre',
        },
        padding: 0,
      },
      {
        minWidth: 118.5,
        fs: 10,
        borderRadius: [0, 0, 0, 10],
        fbc: '#c8553d',
        position: {
          vertical: 'bottom',
          horizontal: 'left',
        },
        margin: 1,
      },
    ],
  }
}

function makeShadowCircleNode(id, x, y, colour, icon, text) {
  return {
    type: 'node',
    id,
    x,
    y,
    c: colour,
    b: '#3e5641',
    bw: 2,
    e: 1.5,
    ff: 'Muli',
    ha0: {
      c: 'rgba(220,220,220,1)',
      r: 29,
      w: 1,
    },
    ha1: {
      c: 'rgba(220,220,220,0.8)',
      r: 30,
      w: 1,
    },
    ha2: {
      c: 'rgba(220,220,220,0.6)',
      r: 31,
      w: 1,
    },
    ha3: {
      c: 'rgba(220,220,220,0.4)',
      r: 32,
      w: 1,
    },
    ha4: {
      c: 'rgba(220,220,220,0.2)',
      r: 33,
      w: 1,
    },
    t: [
      {
        fi: { t: icon, ff: 'MaterialIcons' },
        fs: 30,
        fc: '#3e5641',
        fbc: 'rgba(0, 0, 0, 0)',
        padding: {
          top: 6,
          right: 2,
          bottom: 0,
          left: 2,
        },
        position: { vertical: 'top' },
      },
      {
        t: text,
        fs: 10,
        fb: true,
        fc: '#3e5641',
        fbc: 'rgba(0, 0, 0, 0)',
      },
    ],
  }
}

function makeMaterialIconLabel(icon, fontSize, colour) {
  return {
    position: {
      horizontal: 'centre',
      vertical: 'middle',
    },
    fs: fontSize,
    fc: colour,
    fbc: 'transparent',
    fi: {
      t: icon,
      ff: 'MaterialIcons',
    },
    padding: {
      top: 5,
      right: 2,
      bottom: 0, 
      left: 2
    }
  };
}

function makeInteractiveNode(id, x, y, backgroundColour, accentColour) {
  return {
    type: 'node',
    id,
    x,
    y,
    b: accentColour,
    borderRadius: [0, 10, 20, 10],
    c: backgroundColour,
    w: 295,
    h: 80,
    t: [
      {
        fbc: 'transparent',
        fc: accentColour,
        fi: { t: icon('fa-desktop') },
        position: { horizontal: 6, vertical: 16 },
        fs: 44,
      },
      {
        fbc: 'transparent',
        fc: accentColour,
        fb: true,
        fs: 16,
        padding: '0 10 0 4',
        position: {
          horizontal: 60,
          vertical: 15,
        },
        t: 'Interactive Node',
        textAlignment: {
          horizontal: 'left',
        },
      },
      {
        fbc: accentColour,
        fc: backgroundColour,
        borderRadius: 10,
        fb: true,
        margin: '10 0',
        minWidth: 60,
        padding: '7 10',
        fs: '8',
        position: {
          horizontal: 60,
        },
        t: 'Invert Style',
      },
      {
        fbc: accentColour,
        fc: backgroundColour,
        borderRadius: 10,
        fb: true,
        margin: '10 0',
        minWidth: 60,
        padding: '7 20 7 10',
        position: {
          horizontal: 160,
          vertical: 'inherit',
        },
        t: 'Go to Docs ',
      },
      {
        fbc: 'transparent',
        fc: backgroundColour,
        fb: true,
        margin: '10 -20',
        padding: '9 0',
        position: {
          vertical: 'inherit',
        },
        fi: { t: icon('fa-up-right-from-square') },
      },
    ],
  };
}

/** Payment card: icon tile, amount, parties and a status pill. */
function makePaymentNode(id, x, y) {
  return {
    type: 'node', id, x, y, c: '#fffdf9', b: '#e6dccd', bw: 2, w: 260, h: 'auto', borderRadius: 14, ff: 'Muli',
    t: [
      { fi: { t: icon('fa-credit-card') }, fs: 22, fc: 'white', fbc: '#6d3b6e', borderRadius: 10, minWidth: 44, minHeight: 44,
        margin: '14 0 0 14', position: { horizontal: 'left', vertical: 'top' } },
      { t: '12,450,000 VND', fs: 20, fb: true, fc: '#2b2d42', fbc: 'transparent', margin: '14 0 0 10', position: { vertical: 'inherit' } },
      { t: 'Lotus Harbour  >  Cat Lai Freight', fs: 12, fc: '#5c6378', fbc: 'transparent', margin: '2 14 0 68', position: { horizontal: 'left' } },
      { t: 'Settled', fs: 12, fb: true, fc: '#3e5641', fbc: '#dfe8d2', borderRadius: 12, padding: '4 10 3 10',
        margin: '10 0 14 14', position: { horizontal: 'left' } },
      { t: '23 Nov, 09:41', fs: 12, fc: '#8d99ae', fbc: 'transparent', margin: '0 14 0 0', position: { vertical: 'inherit', horizontal: 'right' } },
    ],
  };
}

/** Stacked bar: a title, three segments sized by share, and a legend. */
function makeStackedBarNode(id, x, y) {
  const segment = (share, colour, radius) => ({
    t: '', fbc: colour, minWidth: Math.round(220 * share), minHeight: 14, borderRadius: radius, margin: 0, padding: 0,
    position: { vertical: 'inherit' },
  });
  const legend = (text, colour, first) => ({
    t: text, fs: 12, fc: colour, fb: true, fbc: 'transparent', margin: first ? '10 0 14 16' : '10 0 14 12',
    position: first ? { horizontal: 'left' } : { vertical: 'inherit' },
  });
  return {
    type: 'node', id, x, y, c: '#fffdf9', b: '#e6dccd', bw: 2, w: 252, h: 'auto', borderRadius: 14, ff: 'Muli',
    t: [
      { t: 'Stock by warehouse', fs: 14, fb: true, fc: '#2b2d42', fbc: 'transparent', margin: '14 0 10 16', position: { horizontal: 'left', vertical: 'top' } },
      { ...segment(0.52, '#6d3b6e', '7 0 0 7'), margin: '0 0 0 16', position: { horizontal: 'left' } },
      segment(0.31, '#b5446e', 0),
      segment(0.17, '#edae49', '0 7 7 0'),
      legend('52% Binh Duong', '#6d3b6e', true),
      legend('31% Long An', '#b5446e'),
      legend('17%', '#c08a2c'),
    ],
  };
}

/** Avatar: initials in a circle, a notification badge glyph and a name pill. */
function makeAvatarNode(id, x, y) {
  return {
    type: 'node', id, x, y, c: '#b5446e', b: '#fbf5ec', bw: 4, e: 2.2, ff: 'Muli',
    g: [{ p: 45, c: '#c8553d', b: 'white', t: '3', fc: 'white', e: 1.1 }],
    t: [
      { t: 'LN', fs: 26, fb: true, fc: 'white', fbc: 'transparent' },
      { t: 'Linh Nguyen', fs: 13, fb: true, fc: 'white', fbc: '#2b2d42', borderRadius: 12, padding: '5 10 4 10', position: 's' },
    ],
  };
}

/** Sensor tile: icon, a large reading, its unit and where it was taken. */
function makeSensorNode(id, x, y) {
  return {
    type: 'node', id, x, y, c: '#2b2d42', w: 170, h: 'auto', borderRadius: 16, ff: 'Muli',
    t: [
      { fi: { t: icon('fa-temperature-half') }, fs: 26, fc: '#edae49', fbc: 'transparent', margin: '14 0 0 16', position: { horizontal: 'left', vertical: 'top' } },
      { t: 'Cold room 2', fs: 12, fc: '#c9c3d6', fbc: 'transparent', margin: '18 16 0 0', position: { vertical: 'inherit', horizontal: 'right' } },
      { t: '3.6', fs: 40, fb: true, fc: 'white', fbc: 'transparent', margin: '6 0 0 16', position: { horizontal: 'left' } },
      { t: '°C', fs: 18, fc: '#edae49', fbc: 'transparent', margin: '14 0 0 4', position: { vertical: 'inherit' } },
      { t: 'Target 2 to 5 °C', fs: 11, fc: '#a3b18a', fbc: 'transparent', margin: '4 0 14 16', position: { horizontal: 'left' } },
    ],
  };
}

/** Tag pill: a small capsule with an icon and a word. */
function makeTagNode(id, x, y, colour, iconName, text) {
  return {
    type: 'node', id, x, y, c: colour, w: 'auto', h: 34, borderRadius: 17, ff: 'Muli',
    t: [
      { fi: { t: icon(`fa-${iconName}`) }, fs: 14, fc: 'white', fbc: 'transparent', margin: '0 0 0 14' },
      { t: text, fs: 14, fb: true, fc: 'white', fbc: 'transparent', margin: '0 16 0 8', position: { vertical: 'inherit' } },
    ],
  };
}

export const invertedNode = makeInteractiveNode('t2', 450, 100, '#2b2d42', '#fbf5ec');

export const data = {
  type: 'LinkChart',
  items: [
    {
      id: 't1-a',
      type: 'node',
      c: '#e09f3e',
      w: 120,
      h: 170,
      x: -580,
      y: -130,
      bw: 3,
      b: '#5c6378',
      borderRadius: 10,
      t: [
        {
          fi: { t: icon('fa-server') },
          fs: 75,
          fbc: 'transparent',
          fc: 'white',
          position: { vertical: 24 },
        },
        {
          t: 'Rack A',
          fs: 15,
          fbc: 'transparent',
          fc: 'white',
          fb: true,
          margin: '10 0 0 0',
        },
        {
          t: 'High CPU usage',
          fs: 12,
          fbc: 'transparent',
          fc: 'white',
          padding: '0 20',
          margin: '5 0 0 0',
        },
        {
          fs: 0,
          fbc: '#5c6378',
          borderRadius: '0 0 8.5 8.5',
          margin: 0,
          padding: 0,
          minWidth: 123,
          minHeight: 21.5,
          position: {
            horizontal: -1.5,
            vertical: 150,
          },
        },
        {
          fs: 0,
          fbc: '#d1495b',
          margin: 0,
          padding: 0,
          minWidth: 105.6,
          minHeight: 17,
          position: {
            horizontal: 0,
            vertical: 153,
          },
          borderRadius: '0 0 0 7'
        },
      ],
    },
    {
      id: 't1-b',
      type: 'node',
      c: '#e09f3e',
      w: 120,
      h: 170,
      x: -430,
      y: -130,
      bw: 3,
      b: '#5c6378',
      borderRadius: 10,
      t: [
        {
          fi: { t: icon('fa-server') },
          fs: 75,
          fbc: 'transparent',
          fc: 'white',
          position: { vertical: 24 },
        },
        {
          t: 'Rack B',
          fs: 15,
          fbc: 'transparent',
          fc: 'white',
          fb: true,
          margin: '10 0 0 0',
        },
        {
          t: 'OK',
          fs: 12,
          fbc: 'transparent',
          fc: 'white',
          padding: '0 20',
          margin: '5 0 0 0',
        },
        {
          fs: 0,
          fbc: '#5c6378',
          borderRadius: '0 0 8.5 8.5',
          margin: 0,
          padding: 0,
          minWidth: 123,
          minHeight: 21.5,
          position: {
            horizontal: -1.5,
            vertical: 150,
          },
        },
        {
          fs: 0,
          fbc: '#edae49',
          margin: 0,
          padding: 0,
          minWidth: 70,
          minHeight: 17,
          position: {
            horizontal: 0,
            vertical: 153,
          },
          borderRadius: '0 0 0 7'
        },
      ],
    },
    {
      id: 't1-c',
      type: 'node',
      c: '#5f8d6f',
      w: 120,
      h: 170,
      x: -580,
      y: 70,
      bw: 3,
      b: '#5c6378',
      borderRadius: 10,
      t: [
        {
          fi: { t: icon('fa-hdd') },
          fs: 75,
          fbc: 'transparent',
          fc: 'white',
          position: { vertical: 24 },
        },
        {
          t: 'Blade C',
          fs: 15,
          fbc: 'transparent',
          fc: 'white',
          fb: true,
          margin: '10 0 0 0',
        },
        {
          t: 'OK',
          fs: 12,
          fbc: 'transparent',
          fc: 'white',
          padding: '0 20',
          margin: '5 0 0 0',
        },
        {
          fs: 0,
          fbc: '#5c6378',
          borderRadius: '0 0 8.5 8.5',
          margin: 0,
          padding: 0,
          minWidth: 123,
          minHeight: 21.5,
          position: {
            horizontal: -1.5,
            vertical: 150,
          },
        },
        {
          fs: 0,
          fbc: '#6a994e',
          margin: 0,
          padding: 0,
          minWidth: 20,
          minHeight: 17,
          position: {
            horizontal: 0,
            vertical: 153,
          },
          borderRadius: '0 0 0 7'
        },
      ],
    },
    {
      id: 't1-d',
      type: 'node',
      c: '#5f8d6f',
      w: 120,
      h: 170,
      x: -430,
      y: 70,
      bw: 3,
      b: '#5c6378',
      borderRadius: 10,
      t: [
        {
          fi: { t: icon('fa-hdd') },
          fs: 75,
          fbc: 'transparent',
          fc: 'white',
          position: { vertical: 24 },
        },
        {
          t: 'Blade D',
          fs: 15,
          fbc: 'transparent',
          fc: 'white',
          fb: true,
          margin: '10 0 0 0',
        },
        {
          t: 'OK',
          fs: 12,
          fbc: 'transparent',
          fc: 'white',
          padding: '0 20',
          margin: '5 0 0 0',
        },
        {
          fs: 0,
          fbc: '#5c6378',
          borderRadius: '0 0 8.5 8.5',
          margin: 0,
          padding: 0,
          minWidth: 123,
          minHeight: 21.5,
          position: {
            horizontal: -1.5,
            vertical: 150,
          },
        },
        {
          fs: 0,
          fbc: '#6a994e',
          margin: 0,
          padding: 0,
          minWidth: 55,
          minHeight: 17,
          position: {
            horizontal: 0,
            vertical: 153,
          },
          borderRadius: '0 0 0 7'
        },
      ],
    },
    makeInteractiveNode('t2', 450, 100, '#fbf5ec', '#2b2d42'),
    {
      id: 'j1-rectangle',
      type: 'node',
      c: '#b5446e',
      ff: 'Raleway',
      w: 'auto',
      h: 'auto',
      x: -150,
      y: -450,
      minHeight: 80,
      t: [
        {
          fi: { t: icon('fa-shuffle') },
          fs: 50,
          fc: '#b5446e',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 0 0 10',
          padding: { left: 10 },
        },
        {
          t: 'Generate Data',
          fs: 24,
          fb: true,
          fc: 'white',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 10 0 -1',
          padding: { left: 11, right: 10 },
          position: { vertical: 'inherit' },
        },
        {
          t: 'Unavailable',
          fs: 16,
          fc: 'white',
          fbc: '#2b2d42',
          borderRadius: 20,
          margin: { bottom: -20, left: -60 },
          padding: 8,
          position: 'ne',
        },
      ],
    },
    {
      id: 'j2-rectangle',
      type: 'node',
      c: '#a3b18a',
      ff: 'Raleway',
      w: 'auto',
      h: 'auto',
      x: -150,
      y: -300,
      minHeight: 80,
      t: [
        {
          fi: { t: icon('fa-database') },
          fs: 50,
          fc: '#a3b18a',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 0 0 10',
          padding: { left: 10 },
        },
        {
          t: 'Open Database',
          fs: 24,
          fb: true,
          fc: 'white',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 10 0 -1',
          padding: { left: 11, right: 10 },
          position: { vertical: 'inherit' },
        },
        {
          t: 'Unavailable',
          fs: 16,
          fc: 'white',
          fbc: '#2b2d42',
          borderRadius: 20,
          margin: { bottom: -20, left: -60 },
          padding: 8,
          position: 'ne',
        },
      ],
    },
    {
      id: 'j3-rectangle',
      type: 'node',
      c: '#f2cc8f',
      ff: 'Raleway',
      w: 'auto',
      h: 'auto',
      x: -150,
      y: -150,
      minHeight: 80,
      t: [
        {
          fi: { t: icon('fa-bug') },
          fs: 50,
          fc: '#f2cc8f',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 0 0 10',
          padding: { left: 10 },
        },
        {
          t: 'Debug Console',
          fs: 24,
          fb: true,
          fc: 'white',
          fbc: '#2b2d42',
          minHeight: 60,
          margin: '0 10 0 -1',
          padding: { left: 11, right: 10 },
          position: { vertical: 'inherit' },
        },
      ],
    },
    makeShadowCircleNode('j4-circle', 247, -122, '#fff7e6', '\u{e545}', 'Bloom'),
    makeShadowCircleNode('j5-circle', 120, -144, '#fbf5ec', '\u{efd8}', 'Blow'),
    makeShadowCircleNode('j6-circle', 203, -244, '#b23a48', '\u{ef55}', 'Burn'),
    makeProfileCardNode('j7-profile-card', -500, -400),
    {
      id: 'c1-circle',
      type: 'node',
      sh: 'circle',
      c: 'rgba(0,0,0,0)',
      e: 2.5,
      x: -220,
      y: 100,
      t: [
        makeMaterialIconLabel('\uEF4A', 75, '#3e5641'),
        makeMaterialIconLabel('\uEF4A', 70, '#FFF'),
        makeMaterialIconLabel('\uEF4A', 65, '#3e5641'),
        makeMaterialIconLabel('\uEF4A', 60, '#FFF'),
        makeMaterialIconLabel('\uEF4A', 55, '#3e5641'),
        makeMaterialIconLabel('\uE1B8', 35, '#FFF'),
      ],
    },
    {
      id: 'c1-hexagon',
      type: 'node',
      sh: 'box',
      c: 'rgba(0,0,0,0)',
      e: 2.5,
      x: -30,
      y: 100,
      t: [
        makeMaterialIconLabel('\uEB39', 75, '#4a234b'),
        makeMaterialIconLabel('\uEB39', 70, '#FFF'),
        makeMaterialIconLabel('\uEB39', 65, '#4a234b'),
        makeMaterialIconLabel('\uEB39', 60, '#FFF'),
        makeMaterialIconLabel('\uEB39', 55, '#4a234b'),
        makeMaterialIconLabel('\uEA1C', 35, '#FFF'),
      ],
    },
    {
      id: 'c1-square',
      type: 'node',
      sh: 'box',
      c: 'rgba(0,0,0,0)',
      e: 2.5,
      x: 160,
      y: 100,
      t: [
        makeMaterialIconLabel('\uEB36', 75, '#7a2e1d'),
        makeMaterialIconLabel('\uEB36', 70, '#FFF'),
        makeMaterialIconLabel('\uEB36', 65, '#7a2e1d'),
        makeMaterialIconLabel('\uEB36', 60, '#FFF'),
        makeMaterialIconLabel('\uEB36', 55, '#7a2e1d'),
        makeMaterialIconLabel('\uE1BD', 35, '#FFF'),
      ],
    },
    makeBusinessProcessNode('c1', 350, -450),
    {
      id: 'c3-online',
      type: 'node',
      borderRadius: '5 20 20 5',
      c: '#2b2d42',
      ff: 'Raleway',
      g: [
        {
          p: 270,
          r: 67,
          e: 3,
          c: 'white',
          fi: { t: icon('fa-user'), c: '#2b2d42' },
        },
      ],
      t: [
        {
          t: 'Alex Morgan',
          fb: true,
          fc: '#FFF',
          fbc: 'transparent',
          position: {
            horizontal: 63,
            vertical: 19,
          },
        },
        {
          fi: {
            t: icon('fa-circle'),
          },
          fs: 15,
          fc: '#6a994e',
          fbc: 'transparent',
          position: { horizontal: 63 },
        },
        {
          t: 'Online',
          fc: '#FFF',
          fbc: 'transparent',
          position: { vertical: 'inherit' },
        },
      ],
      h: 70,
      w: 200,
      x: 480,
      y: -230,
    },
    {
      id: 'c3-offline',
      type: 'node',
      borderRadius: '5 20 20 5',
      c: '#8d99ae',
      ff: 'Raleway',
      g: [
        {
          p: 270,
          r: 67,
          e: 3,
          c: 'white',
          fi: { t: icon('fa-user'), c: '#2b2d42' },
        },
      ],
      t: [
        {
          t: 'Sam Taylor',
          fb: true,
          fc: '#FFF',
          fbc: 'transparent',
          position: {
            horizontal: 63,
            vertical: 19,
          },
        },
        {
          fi: {
            t: icon('fa-circle'),
          },
          fs: 15,
          fc: '#d1495b',
          fbc: 'transparent',
          position: { horizontal: 63 },
        },
        {
          t: 'Offline',
          fc: '#FFF',
          fbc: 'transparent',
          position: { vertical: 'inherit' },
        },
      ],
      h: 70,
      w: 200,
      x: 480,
      y: -110,
    },

    // ---------- second row: more node styles ----------
    makePaymentNode('n1-payment', -500, 330),
    makeStackedBarNode('n2-stacked', -190, 330),
    makeAvatarNode('n3-avatar', 60, 320),
    makeSensorNode('n4-sensor', 260, 330),
    makeTagNode('n5-tag-priority', 500, 270, '#c8553d', 'flag', 'Priority'),
    makeTagNode('n5-tag-verified', 500, 330, '#5f8d6f', 'circle-check', 'Verified'),
    makeTagNode('n5-tag-watch', 500, 390, '#e09f3e', 'eye', 'Watchlist'),
  ],
};
