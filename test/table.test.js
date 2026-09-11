/**
 * `table_`, and the refusal that is the whole point of it.
 *
 * The `AGENTS.md` rule to address columns by `key` says to read rows through `table_`, because it
 * checks row 1 against the column contract first. That check is the load-bearing part: a read by
 * position against a shifted sheet does not fail, it *answers* — and `checkData` then reports clean
 * because it compared the right rule against the wrong column. There is no exception to see and
 * nothing in the output that looks wrong.
 *
 * `fakeSpreadsheet` builds the header row from `CONFIG.columns`, so presenting a sheet that
 * disagrees with the contract takes the `{ rows, headers }` form of a tab spec.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor } = require('./helpers/fakes');

const src = loadProject('src');
const CONFIG = src.CONFIG;

const contractHeaders = tabKey => CONFIG.columns[tabKey].map(column => column.header);

/** Runs `table_(tabKey)` against a spreadsheet built from `tabs`. */
function tableFor(tabKey, tabs) {
  const restore = installFakes({ spreadsheet: fakeSpreadsheet(CONFIG, { tabs }) });
  try {
    return src.table_(tabKey);
  } finally {
    restore();
  }
}

const VENUE = { name: 'Beurs van Berlage', address: 'Damrak 243', city: 'Amsterdam',
  status: CONFIG.values.venueStatus.active, notesPrivate: 'ask for the side door' };

/* ── the refusal ────────────────────────────────────────────────────────────────────────────── */

test('a renamed header is refused rather than read past', () => {
  const headers = contractHeaders('venues');
  headers[1] = 'Street';                                    // was `Address`
  assert.throws(
    () => tableFor('venues', { venues: { headers, rows: [rowFor(CONFIG, 'venues', VENUE)] } }),
    /does not match the column contract/);
});

test('a renamed header is refused at every position', () => {
  // The check above renames one column, which is a sample rather than the rule: a comparison that
  // stopped one short of the end would satisfy it and still read a shifted last column.
  for (const tabKey of ['events', 'venues', 'organisers']) {
    const contract = contractHeaders(tabKey);
    contract.forEach((header, i) => {
      const headers = contract.slice();
      headers[i] = 'Renamed By Hand';
      assert.throws(
        () => tableFor(tabKey, { [tabKey]: { headers: headers, rows: [] } }),
        /does not match the column contract/,
        `${tabKey}: column ${i + 1} ("${header}") was renamed and the tab was read anyway`);
    });
  }
});

test('a shifted column is refused — the failure the rule exists for', () => {
  // An extra column inserted at the front. Every index after it slides one over, so a read by
  // position returns the name for the address, the address for the postcode, and so on: all present,
  // all plausible, all wrong. Nothing downstream can tell.
  const headers = ['Added by hand', ...contractHeaders('venues')];
  const rows = [['scratch', ...rowFor(CONFIG, 'venues', VENUE)]];
  assert.throws(() => tableFor('venues', { venues: { headers, rows } }),
    /does not match the column contract/);
});

test('two columns swapped are refused, though the set of headers is unchanged', () => {
  // The set is identical and only the order moved, which is exactly the edit a sort or a drag makes
  // and the one a "are all the columns there?" check would wave through.
  const headers = contractHeaders('venues');
  [headers[1], headers[2]] = [headers[2], headers[1]];
  assert.throws(() => tableFor('venues', { venues: { headers, rows: [] } }),
    /does not match the column contract/);
});

test('a truncated header row is refused rather than padded', () => {
  const headers = contractHeaders('venues').slice(0, 3);
  assert.throws(() => tableFor('venues', { venues: { headers, rows: [] } }),
    /does not match the column contract/);
});

test('the refusal prints both header rows, so the fix is visible without opening the config', () => {
  const headers = contractHeaders('venues');
  headers[1] = 'Street';
  try {
    tableFor('venues', { venues: { headers, rows: [] } });
    assert.fail('a mismatched header row was accepted');
  } catch (err) {
    assert.match(err.message, /expected:/);
    assert.match(err.message, /found:/);
    assert.ok(err.message.includes('Street'), 'the message does not show what is on the sheet');
    assert.ok(err.message.includes(CONFIG.columns.venues[1].header),
      'the message does not show what the contract expects');
    assert.match(err.message, /do not let the checks read on/);
  }
});

test('a missing tab is refused by name', () => {
  assert.throws(() => tableFor('venues', { events: [] }),
    new RegExp(`No "${CONFIG.tabs.venues}" tab`));
});

/* ── the happy path, so the refusal is not passing by accident ──────────────────────────────── */

test('a tab matching the contract is read', () => {
  const table = tableFor('venues', { venues: [rowFor(CONFIG, 'venues', VENUE)] });
  assert.strictEqual(table.rows.length, 1);
  assert.strictEqual(table.get(table.rows[0], 'name'), VENUE.name);
  assert.strictEqual(table.get(table.rows[0], 'address'), VENUE.address);
});

test('a tab holding only a header row has no rows, and does not read row 1 as data', () => {
  // `getLastRow()` is 1 here. The guard around it is what keeps an empty tab from being handed back
  // as one row of column titles, which every caller would then treat as a venue called `Name`.
  const table = tableFor('venues', { venues: [] });
  assert.deepStrictEqual(table.rows, []);
});

test('`at` answers by key, and disagreeing with columnIndex_ is not possible', () => {
  const table = tableFor('venues', { venues: [] });
  for (const column of CONFIG.columns.venues) {
    assert.strictEqual(table.at(column.key), src.columnIndex_('venues', column.key));
  }
});

/* ── the shape a formula-fed tab actually has ───────────────────────────────────────────────── */

/*
 * `table_` trusts `getLastRow()`, and on the events tab that number is a thousand.
 *
 * `setupFormulas` writes `city`, `when` and `upcoming` as `=ARRAYFORMULA(IF(title="","", …))` into
 * row 2, spilling the whole column; per `docs/gotchas.md` the formula returns `""` for every empty
 * row, an empty string is a value, and the sheet reports a thousand rows. So the live
 * `table_('events').rows` is a thousand entries with a handful of typed ones at the top, and every
 * caller has to guard for the blank tail.
 */

test('a formula-fed tab hands back its blank tail too, which is what callers must guard', () => {
  const table = tableFor('events', {
    events: { rows: [rowFor(CONFIG, 'events', { title: 'Open Stage' })], lastRow: 1000 },
  });
  assert.strictEqual(table.rows.length, 999, 'the blank tail the array formulas occupy is missing');
  assert.strictEqual(table.text(table.rows[0], 'title'), 'Open Stage');
  assert.strictEqual(table.text(table.rows[998], 'title'), '', 'the tail is not blank');
});

test('a tab that reports more rows than it holds is still read against the contract', () => {
  // The header check runs on row 1 either way — an inflated last row must not be a way past it.
  const headers = contractHeaders('events');
  headers[2] = 'Name';
  assert.throws(() => tableFor('events', { events: { headers, rows: [], lastRow: 1000 } }),
    /does not match the column contract/);
});

test('a fixture claiming fewer rows than it holds is refused rather than quietly truncated', () => {
  // `lastRow` describes the sheet; it is not a way to hide rows from the code under test.
  assert.throws(() => tableFor('events', {
    events: { rows: [rowFor(CONFIG, 'events', { title: 'One' }),
      rowFor(CONFIG, 'events', { title: 'Two' })], lastRow: 2 },
  }), /cannot report fewer rows than it holds/);
});

test('`text` trims and stringifies, `get` hands back the value as typed', () => {
  const row = rowFor(CONFIG, 'venues', { ...VENUE, name: '  Paradiso  ' });
  const table = tableFor('venues', { venues: [row] });
  assert.strictEqual(table.text(table.rows[0], 'name'), 'Paradiso');
  assert.strictEqual(table.get(table.rows[0], 'name'), '  Paradiso  ');
});

test('an unknown column key throws instead of reading a neighbouring cell', () => {
  const table = tableFor('venues', { venues: [rowFor(CONFIG, 'venues', VENUE)] });
  assert.throws(() => table.get(table.rows[0], 'noSuchColumn'), /noSuchColumn/);
  assert.throws(() => table.at('noSuchColumn'), /noSuchColumn/);
});
