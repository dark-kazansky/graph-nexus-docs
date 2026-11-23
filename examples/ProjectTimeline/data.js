// A three-week website relaunch for a fictional team of six. Tasks are time ranges
// on one person's row; hand-offs are moments that join two people's rows.

const day = (d, h = 9) => new Date(2026, 5, 1 + d, h, 0); // 1 Jun 2026 is a Monday

export const teams = {
  design: { label: 'Design', colour: '#ec1c24' },
  eng: { label: 'Engineering', colour: '#f26f21' },
  qa: { label: 'Quality', colour: '#0e7490' },
};

export const people = {
  linh: { label: 'Linh (lead designer)', type: 'design' },
  minh: { label: 'Minh (illustrator)', type: 'design' },
  an: { label: 'An (front end)', type: 'eng' },
  bao: { label: 'Bao (back end)', type: 'eng' },
  chi: { label: 'Chi (tester)', type: 'qa' },
  dung: { label: 'Dung (release)', type: 'qa' },
};

// [id, person, start day, end day, title]
const tasks = [
  ['t1', 'linh', 0, 4, 'Wireframes'],
  ['t2', 'minh', 1, 6, 'Illustrations'],
  ['t3', 'linh', 5, 9, 'Visual design'],
  ['t4', 'bao', 0, 7, 'Content API'],
  ['t5', 'an', 7, 14, 'Page build'],
  ['t6', 'bao', 8, 13, 'Search and checkout'],
  ['t7', 'chi', 12, 17, 'Test pass'],
  ['t8', 'an', 15, 17, 'Bug fixes'],
  ['t9', 'dung', 16, 19, 'Release prep'],
];

// [id, from, to, day, hour, title]
// Hand-offs sit at least six hours from any task start on the same row: the timeline
// summarises events that start within 8 px of each other, which would hide the task.
const handoffs = [
  ['h1', 'linh', 'minh', 1, 16, 'Brief for illustrations'],
  ['h2', 'linh', 'an', 7, 16, 'Design hand-off'],
  ['h3', 'minh', 'an', 6, 15, 'Artwork delivered'],
  ['h4', 'bao', 'an', 8, 17, 'API ready'],
  ['h5', 'an', 'chi', 12, 16, 'Build ready for test'],
  ['h6', 'chi', 'an', 14, 16, '12 bugs reported'],
  ['h7', 'chi', 'dung', 17, 16, 'Test sign-off'],
];

export const timelineData = {
  entityTypes: Object.fromEntries(Object.entries(teams).map(([id, t], i) => [id, { color: t.colour, typeLabel: t.label, labelColor: '#1f1a17', order: i }])),
  entities: people,
  eventTypes: {
    task: { lineWidth: 10, color: 'entity', showArrows: false },
    handoff: { lineWidth: 2.5, color: 'from', showArrows: true },
  },
  events: Object.fromEntries([
    ...tasks.map(([id, who, s, e, title]) => [id, { entityIds: [who], time: { start: day(s), end: day(e, 18) }, type: 'task', data: { title } }]),
    ...handoffs.map(([id, from, to, d, h, title]) => [id, { entityIds: { from, to }, time: day(d, h), type: 'handoff', data: { title } }]),
  ]),
};

export const markers = [
  { label: 'Kick-off', time: day(0, 9), color: '#9d0b0f', labelColor: '#9d0b0f' },
  { label: 'Design freeze', time: day(7, 9), color: '#ec1c24', labelColor: '#c7141a' },
  { label: 'Launch', time: day(19, 17), color: '#0e7490', labelColor: '#0e7490' },
];
