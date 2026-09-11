/**
 * Addressing a column by `key`, which is the rule that keeps a shifted column from answering wrongly.
 *
 * The failure this guards against is not an exception. Drop a column from the middle of a lookup tab
 * and every index after it slides one over, while a read by position goes on returning a value — the
 * wrong one — and a hygiene check built on it reports clean.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');

const boot = loadProject('bootstrap');
const CONFIG = boot.CONFIG;

test('a column key resolves to its position in the contract', () => {
  CONFIG.columns.events.forEach((column, index) => {
    assert.strictEqual(boot.columnIndex_('events', column.key), index,
      `${column.key} is not at ${index}`);
  });
});

test('an unknown key throws rather than answering -1', () => {
  // `findIndex` returns -1, and -1 used as a column index is a silent read of the wrong cell.
  assert.throws(() => boot.columnIndex_('events', 'noSuchColumn'), /noSuchColumn/);
});

test('an unknown tab throws with the config key to look at', () => {
  assert.throws(() => boot.columnIndex_('noSuchTab', 'title'), /CONFIG\.columns/);
});

test('column letters follow the contract order', () => {
  const letters = CONFIG.columns.events.map(column => boot.columnLetter_('events', column.key));
  assert.deepStrictEqual(letters.slice(0, 4), ['A', 'B', 'C', 'D']);
});

test('column letters are base-26 with no zero past Z', () => {
  // Spreadsheet columns go A…Z, AA, AB — not A0. Twenty-six columns is more than this sheet has,
  // so the loop is exercised here rather than by the config.
  const wide = { columns: { wide: [] }, tabs: { wide: 'Wide' } };
  for (let i = 0; i < 30; i++) wide.columns.wide.push({ key: 'c' + i, header: 'C' + i });
  const saved = { columns: boot.CONFIG.columns.wide, tab: boot.CONFIG.tabs.wide };
  boot.CONFIG.columns.wide = wide.columns.wide;
  boot.CONFIG.tabs.wide = 'Wide';
  try {
    assert.strictEqual(boot.columnLetter_('wide', 'c25'), 'Z');
    assert.strictEqual(boot.columnLetter_('wide', 'c26'), 'AA');
    assert.strictEqual(boot.columnLetter_('wide', 'c27'), 'AB');
  } finally {
    if (saved.columns === undefined) delete boot.CONFIG.columns.wide;
    else boot.CONFIG.columns.wide = saved.columns;
    if (saved.tab === undefined) delete boot.CONFIG.tabs.wide;
    else boot.CONFIG.tabs.wide = saved.tab;
  }
});

test('a range is qualified by the tab and starts at row 2', () => {
  assert.strictEqual(boot.colRange_('events', 'title'), `${CONFIG.tabs.events}!C2:C`);
});

test('a tab name with a space is quoted for a formula', () => {
  // `Map Export` and `Read me` both contain one. An unquoted name is a parse error, not a wrong
  // answer, but it only shows up in the cell.
  assert.strictEqual(boot.tabRef_('mapExport'), `'${CONFIG.tabs.mapExport}'`);
});

test('a single-word tab name is not quoted', () => {
  assert.strictEqual(boot.tabRef_('events'), CONFIG.tabs.events);
});

test('an apostrophe in a tab name is doubled', () => {
  const saved = boot.CONFIG.tabs.events;
  boot.CONFIG.tabs.events = "Tonight's events";
  try {
    assert.strictEqual(boot.tabRef_('events'), "'Tonight''s events'");
  } finally {
    boot.CONFIG.tabs.events = saved;
  }
});

test('the computed block is located by its marks, not by a number', () => {
  const first = boot.firstComputed_('events');
  const count = boot.computedCount_('events');
  assert.strictEqual(first, boot.columnIndex_('events', 'city') + 1);
  assert.strictEqual(count, 3);
});
