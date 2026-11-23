/**
 * Small dataset for the Centrality demo: one quarter of bank transfers between
 * the accounts of a fictional bank's customers in Ho Chi Minh City.
 *
 * Accounts are people and businesses. Employers pay salaries, employees pay
 * merchants and each other, businesses trade with suppliers, and every merchant
 * settles card takings with the bank's clearing account. Each centrality measure
 * finds something different: busy employers (degree), the clearing account
 * (closeness, betweenness), and merchants paid by many (PageRank).
 *
 * Link d.count is the number of transfers in the quarter, d.amount the total in VND.
 * Generated from a fixed seed, so every load builds the same graph.
 * Link ids contain "-" and node ids never do (centrality.js relies on that).
 */

export const colours = {
  node: '#ffa726',
  link: '#c5d2e6',
  bands: ['#f57c00', '#ef5350', '#e91e63'],
  hover: '#9db3d6',
  selected: '#2b5594',
};

/** Small seeded PRNG (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMPLOYERS = ['Lotus Harbour Trading', 'Mekong Textiles', 'Red River Logistics', 'Saigon Software House'];
const MERCHANTS = ['Ben Thanh Grocers', 'Pho Hoa Kitchen', 'Phuc Long Coffee', 'An Khang Health',
  'Hung Phat Fuel', 'Nha Be Market', 'Thao Dien Bakery', 'Tan Dinh Books', 'Cholon Phones', 'Lotte Mart D7'];
const SUPPLIERS = ['Dong Nai Cartons', 'Binh Duong Cotton', 'Cat Lai Freight', 'Vung Tau Shipping',
  'Thu Duc Office Supply', 'Long An Print Works', 'Cloud Hosting Asia', 'Tay Ninh Rubber'];
const CLEARING = 'Card Clearing Hub';

const FIRST = ['Linh', 'Minh', 'An', 'Thao', 'Khoa', 'Mai', 'Duc', 'Hoa', 'Tuan', 'Ngoc', 'Quang', 'Yen',
  'Bao', 'Trang', 'Hieu', 'Lan', 'Phong', 'Vy', 'Long', 'Chi', 'Nam', 'Huong', 'Thanh', 'Kim',
  'Sofia', 'Daniel', 'Priya', 'Kenji', 'Amara', 'Lucas', 'Hana', 'Omar', 'Elena', 'Marcus'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong',
  'Ly', 'Trinh', 'Mai', 'Lam', 'Truong', 'Phan', 'Castillo', 'Okafor', 'Sato', 'Iyer', 'Novak',
  'Haddad', 'Moreau', 'Tanaka', 'Mensah', 'Chen', 'Park'];

function buildSmallData(seed = 11) {
  const random = seeded(seed);
  const pick = (n) => Math.floor(random() * n);
  const between = (lo, hi) => lo + Math.round(random() ** 1.6 * (hi - lo));

  const items = [];
  const usedNames = new Set();
  let next = 0;
  const account = (name, kind) => {
    const id = `a${next++}`;
    items.push({ type: 'node', id, t: name, d: { kind } });
    return id;
  };
  const person = () => {
    for (;;) {
      const n = `${FIRST[pick(FIRST.length)]} ${LAST[pick(LAST.length)]}`;
      if (!usedNames.has(n)) { usedNames.add(n); return account(n, 'Personal'); }
    }
  };

  const seen = new Set();
  // count = transfers in the quarter; average = typical transfer in VND.
  const transfer = (from, to, count, average) => {
    if (from === to || seen.has(`${from}-${to}`)) return;
    seen.add(`${from}-${to}`);
    items.push({
      type: 'link', id: `${from}-${to}`, id1: from, id2: to, a2: true,
      d: { count, amount: Math.round(count * average * (0.6 + random() * 0.8) / 1000) * 1000 },
    });
  };

  const clearing = account(CLEARING, 'Bank');
  const merchants = MERCHANTS.map((n) => account(n, 'Merchant'));
  const suppliers = SUPPLIERS.map((n) => account(n, 'Business'));
  const employers = EMPLOYERS.map((n) => account(n, 'Business'));
  const staff = employers.map(() => Array.from({ length: 22 + pick(6) }, person));
  const independents = Array.from({ length: 14 }, person);
  const everyone = staff.flat().concat(independents);

  // Salaries: three a quarter, plus the odd bonus or expense refund.
  employers.forEach((boss, e) => staff[e].forEach((p) => transfer(boss, p, between(3, 7), 18e6)));

  // Day to day spending: each person pays two or three merchants, from a coffee a week to daily lunches.
  everyone.forEach((p) => {
    const n = 2 + pick(2);
    for (let k = 0; k < n; k++) transfer(p, merchants[pick(merchants.length)], between(4, 90), 120e3);
  });

  // Merchants settle card takings with the clearing account: the heaviest flows in the network.
  merchants.forEach((m) => transfer(m, clearing, between(180, 360), 9e6));

  // Businesses trade: each employer pays three suppliers, some suppliers pay each other.
  employers.forEach((boss) => {
    for (let k = 0; k < 3; k++) transfer(boss, suppliers[pick(suppliers.length)], between(20, 160), 45e6);
  });
  suppliers.forEach((s) => { if (random() < 0.5) transfer(s, suppliers[pick(suppliers.length)], between(10, 60), 30e6); });
  // Merchants restock from suppliers.
  merchants.forEach((m) => transfer(m, suppliers[pick(suppliers.length)], between(8, 40), 25e6));

  // People send money to family, friends and landlords, mostly within their own workplace.
  staff.forEach((team) => team.forEach((p) => {
    if (random() < 0.5) transfer(p, team[pick(team.length)], between(1, 24), 2.5e6);
  }));
  // A few people move money across workplaces and to independents.
  for (let k = 0; k < 18; k++) transfer(everyone[pick(everyone.length)], everyone[pick(everyone.length)], between(1, 30), 3e6);
  // Independents pay rent or school fees to a business now and then.
  independents.forEach((p) => transfer(p, suppliers[pick(suppliers.length)], between(1, 6), 8e6));

  return { type: 'LinkChart', items };
}

export const data = buildSmallData();

// Styling props, same as the large dataset.
data.items.forEach((item) => {
  if (item.type === 'node') {
    // One word per line: 'auto' sizes the font to the widest line, so long business names stay legible.
    item.t = { t: item.t.replace(/ /g, '\n'), fs: 'auto', textWrap: 'normal' };
    item.fbc = 'rgba(0,0,0,0)';
    item.fc = 'white';
    item.c = colours.node;
    item.b = colours.node;
  } else {
    item.c = colours.link;
    item.w = 4;
  }
});

export const nodeCount = data.items.filter((item) => item.type === 'node').length;
