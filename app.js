// uBiF Web Extensions — Usage Stats page.
// Reads the "events" collection of the uBiF Web Extensions Analytics Firebase project (written by
// the extension, 1.4.4+) and adds it up: time saved, per store, per day, Autocomplete problems,
// the Verizon free accessory reminder and how many installs use it. Only accounts allowed by the
// Firestore rules (firestore.rules) can read anything; everyone else sees "No access".
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc, setDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBQA7JVSGobgWrb2TkltcqxJ-gXP196VJg',
  authDomain: 'ubif-web-extensions-analytics.firebaseapp.com',
  projectId: 'ubif-web-extensions-analytics',
  storageBucket: 'ubif-web-extensions-analytics.firebasestorage.app',
  messagingSenderId: '711416442178',
  appId: '1:711416442178:web:b63764332487cc1aafecdb',
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const TZ = 'America/Chicago';
const DAY_MS = 864e5;
const PAGE = 5000;
const LATE_MS = 3 * DAY_MS; // records can sit in a browser's queue (offline) before they arrive

// ---------- Actions that save time (seconds each are editable and saved in config/settings) ----------
const ACTIONS = [
  { key: 'autoService.completed.perf', label: 'Autocomplete: Performance Check / Diagnostic reached Checkout', match: (e) => e.tool === 'autoService' && e.event === 'completed' && (!e.service || e.service === 'perf') },
  { key: 'autoService.completed.clean', label: 'Autocomplete: Cleaning / Sanitization reached Checkout', match: (e) => e.tool === 'autoService' && e.event === 'completed' && e.service === 'clean' },
  { key: 'autoService.completed.refresh', label: 'Autocomplete: Device Refresh reached Checkout', match: (e) => e.tool === 'autoService' && e.event === 'completed' && e.service === 'refresh' },
  { key: 'autoService.completed.techcare', label: 'Autocomplete: Tech Care reached Checkout', match: (e) => e.tool === 'autoService' && e.event === 'completed' && e.service === 'techcare' },
  { key: 'autoConfirm.confirmed', label: 'Auto-Confirm Serial: serial confirmed', def: 2, match: (e) => e.tool === 'autoConfirm' && e.event === 'confirmed' },
  { key: 'imeiAutofill.filled', label: 'IMEI Autofill: IMEI filled', match: (e) => e.tool === 'imeiAutofill' && e.event === 'filled' },
  { key: 'gdException.gspn_created', label: 'GD Exception: GSPN ticket created', match: (e) => e.tool === 'gdException' && e.event === 'gspn_created' },
  { key: 'gdException.form_filled', label: 'GD Exception: exception form filled in', match: (e) => e.tool === 'gdException' && e.event === 'form_filled' },
  { key: 'pullbacks.marked', label: 'Pullbacks 2026: part marked for RMA (each part)', def: 30, units: (e) => e.parts || 0, match: (e) => e.tool === 'pullbacks' && e.event === 'marked' },
  { key: 'stockSearch.added', label: 'In-Stock Search: item added from the In stock box (counted until 1.6.0)', match: (e) => e.tool === 'stockSearch' && e.event === 'added' },
  { key: 'autoOpenWo.opened', label: 'Auto-Open Work Order: work order opened (counted until 1.6.0)', match: (e) => e.tool === 'autoOpenWo' && e.event === 'opened' },
];
const actionOf = (e) => ACTIONS.find((a) => a.match(e));
// How many times one record counts: 1, or for Pullbacks the number of parts marked in that run.
const unitsOf = (a, e) => (a.units ? a.units(e) : 1);
const unitsIn = (list, a) => list.filter(a.match).reduce((s, e) => s + unitsOf(a, e), 0);

const is = {
  completed: (e) => e.tool === 'autoService' && e.event === 'completed',
  error: (e) => e.tool === 'autoService' && e.event === 'error',
  stopped: (e) => e.tool === 'autoService' && e.event === 'stopped',
  vz: (e) => e.tool === 'autoService' && e.event === 'verizon_reminder',
  confirm: (e) => e.tool === 'autoConfirm' && e.event === 'confirmed',
  imei: (e) => e.tool === 'imeiAutofill' && e.event === 'filled',
  gdFiled: (e) => e.tool === 'gdException' && e.event === 'submitted',
  gdFilled: (e) => e.tool === 'gdException' && e.event === 'form_filled',
  gspn: (e) => e.tool === 'gdException' && e.event === 'gspn_created',
  stock: (e) => e.tool === 'stockSearch' && e.event === 'added',
  open: (e) => e.tool === 'autoOpenWo' && e.event === 'opened',
  pb: (e) => e.tool === 'pullbacks' && e.event === 'marked',
};
const pbParts = (list) => list.filter(is.pb).reduce((s, e) => s + (e.parts || 0), 0);

// ---------- State ----------
let seconds = {};        // action key -> seconds saved each
let allEvents = [];      // everything loaded for the date range
let loadedRange = null;

// ---------- Central-time helpers ----------
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ymd = (ms) => ymdFmt.format(new Date(ms));
function centralParts(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return p;
}
const fmtCentral = (ms) => { const p = centralParts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
// UTC milliseconds of midnight Central on a "YYYY-MM-DD" day (handles CST/CDT).
function centralStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 6);
  for (let i = 0; i < 2; i++) {
    const p = centralParts(guess);
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += Date.UTC(y, m - 1, d) - wall;
  }
  return guess;
}
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
function daysBetween(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

function rangeDays() {
  const today = ymd(Date.now());
  const v = $('range').value;
  if (v === 'today') return [today, today];
  if (v === 'yesterday') { const y = addDays(today, -1); return [y, y]; }
  if (v === '7') return [addDays(today, -6), today];
  if (v === '30') return [addDays(today, -29), today];
  if (v === 'thisMonth') return [today.slice(0, 8) + '01', today];
  if (v === 'lastMonth') {
    const firstThis = today.slice(0, 8) + '01';
    const lastPrev = addDays(firstThis, -1);
    return [lastPrev.slice(0, 8) + '01', lastPrev];
  }
  const f = $('from').value || today;
  const t = $('to').value || today;
  return f <= t ? [f, t] : [t, f];
}

// ---------- Formatting ----------
const num = (n) => (n || 0).toLocaleString('en-US');
const money = (n) => '$' + (n || 0).toLocaleString('en-US');
function dur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec + ' s';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} m` : `${m} m`;
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}
function table(id, head, rows, totalRow, numericFrom = 1) {
  const t = $(id);
  t.replaceChildren();
  if (!rows.length) { t.append(el('tr', {}, el('td', { class: 'empty', text: 'Nothing in this date range.' }))); return; }
  const tr = el('tr');
  head.forEach((h, i) => tr.append(el('th', { class: i >= numericFrom ? 'num' : '', text: h })));
  t.append(el('thead', {}, tr));
  const tb = el('tbody');
  const addRow = (r, cls) => {
    const row = el('tr', cls ? { class: cls } : {});
    r.forEach((c, i) => row.append(el('td', { class: i >= numericFrom ? 'num' : '', text: String(c) })));
    tb.append(row);
  };
  rows.forEach((r) => addRow(r));
  if (totalRow) addRow(totalRow, 'total');
  t.append(tb);
}

// ---------- Loading ----------
async function loadEvents() {
  const [from, to] = rangeDays();
  const start = centralStart(from);
  const end = centralStart(addDays(to, 1));
  $('load').disabled = true;
  $('status').textContent = 'Loading…';
  const out = [];
  try {
    const cons = [where('received', '>=', Timestamp.fromMillis(start))];
    if (end + LATE_MS < Date.now()) cons.push(where('received', '<', Timestamp.fromMillis(end + LATE_MS)));
    let last = null;
    for (;;) {
      const q = last
        ? query(collection(db, 'events'), ...cons, orderBy('received'), startAfter(last), limit(PAGE))
        : query(collection(db, 'events'), ...cons, orderBy('received'), limit(PAGE));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const e = d.data();
        const rec = e.received ? e.received.toMillis() : Date.now();
        const t = rec - (e.ago || 0); // when it happened, by Firebase's clock
        if (t < start || t >= end) continue;
        out.push(Object.assign({ id: d.id, t, day: ymd(t) }, e));
      }
      $('status').textContent = `Loading… ${num(out.length)} records`;
      if (snap.docs.length < PAGE) break;
      last = snap.docs[snap.docs.length - 1];
    }
    allEvents = out;
    loadedRange = { from, to };
    fillStores();
    render();
    $('status').textContent = `${num(out.length)} records, ${from === to ? from : from + ' to ' + to}`;
  } catch (err) {
    console.error(err);
    $('status').textContent = 'Could not load: ' + (err.message || err);
  } finally {
    $('load').disabled = false;
  }
}

function fillStores() {
  const sel = $('store');
  const keep = sel.value;
  const stores = [...new Set(allEvents.map((e) => e.store).filter(Boolean))].sort((a, b) => (+a || 0) - (+b || 0) || a.localeCompare(b));
  sel.replaceChildren(el('option', { value: '', text: 'All stores' }), ...stores.map((s) => el('option', { value: s, text: 'Store ' + s })));
  if (stores.includes(keep)) sel.value = keep;
}

function filtered() {
  const store = $('store').value;
  const test = $('includeTest').checked;
  return allEvents.filter((e) => (test || !e.test) && (!store || e.store === store));
}

const secsFor = (key) => {
  const a = ACTIONS.find((x) => x.key === key);
  return seconds[key] !== undefined ? seconds[key] : (a && a.def) || 0;
};
// "270", "270s", "4.5m", "1.5h", "1m 30s", "1h 2m 3s" -> seconds (decimals allowed). null if it can't be read.
function parseTime(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let total = 0, rest = t, any = false;
  const re = /^(\d+(?:\.\d+)?)(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)/;
  while (rest) {
    const m = rest.match(re);
    if (!m) return null;
    total += Number(m[1]) * (m[2][0] === 'h' ? 3600 : m[2][0] === 'm' ? 60 : 1);
    rest = rest.slice(m[0].length);
    any = true;
  }
  return any ? total : null;
}
// seconds -> "4.5m", "30s", "1.5h" for the input box.
function fmtTime(sec) {
  sec = Number(sec) || 0;
  const r = (x) => String(Math.round(x * 100) / 100);
  if (sec >= 3600 && sec % 360 === 0) return r(sec / 3600) + 'h';
  if (sec >= 60 && (sec % 60 === 0 || sec % 6 === 0)) return r(sec / 60) + 'm';
  return r(sec) + 's';
}
function readTimeInput(input) {
  const v = parseTime(input.value);
  input.classList.toggle('bad', v === null);
  return v === null ? null : Math.max(0, v);
}

const savedBy = (list) => list.reduce((s, e) => { const a = actionOf(e); return s + (a ? secsFor(a.key) * unitsOf(a, e) : 0); }, 0);
const vzMoney = (list) => list.filter(is.vz).reduce((s, e) => s + (e.amount || 0), 0);
const distinct = (list, k) => new Set(list.map((e) => e[k]).filter(Boolean)).size;

// ---------- Rendering ----------
function render() {
  if (!loadedRange) return;
  const ev = filtered();
  const days = daysBetween(loadedRange.from, loadedRange.to);
  const total = savedBy(ev);
  const count = (f) => ev.filter(f).length;

  // Summary cards
  const cards = [
    { big: true, label: 'Time saved', value: dur(total), note: `about ${dur(total / days.length)} per day` },
    { label: 'Autocomplete runs to Checkout', value: num(count(is.completed)), note: `${num(count(is.error))} errors · ${num(count(is.stopped))} other stops` },
    { label: 'Verizon reimbursement flagged', value: money(vzMoney(ev)), note: `${num(ev.filter((e) => is.vz(e) && !e.repeat).length)} sales reminded` },
    { label: 'GD exceptions filed', value: num(count(is.gdFiled)), note: `${num(count(is.gdFilled))} forms filled · ${num(count(is.gspn))} GSPN tickets` },
    { label: 'Serials auto-confirmed', value: num(count(is.confirm)) },
    { label: 'IMEI autofills', value: num(count(is.imei)) },
    { label: 'Pullback parts marked for RMA', value: num(pbParts(ev)), note: `${num(distinct(ev.filter(is.pb), 'store'))} stores · ${num(count(is.pb))} runs` + (ev.some((e) => is.pb(e) && e.partsFailed) ? ` · ${num(ev.filter(is.pb).reduce((s, e) => s + (e.partsFailed || 0), 0))} failed` : '') },
    { label: 'Installs active', value: num(distinct(ev, 'install')), note: `${num(distinct(ev, 'account'))} accounts · ${num(distinct(ev, 'store'))} stores` },
  ];
  $('summary').replaceChildren(...cards.map((c) => el('div', { class: 'stat' + (c.big ? ' big' : '') },
    el('div', { class: 'label', text: c.label }), el('div', { class: 'value', text: c.value }), ...(c.note ? [el('div', { class: 'note', text: c.note })] : []))));

  // Chart: time saved per day
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const e of ev) { const a = actionOf(e); if (a && e.day in perDay) perDay[e.day] += secsFor(a.key) * unitsOf(a, e); }
  drawChart(days, days.map((d) => perDay[d]));

  // Time saved by action (editable seconds)
  const tt = $('timeTable');
  tt.replaceChildren();
  tt.append(el('thead', {}, el('tr', {}, el('th', { text: 'Action' }), el('th', { class: 'num', text: 'Count' }), el('th', { class: 'num', text: 'Time saved each' }), el('th', { class: 'num', text: 'Time saved' }))));
  const tb = el('tbody');
  for (const a of ACTIONS) {
    const n = unitsIn(ev, a);
    const input = el('input', { type: 'text', inputmode: 'decimal', class: 'secs', 'data-key': a.key, placeholder: '0s', title: 'Seconds, minutes or hours: 45s, 4.5m, 1h, or 1m 30s' });
    input.value = fmtTime(secsFor(a.key));
    input.addEventListener('change', () => {
      const v = readTimeInput(input);
      if (v === null) { $('secondsStatus').textContent = 'Can\'t read "' + input.value + '". Use 45s, 4.5m or 1h.'; return; }
      seconds[a.key] = v; render(); $('secondsStatus').textContent = 'Not saved yet';
    });
    tb.append(el('tr', {}, el('td', { text: a.label }), el('td', { class: 'num', text: num(n) }), el('td', { class: 'num' }, input), el('td', { class: 'num', text: dur(n * secsFor(a.key)) })));
  }
  tb.append(el('tr', { class: 'total' }, el('td', { text: 'Total' }), el('td', { class: 'num', text: num(ACTIONS.reduce((s, a) => s + unitsIn(ev, a), 0)) }), el('td'), el('td', { class: 'num', text: dur(total) })));
  tt.append(tb);

  // By store
  const byStore = new Map();
  for (const e of ev) { const k = e.store || '(unknown)'; if (!byStore.has(k)) byStore.set(k, []); byStore.get(k).push(e); }
  const storeRow = (k, l) => [k, num(distinct(l, 'install')), dur(savedBy(l)), num(l.filter(is.completed).length), num(l.filter(is.error).length), num(l.filter(is.confirm).length), num(l.filter(is.imei).length), num(l.filter(is.gdFiled).length), num(pbParts(l)), money(vzMoney(l))];
  const storeKeys = [...byStore.keys()].sort((a, b) => savedBy(byStore.get(b)) - savedBy(byStore.get(a)));
  table('storeTable', ['Store', 'Installs', 'Time saved', 'Autocomplete', 'Errors', 'Auto-confirms', 'IMEI', 'GD filed', 'Pullback parts', 'Verizon $'],
    storeKeys.map((k) => storeRow(k, byStore.get(k))), storeKeys.length > 1 ? storeRow('All', ev) : null);

  // By day
  const dayRow = (d, l) => [d, dur(savedBy(l)), num(l.filter(is.completed).length), num(l.filter(is.error).length), num(l.filter(is.confirm).length), num(l.filter(is.imei).length), num(l.filter(is.gdFiled).length), num(pbParts(l)), money(vzMoney(l)), num(distinct(l, 'install'))];
  const byDay = (d) => ev.filter((e) => e.day === d);
  table('dayTable', ['Day', 'Time saved', 'Autocomplete', 'Errors', 'Auto-confirms', 'IMEI', 'GD filed', 'Pullback parts', 'Verizon $', 'Installs active'],
    days.slice().reverse().map((d) => dayRow(d, byDay(d))), days.length > 1 ? dayRow('All', ev) : null);

  // Autocomplete problems and stops, by code
  const byCode = (list) => {
    const m = new Map();
    for (const e of list) {
      const k = e.code || 'UNKNOWN';
      const r = m.get(k) || { n: 0, last: 0, steps: {} };
      r.n++; r.last = Math.max(r.last, e.t); if (e.step) r.steps[e.step] = (r.steps[e.step] || 0) + 1;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, r]) => {
      const step = Object.entries(r.steps).sort((a, b) => b[1] - a[1])[0];
      return [k, num(r.n), step ? step[0] : '', fmtCentral(r.last)];
    });
  };
  table('errorTable', ['Code', 'Count', 'Usual step', 'Last seen'], byCode(ev.filter(is.error)), null, 1);
  table('stopTable', ['Code', 'Count', 'Usual step', 'Last seen'], byCode(ev.filter(is.stopped)), null, 1);

  // Verizon reminder
  const vz = ev.filter(is.vz);
  const first = vz.filter((e) => !e.repeat);
  table('vzTable', ['', 'Count'], vz.length ? [
    ['Times the "Are you sure?" box showed', num(vz.length)],
    ['Sales reminded (first time per cart)', num(first.length)],
    ['  Offer missing', num(first.filter((e) => e.missing === 'offer').length)],
    ['  Accessory missing', num(first.filter((e) => e.missing === 'accessory').length)],
    ['  Both missing', num(first.filter((e) => e.missing === 'both').length)],
    ['Pressed "Go back"', num(vz.filter((e) => e.choice === 'go_back').length)],
    ['Pressed "Complete anyway"', num(vz.filter((e) => e.choice === 'complete_anyway').length)],
    ['Potential reimbursement ($15 per sale reminded)', money(vzMoney(ev))],
  ] : []);

  // Users
  const installs = new Map();
  for (const e of ev) if (e.install) installs.set(e.install, e);
  const latest = [...installs.values()];
  const versions = {};
  for (const e of latest) versions[e.version] = (versions[e.version] || 0) + 1;
  const daily = days.map((d) => distinct(byDay(d), 'install'));
  table('userTable', ['', 'Count'], latest.length ? [
    ['Installs (browser profiles)', num(latest.length)],
    ['Chrome/Firefox accounts', num(distinct(ev, 'account'))],
    ['Stores', num(distinct(ev, 'store'))],
    ['Average installs active per day', (daily.reduce((a, b) => a + b, 0) / days.length).toFixed(1)],
    ['On Chrome', num(latest.filter((e) => /^Chrome|^Edge/.test(e.browser || '')).length)],
    ['On Firefox', num(latest.filter((e) => /^Firefox/.test(e.browser || '')).length)],
    ...Object.entries(versions).sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true })).map(([v, n]) => ['  Version ' + v, num(n)]),
  ] : []);
  renderTools(ev);
}

// Tools on/off by version, from each install's latest check-in ("autoService@1.16.0").
const TOOL_NAMES = {
  autoOpenWo: 'Auto-Open Work Order', autoService: 'Autocomplete Service', stockSearch: 'In-Stock Search',
  poPartNames: 'PO Part Names', autoConfirm: 'Auto-Confirm Serial', tabTitle: 'Detailed Tab Titles',
  poFormat: 'PO Format Fixer', gdException: 'GD Exception', ebay: 'Listing Checker',
  imeiAutofill: 'IMEI Autofill', woTools: 'Workorder Sorting & Formatting', pullbacks: 'Pullbacks 2026',
  partsOrder: 'Parts Order Form',
};
function renderTools(ev) {
  const latest = new Map();
  for (const e of ev) if (e.tool === 'suite' && e.event === 'checkin' && (!latest.has(e.install) || latest.get(e.install).t < e.t)) latest.set(e.install, e);
  const rows = new Map(); // "id@version" -> { on, off }
  const add = (tag, k) => { const r = rows.get(tag) || { on: 0, off: 0 }; r[k]++; rows.set(tag, r); };
  for (const c of latest.values()) {
    (c.tools || []).forEach((t) => add(t, 'on'));
    (c.toolsOff || []).forEach((t) => add(t, 'off'));
  }
  const list = [...rows.entries()].map(([tag, r]) => {
    const [id, ver] = tag.split('@');
    return { name: TOOL_NAMES[id] || id, ver: ver || '(not recorded)', on: r.on, off: r.off };
  }).sort((a, b) => a.name.localeCompare(b.name) || b.ver.localeCompare(a.ver, undefined, { numeric: true }));
  table('toolTable', ['Tool', 'Version', 'Installs with it on', 'Installs with it off', '% on'],
    list.map((r) => [r.name, r.ver, num(r.on), num(r.off), Math.round((100 * r.on) / Math.max(1, r.on + r.off)) + '%']), null, 2);
}

function drawChart(days, values) {
  const box = $('chart');
  const W = 1000, H = 220, L = 50, B = 30, T = 10;
  const max = Math.max(60, ...values);
  const unit = max >= 7200 ? 3600 : 60; // hours or minutes on the axis
  const unitName = unit === 3600 ? 'h' : 'm';
  const step = (W - L - 10) / days.length;
  const bw = Math.max(2, step * 0.7);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const mk = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; svg.append(n); return n; };
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = H - B - (H - B - T) * (v / max);
    mk('line', { x1: L, x2: W - 10, y1: y, y2: y, stroke: '#eee' });
    mk('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, (v / unit).toFixed(v / unit < 10 && v ? 1 : 0) + ' ' + unitName);
  }
  const every = Math.ceil(days.length / 15);
  days.forEach((d, i) => {
    const h = (H - B - T) * (values[i] / max);
    const x = L + i * step + (step - bw) / 2;
    const r = mk('rect', { class: 'bar', x, y: H - B - h, width: bw, height: Math.max(0, h) });
    const tip = document.createElementNS(ns, 'title'); tip.textContent = `${d}: ${dur(values[i])}`; r.append(tip);
    if (i % every === 0) mk('text', { x: x + bw / 2, y: H - 10, 'text-anchor': 'middle' }, d.slice(5));
  });
  box.replaceChildren(svg);
}

// ---------- CSV ----------
const CSV_COLS = ['time (Central)', 'day', 'tool', 'event', 'store', 'service', 'program', 'code', 'step', 'from', 'seconds', 'standIn', 'missing', 'choice', 'amount', 'repeat', 'filled', 'partial', 'tools', 'toolsOff', 'version', 'toolVersion', 'browser', 'test', 'install', 'account', 'id'];
function downloadCsv() {
  const ev = filtered().slice().sort((a, b) => a.t - b.t);
  const cell = (v) => { if (v === undefined || v === null) return ''; const s = Array.isArray(v) ? v.join(' ') : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [CSV_COLS.join(',')];
  for (const e of ev) lines.push(CSV_COLS.map((c) => cell(c === 'time (Central)' ? fmtCentral(e.t) : e[c])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `ubif-usage-${loadedRange ? loadedRange.from + '_to_' + loadedRange.to : 'stats'}.csv` });
  document.body.append(a); a.click(); a.remove();
}

// ---------- Settings (seconds) and allowed accounts ----------
async function loadConfig() {
  const s = await getDoc(doc(db, 'config', 'settings')); // throws for accounts without access
  seconds = (s.exists() && s.data().seconds) || {};
  const a = await getDoc(doc(db, 'config', 'admins'));
  $('admins').value = ((a.exists() && a.data().emails) || []).join('\n');
}

async function saveSeconds() {
  let bad = null;
  document.querySelectorAll('input.secs').forEach((i) => { const v = readTimeInput(i); if (v === null) bad = i.value; else seconds[i.dataset.key] = v; });
  if (bad !== null) { $('secondsStatus').textContent = 'Can\'t read "' + bad + '". Use 45s, 4.5m or 1h.'; return; }
  try {
    await setDoc(doc(db, 'config', 'settings'), { seconds }, { merge: true });
    $('secondsStatus').textContent = 'Saved';
  } catch (e) { $('secondsStatus').textContent = 'Could not save: ' + e.message; }
}

async function saveAdmins() {
  const emails = [...new Set($('admins').value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  try {
    await setDoc(doc(db, 'config', 'admins'), { emails });
    $('admins').value = emails.join('\n');
    $('adminsStatus').textContent = 'Saved';
  } catch (e) { $('adminsStatus').textContent = 'Could not save: ' + e.message; }
}

// ---------- Sign-in ----------
function show(which) {
  for (const id of ['signedOut', 'noAccess', 'app']) $(id).hidden = id !== which;
}

onAuthStateChanged(auth, async (user) => {
  $('who').hidden = !user;
  if (!user) { show('signedOut'); return; }
  $('whoEmail').textContent = user.email;
  try {
    await loadConfig();
  } catch (e) {
    $('noAccessEmail').textContent = user.email;
    show('noAccess');
    return;
  }
  show('app');
  loadEvents();
});

$('signIn').addEventListener('click', async () => {
  $('signInError').hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    $('signInError').textContent = 'Sign-in failed: ' + (e.message || e);
    $('signInError').hidden = false;
  }
});
$('signOut').addEventListener('click', () => signOut(auth));
$('range').addEventListener('change', () => { $('customDates').hidden = $('range').value !== 'custom'; if ($('range').value !== 'custom') loadEvents(); });
$('load').addEventListener('click', loadEvents);
$('store').addEventListener('change', render);
$('includeTest').addEventListener('change', () => { fillStores(); render(); });
$('csv').addEventListener('click', downloadCsv);
$('saveSeconds').addEventListener('click', saveSeconds);
$('saveAdmins').addEventListener('click', saveAdmins);
const today = ymd(Date.now());
$('from').value = addDays(today, -6);
$('to').value = today;
