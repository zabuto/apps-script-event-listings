/**
 * The invariants the code and the docs both rely on, asserted against the live config.
 *
 * Each of these is load-bearing somewhere and stated in prose in `docs/configuration.md` or
 * `docs/architecture.md`. Prose does not fail a build. These do.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadProject, root } = require('./helpers/project');

const CONFIG = loadProject('src').CONFIG;
const TABS_WITH_COLUMNS = ['events', 'venues', 'organisers'];

test('the map export tab is first, because My Maps imports sheet 1', () => {
  assert.strictEqual(Object.keys(CONFIG.tabs)[0], 'mapExport',
    'reorder the tabs and the next map refresh geocodes whatever is now first');
});

test('every configured tab key has a name', () => {
  for (const [key, name] of Object.entries(CONFIG.tabs)) {
    assert.ok(name && typeof name === 'string', `CONFIG.tabs.${key} is empty`);
  }
});

test('tab names are unique', () => {
  const names = Object.values(CONFIG.tabs);
  assert.strictEqual(new Set(names).size, names.length, 'two tabs share a name');
});

test('column keys are unique within a tab', () => {
  for (const tab of TABS_WITH_COLUMNS) {
    const keys = CONFIG.columns[tab].map(column => column.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${tab} has a duplicate column key`);
  }
});

test('column headers are unique within a tab', () => {
  // `table_()` matches the header row position by position, and a hygiene check that reads the
  // wrong column of two identically named ones reports clean.
  for (const tab of TABS_WITH_COLUMNS) {
    const headers = CONFIG.columns[tab].map(column => column.header);
    assert.strictEqual(new Set(headers).size, headers.length, `${tab} has a duplicate header`);
  }
});

test('the computed block is contiguous and last', () => {
  // It is cleared, marked and protected as one range, so a computed column with a typed one after
  // it would leave that typed column inside a protected block.
  const flags = CONFIG.columns.events.map(column => !!column.computed);
  const first = flags.indexOf(true);
  assert.notStrictEqual(first, -1, 'no events column is marked computed');
  assert.ok(flags.slice(first).every(Boolean),
    'a non-computed column sits after the computed block');
});

test('the events tab has exactly the three computed columns the outputs read', () => {
  const computed = CONFIG.columns.events.filter(column => column.computed).map(column => column.key);
  assert.deepStrictEqual(computed, ['city', 'when', 'upcoming']);
});

test('the (private) column is the last non-computed column on every tab that has one', () => {
  for (const tab of TABS_WITH_COLUMNS) {
    const columns = CONFIG.columns[tab];
    const typed = columns.filter(column => !column.computed);
    const privateAt = typed.findIndex(column => /\(private\)/i.test(column.header));
    if (privateAt === -1) continue;
    assert.strictEqual(privateAt, typed.length - 1,
      `${tab}: a typed column sits after the (private) one — it reads as part of the generated block`);
  }
});

test('the map export builds exactly five columns', () => {
  // `mapExportRows_` refuses to run with any other number rather than mislabelling a popup, and
  // every column costs a labelled row in every pin.
  assert.strictEqual(CONFIG.mapExport.headers.length, 5);
});

test('no map export header names a private column', () => {
  for (const header of CONFIG.mapExport.headers) {
    assert.strictEqual(/\(private\)/i.test(header), false, `${header} would publish a private column`);
  }
});

test('the two lookup tabs are keyed by a name column', () => {
  for (const tab of ['venues', 'organisers']) {
    assert.strictEqual(CONFIG.columns[tab][0].key, 'name', `${tab} is not keyed by name`);
  }
});

test('the scope values are distinct', () => {
  // They are compared as strings in formulas *and* in JavaScript. Two that collide would make the
  // dashboard and the document disagree about what publishes.
  const values = Object.values(CONFIG.values.scope);
  assert.strictEqual(new Set(values).size, values.length);
});

test('day and month name lists are the length CHOOSE needs', () => {
  assert.strictEqual(CONFIG.values.dayNames.length, 7);
  assert.strictEqual(CONFIG.values.monthNames.length, 12);
});

test('the weekly refresh names a real weekday and a real hour', () => {
  const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  assert.ok(days.includes(CONFIG.weeklyRefresh.weekDay), 'weekDay is not MONDAY … SUNDAY');
  assert.ok(Number.isInteger(CONFIG.weeklyRefresh.hour)
    && CONFIG.weeklyRefresh.hour >= 0 && CONFIG.weeklyRefresh.hour <= 23);
});

test('every Script Property is named, and none holds an id', () => {
  // The names live in config; the ids live in Script Properties. That is what keeps this repo
  // publishable.
  for (const [key, name] of Object.entries(CONFIG.properties)) {
    assert.match(name, /^[A-Z0-9_]+$/, `CONFIG.properties.${key} is not a property name`);
  }
});

test('the scaffolding manifest declares the Sheets advanced service', () => {
  // Undeclared, `Sheets.Spreadsheets` is caught at both call sites and reported as skipped work, so
  // the build still says it succeeded while the theme and the filter views are quietly missing.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'shared/appsscript.bootstrap.json'), 'utf8'));
  const services = (manifest.dependencies || {}).enabledAdvancedServices || [];
  assert.ok(services.some(service => service.userSymbol === 'Sheets'),
    'bootstrap calls Sheets.Spreadsheets; without the declaration the service is never offered');
});

test('both manifests name the same zone as CONFIG.timeZone', () => {
  // Nothing reads the manifest zone, but a manifest that disagrees with the config is the first
  // thing read when a date lands on the wrong day, and it sends the reader down the wrong path.
  for (const manifest of ['shared/appsscript.bootstrap.json', 'shared/appsscript.src.json']) {
    const declared = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8')).timeZone;
    assert.strictEqual(declared, CONFIG.timeZone, `${manifest} disagrees with CONFIG.timeZone`);
  }
});

test('the city-only flag is a venues column a maintainer types into', () => {
  // The privacy rule turns on this column, and it is a decision per venue: `computed: true` would
  // make it a formula, which is a cell nobody can tick.
  const flag = CONFIG.columns.venues.find(column => column.key === 'cityOnly');
  assert.ok(flag, 'the venues contract has no cityOnly column — the flag the privacy rule reads');
  assert.strictEqual(flag.computed, undefined, 'the flag is typed by a maintainer, not computed');
});
