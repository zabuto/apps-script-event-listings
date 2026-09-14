/**
 * `refreshMapExport` — what it writes to the tab, and the report that says whether to import it.
 *
 * This is the function that decides what My Maps receives. Where it writes matters as much as what
 * it writes: one column over, every value sits under the wrong header, and My Maps imports headers.
 *
 * What the rows *say* is `map-export.test.js`. What is asserted here is everything around them: the
 * anchor, the clearing, the plain-text format that keeps a title a title, the read-back, and the
 * lists a maintainer acts on.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, midnightIn, rowFor } = require('./helpers/fakes');

const src = loadProject('src');
const CONFIG = src.CONFIG;
const status = CONFIG.values.eventStatus;
const scope = CONFIG.values.scope;
const venueStatus = CONFIG.values.venueStatus;

const SHEET_ZONE = 'Europe/Amsterdam';
const NOW = new Date('2026-06-10T09:00:00Z');
const day = ymd => midnightIn(SHEET_ZONE, ymd);

const event = values => rowFor(CONFIG, 'events', Object.assign({
  status: status.confirmed, upcoming: scope.upcoming,
}, values));
const venue = values => rowFor(CONFIG, 'venues', Object.assign({
  status: venueStatus.active,
}, values));

/** One event that publishes, and the venue it names. */
const PUBLISHED = event({
  dateStart: day('2026-06-12'), title: 'Open Stage', venue: 'Paradiso', city: 'Amsterdam',
});
const PARADISO = venue({ name: 'Paradiso', address: 'Weteringschans 6', postcode: '1017 SG',
  city: 'Amsterdam' });

/** The one row `PUBLISHED` produces, in the five columns the export holds. */
const ONE_GOOD_ROW = ['12-06-26 Open Stage', 'Fri 12 Jun 2026', 'Paradiso', '',
  `Weteringschans 6, 1017 SG Amsterdam, ${CONFIG.mapExport.countrySuffix}`];

/**
 * Runs `refreshMapExport` and hands back the tab it wrote and the one report it would have shown.
 *
 * `headers` defaults to the contract but can be widened, which is how the stale-column branch is
 * reached: a column left over from an earlier contract, whose header no rewrite of the rows clears.
 */
function refresh({
  events = [PUBLISHED],
  venues = [PARADISO],
  organisers = [],
  headers = CONFIG.mapExport.headers,
  maxColumns = null,
  coerce = null,
} = {}) {
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    timeZone: SHEET_ZONE,
    tabs: {
      mapExport: { headers: headers, rows: [], maxColumns: maxColumns, coerce: coerce },
      events: events,
      venues: venues,
      organisers: organisers,
    },
  });
  const notified = [];
  const restore = installFakes({ spreadsheet: spreadsheet, notified: notified, now: NOW });
  try {
    src.refreshMapExport();
  } finally {
    restore();
  }
  assert.strictEqual(notified.length, 1,
    `refreshMapExport reported ${notified.length} times, expected once`);
  return {
    sheet: spreadsheet.getSheetByName(CONFIG.tabs.mapExport).model,
    report: notified[0],
  };
}

/** The rows under the header row, trimmed to the ones that hold anything. */
const written = sheet => sheet.grid.slice(1).filter(row => String(row[0] || '') !== '');

/* ── where it writes ───────────────────────────────────────────────────────────────────────── */

test('the rows land under the headers, starting in row 2', () => {
  const { sheet } = refresh({});
  assert.deepStrictEqual(written(sheet), [ONE_GOOD_ROW]);
  assert.deepStrictEqual(sheet.grid[0].slice(0, CONFIG.mapExport.headers.length),
    CONFIG.mapExport.headers);
});

test('row 1 is the configured headers, frozen, and styled as a header', () => {
  const { sheet } = refresh({});
  assert.strictEqual(sheet.frozenRows, 1);
  const background = sheet.formats.find(format => format.style === 'setBackground');
  assert.strictEqual(background.value, CONFIG.style.palette.primary);
  assert.strictEqual(background.row, 1, 'the header styling was applied to the wrong row');
});

test('the rows are formatted as plain text before they are written', () => {
  // `setValues` stores a string opening with `=` as a formula and one reading like a date as a date,
  // and a title is whatever a maintainer typed.
  const { sheet } = refresh({});
  const format = sheet.formats.find(entry => entry.style === 'setNumberFormat');
  assert.ok(format, 'the block is written without a number format, so a title can become a formula');
  assert.strictEqual(format.value, '@');
  assert.strictEqual(format.row, 2, 'the header row was formatted as text as well');
});

test('a cell that did not keep what it was sent stops the import', () => {
  // The read-back is the whole check: `setValues` says nothing about the result, and a pin carries
  // whatever the cell ended up holding.
  const { report } = refresh({
    coerce: value => (String(value).startsWith('12-06-26 ') ? '#ERROR!' : value),
  });
  assert.match(report, /1 row\(s\) from 1 event\(s\) ⚠/);
  assert.match(report, /DO NOT IMPORT this tab — 1 row\(s\) were written/);
  assert.match(report, /1 cell\(s\) hold something other than what this run computed/);
});

test('a row that vanished on the way in stops the import too', () => {
  const { report } = refresh({
    coerce: value => (String(value).startsWith('12-06-26 ') ? '' : value),
  });
  assert.match(report, /the tab reads back 0/);
  assert.match(report, /DO NOT IMPORT/);
});

test('a title that opens with an equals sign stays a title', () => {
  const { sheet, report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), title: '=Best of 2026', venue: 'Paradiso',
      city: 'Amsterdam' })],
  });
  assert.strictEqual(written(sheet)[0][0], '12-06-26 =Best of 2026');
  assert.strictEqual(report.includes('DO NOT IMPORT'), false);
});

test('the whole tab is cleared first, so an export that shrank leaves nothing behind', () => {
  // Rows left under the new ones import as pins on dates that are gone.
  const { sheet } = refresh({});
  const cleared = sheet.cleared.find(entry => entry.row === 2 && entry.column === 1);
  assert.ok(cleared, 'the rows below the headers were not cleared before the write');
  assert.ok(cleared.height > 1, 'only the rows about to be written were cleared');
});

test('a column left over past the contract is cleared, its header included', () => {
  // The rows below a dropped column go with it, its header does not, and a leftover header is a
  // field My Maps imports as an empty row in every popup.
  const { sheet, report } = refresh({
    headers: [...CONFIG.mapExport.headers, 'Retired Field', 'Older Still'],
  });
  assert.match(report, /Cleared 2 column\(s\) past the contract, headers included/);
  assert.strictEqual(sheet.grid[0][5], '', 'the stale header is still there');
  assert.strictEqual(sheet.grid[0][6], '', 'the stale header is still there');
});

/* ── the report, which is the whole of what a maintainer acts on ────────────────────────────── */

test('a clean rebuild counts the rows, the events they came from, and ticks', () => {
  const { report } = refresh({});
  assert.match(report, /1 row\(s\) from 1 event\(s\) ✓/);
  assert.strictEqual(report.includes('DO NOT IMPORT'), false, 'a clean tab was called unimportable');
});

test('a run is counted as its dates, and as the one event behind them', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), dateEnd: day('2026-06-14'), title: 'Weekender',
      venue: 'Paradiso', city: 'Amsterdam' })],
  });
  assert.match(report, /3 row\(s\) from 1 event\(s\) ✓/);
  assert.match(report, /One row per date/);
});

test('a tab that holds nothing is reported as nothing, not as an error', () => {
  const { report } = refresh({ events: [] });
  assert.match(report, /0 row\(s\) from 0 event\(s\) ✓/);
});

test('the dates of a run that are over are named as left off', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-08'), dateEnd: day('2026-06-11'), title: 'Under Way',
      venue: 'Paradiso', city: 'Amsterdam' })],
  });
  assert.match(report, /2 date\(s\) of a run already under way are past/);
});

test('a run cut at the cap stops the sheet being trusted about it', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), dateEnd: day('2027-06-12'),
      title: 'Mistyped Year', venue: 'Paradiso', city: 'Amsterdam' })],
  });
  assert.match(report, new RegExp(`Cut to ${CONFIG.mapExport.maxDays} dates`));
  assert.match(report, /Mistyped Year \(366 dates\)/);
  assert.match(report, /Check the end date/);
});

test('an export past what a layer imports says so, since the import will not', () => {
  const saved = CONFIG.mapExport.importRowLimit;
  CONFIG.mapExport.importRowLimit = 2;
  try {
    const { report } = refresh({
      events: [event({ dateStart: day('2026-06-12'), dateEnd: day('2026-06-14'), title: 'Weekender',
        venue: 'Paradiso', city: 'Amsterdam' })],
    });
    assert.match(report, /3 rows, and one layer imports 2/);
  } finally {
    CONFIG.mapExport.importRowLimit = saved;
  }
});

/* ── the two venue-less lists, which mean opposite things ───────────────────────────────────── */

test('a concept event with no venue is named as expected, not as a gap', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), title: 'Somewhere Soon',
      status: status.concept })],
  });
  assert.match(report, new RegExp(`${status.concept}, venue still to be announced: Somewhere Soon`));
  assert.match(report, /Expected, not a gap/);
  assert.strictEqual(report.includes('⚠ ' + status.confirmed + ' with no venue'), false,
    'a concept event was listed as a hole in the sheet');
});

test('a confirmed event with no venue is a hole in the sheet, and says so', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), title: 'Roomless' })],
  });
  assert.match(report,
    new RegExp(`⚠ ${status.confirmed} with no venue, so left off the map: Roomless`));
  assert.match(report, /give them a venue, or set them back to/);
  assert.strictEqual(report.includes('Expected, not a gap'), false,
    'a confirmed event with no venue was excused');
});

test('the two lists are kept apart when both kinds are present', () => {
  // A concept event named as a gap on every refresh teaches a maintainer to skip the section that
  // also holds the real problem.
  const { report } = refresh({
    events: [
      event({ dateStart: day('2026-06-12'), title: 'Announced', status: status.concept }),
      event({ dateStart: day('2026-06-13'), title: 'Roomless' }),
    ],
  });
  assert.match(report, /to be announced: Announced/);
  assert.match(report, /with no venue, so left off the map: Roomless/);
  assert.strictEqual(/to be announced:[^\n]*Roomless/.test(report), false,
    'the confirmed event was excused along with the concept one');
});

test('a venue-less event is not counted as an event on the map', () => {
  const { report } = refresh({
    events: [PUBLISHED, event({ dateStart: day('2026-06-13'), title: 'Roomless' })],
  });
  assert.match(report, /1 row\(s\) from 1 event\(s\)/);
});

/* ── the pin that lands in the wrong place ──────────────────────────────────────────────────── */

test('a venue with no address is named, because its pin lands on the city centre', () => {
  const { report } = refresh({
    events: [event({ dateStart: day('2026-06-12'), title: 'House Concert',
      venue: 'The Back Room', city: 'Amsterdam' })],
    venues: [venue({ name: 'The Back Room', city: 'Amsterdam' })],
  });
  assert.match(report, /Geocoding by venue name, so the pin lands on the city centre: House Concert/);
});

test('a venue with an address is not named as approximate', () => {
  const { report } = refresh({});
  assert.strictEqual(report.includes('Geocoding by venue name'), false,
    'an exactly located venue was reported as approximate');
});

test('only the events at an addressless venue are named, not every event on the tab', () => {
  // One addressless venue must not tar the whole tab: a list that names every pin identifies none.
  const { report } = refresh({
    events: [PUBLISHED, event({ dateStart: day('2026-06-13'), title: 'House Concert',
      venue: 'The Back Room', city: 'Amsterdam' })],
    venues: [PARADISO, venue({ name: 'The Back Room', city: 'Amsterdam' })],
  });
  assert.match(report, /city centre: House Concert/);
  assert.strictEqual(/city centre:[^\n]*Open Stage/.test(report), false,
    'a venue with a full address was named as geocoding by name');
});

/* ── the instructions, which are the point of the dialog ────────────────────────────────────── */

test('the report names the columns the import has to be pointed at', () => {
  const headers = CONFIG.mapExport.headers;
  const { report } = refresh({});
  assert.match(report, new RegExp(`Columns: ${headers.join(' \\| ')}`));
  assert.match(report, new RegExp(`position column\\s+"${headers[headers.length - 1]}"`));
  assert.match(report, new RegExp(`title column "${headers[0]}"`));
});

test('the report says the tab does not follow the sheet', () => {
  // It holds what the run computed. A maintainer who reads it as live imports last month's dates.
  const { report } = refresh({});
  assert.match(report, /holds what this run computed, and does not follow the sheet/);
});

test('the report says the layer must be deleted, not just re-imported', () => {
  // My Maps only appends to a layer's field list, so a column that has gone from this tab stays in
  // the popup until the layer is replaced.
  const { report } = refresh({});
  assert.match(report, /Deleting the layer is not optional/);
  assert.match(report, /only ever appends/);
});

/* ── refusals ───────────────────────────────────────────────────────────────────────────────── */

test('a missing map export tab is refused by name rather than written elsewhere', () => {
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    tabs: { events: [], venues: [], organisers: [] },
  });
  const restore = installFakes({ spreadsheet: spreadsheet, notified: [], now: NOW });
  try {
    assert.throws(() => src.refreshMapExport(),
      new RegExp(`No "${CONFIG.tabs.mapExport}" tab`));
  } finally {
    restore();
  }
});
