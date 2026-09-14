/**
 * `refreshMapExport` — what it writes to the tab, and the report that says whether to import it.
 *
 * This is the function that decides what My Maps receives. Where it anchors the formula matters as
 * much as the formula: spilled one column over, every value sits under the wrong header, and My
 * Maps imports headers.
 *
 * Nothing here evaluates a formula, so the fixtures say what the sheet came back with — `spill` in
 * `helpers/fakes.js`. Whether the formula *computes* the right thing is a question only a sheet can
 * answer, and the probes inside the setup steps ask it. What is testable offline is everything
 * `refreshMapExport` does with the answer: the counting, the error detection, the two venue-less
 * lists, and the refusal to recommend an import.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor } = require('./helpers/fakes');

const src = loadProject('src');
const CONFIG = src.CONFIG;
const status = CONFIG.values.eventStatus;
const scope = CONFIG.values.scope;
const venueStatus = CONFIG.values.venueStatus;

const event = values => rowFor(CONFIG, 'events', values);
const venue = values => rowFor(CONFIG, 'venues', values);

/** The separator cache `argSeparator_` reads, so it never reaches for its probe sheet. */
const SEPARATOR_KEY = `ARG_SEPARATOR:${CONFIG.spreadsheet.locale}`;

/** One event that publishes, and the venue it names. */
const PUBLISHED = event({
  dateStart: new Date(2026, 5, 5), title: 'Open Stage', venue: 'Paradiso', city: 'Amsterdam',
  status: status.confirmed, upcoming: scope.upcoming, when: 'Fri 5 Jun 2026',
});
const PARADISO = venue({ name: 'Paradiso', address: 'Weteringschans 6', postcode: '1017 SG',
  city: 'Amsterdam', status: venueStatus.active });

/** A second event in the same room, which is one pin and two lines in its popup. */
const SAME_ROOM = event({
  dateStart: new Date(2026, 5, 6), title: 'Late Set', venue: 'Paradiso', city: 'Amsterdam',
  status: status.confirmed, upcoming: scope.upcoming, when: 'Sat 6 Jun 2026',
});

/** What the sheet computes for `PUBLISHED`, in the columns the formula builds. */
const ONE_GOOD_ROW = [['Paradiso — Amsterdam', 'Fri 5 Jun 2026 · Open Stage',
  'Weteringschans 6, 1017 SG Amsterdam, Netherlands', 'https://paradiso.nl']];

/**
 * Runs `refreshMapExport` and hands back the tab it wrote and the one report it would have shown.
 *
 * `headers` defaults to the contract but can be widened, which is how the stale-column branch is
 * reached: a column left over from an earlier contract, with a header a formula change cannot clear.
 */
function refresh({
  events = [PUBLISHED],
  venues = [PARADISO],
  spill = ONE_GOOD_ROW,
  headers = CONFIG.mapExport.headers,
  separator = ',',
} = {}) {
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    tabs: {
      mapExport: { headers: headers, rows: [], spill: spill },
      events: events,
      venues: venues,
    },
  });
  const notified = [];
  const restore = installFakes({
    spreadsheet: spreadsheet,
    properties: { [SEPARATOR_KEY]: separator },
    notified: notified,
  });
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

/* ── where it writes ───────────────────────────────────────────────────────────────────────── */

test('the formula is written to A2, the one cell a spilled formula can start from', () => {
  // Row 1 is the headers; the block spills down and right from here.
  const { sheet } = refresh({});
  assert.deepStrictEqual(sheet.formulas.map(written => [written.row, written.column]), [[2, 1]]);
});

test('the formula written is the map export formula, in the sheet\'s own dialect', () => {
  // `setFormula` stores whatever string it is given, including one whose separators the locale
  // rejects — `#ERROR!` in the cell and no exception anywhere.
  const { sheet } = refresh({ separator: ';' });
  const raw = src.mapExportFormula_();
  assert.strictEqual(sheet.formulas[0].formula, src.localizeFormula_(raw, ';'));
  assert.notStrictEqual(sheet.formulas[0].formula, raw,
    'the formula was stored untranslated, which is #ERROR! in a semicolon locale');
});

test('row 1 is the configured headers, frozen, and styled as a header', () => {
  const { sheet } = refresh({});
  assert.deepStrictEqual(sheet.grid[0].slice(0, CONFIG.mapExport.headers.length),
    CONFIG.mapExport.headers);
  assert.strictEqual(sheet.frozenRows, 1);
  const background = sheet.formats.find(format => format.style === 'setBackground');
  assert.strictEqual(background.value, CONFIG.style.palette.primary);
  assert.strictEqual(background.row, 1, 'the header styling was applied to the wrong row');
});

test('a column left over past the contract is cleared, its header included', () => {
  // Spilled values vanish with their formula; a header does not. A leftover header is a field My
  // Maps imports as an empty row in every popup.
  const { sheet, report } = refresh({
    headers: [...CONFIG.mapExport.headers, 'Retired Field', 'Older Still'],
  });
  assert.match(report, /Cleared 2 column\(s\) past the contract, headers included/);
  assert.strictEqual(sheet.grid[0][4], '', 'the stale header is still there');
  assert.strictEqual(sheet.grid[0][5], '', 'the stale header is still there');
});

/* ── the report, which is the whole of what a maintainer acts on ────────────────────────────── */

test('a clean rebuild counts the rows, the expected rows, and ticks', () => {
  const { report } = refresh({});
  assert.match(report, /1 row\(s\), 1 expected, 0 error cell\(s\) ✓/);
  assert.strictEqual(report.includes('DO NOT IMPORT'), false, 'a clean tab was called unimportable');
});

test('an error cell in any column stops the import, not only in the first', () => {
  // A spilled formula fails per column, so reading `A2` alone can find the title column computing
  // perfectly while the next two are #VALUE! on every row.
  const { report } = refresh({
    spill: [['Paradiso — Amsterdam', '#VALUE!', '#REF!', 'https://paradiso.nl']],
  });
  assert.match(report, /1 row\(s\), 1 expected, 2 error cell\(s\) ⚠/);
  assert.match(report, /DO NOT IMPORT this tab — the map would take the errors as place names/);
});

test('a row count that disagrees with the events tab stops the import', () => {
  // Both numbers come from the same run, so a disagreement means the tab computed something other
  // than what publishes — not visible in any single cell. Two venues, because the count is venues.
  const elsewhere = event({ dateStart: new Date(2026, 5, 6), title: 'Late Set',
    venue: 'De Nieuwe Anita', city: 'Amsterdam', status: status.confirmed,
    upcoming: scope.upcoming });
  const { report } = refresh({ events: [PUBLISHED, elsewhere], spill: ONE_GOOD_ROW });
  assert.match(report, /1 row\(s\), 2 expected, 0 error cell\(s\) ⚠/);
  assert.match(report, /DO NOT IMPORT/);
});

/* ── one pin per venue ──────────────────────────────────────────────────────────────────────── */

test('two events in one room are one expected row, and the report says so', () => {
  // The count the import is refused on: counting events would refuse the tab the formula builds.
  const { report } = refresh({
    events: [PUBLISHED, SAME_ROOM],
    spill: [['Paradiso — Amsterdam',
      '• Fri 5 Jun 2026 · Open Stage\r\n• Sat 6 Jun 2026 · Late Set',
      'Weteringschans 6, 1017 SG Amsterdam, Netherlands', 'https://paradiso.nl']],
  });
  assert.match(report, /1 row\(s\), 1 expected, 0 error cell\(s\) ✓/);
  assert.match(report, /One pin per venue: 2 upcoming event\(s\) at 1 venue\(s\)/);
  assert.strictEqual(report.includes('DO NOT IMPORT'), false,
    'a tab holding one pin for two events at one venue was called unimportable');
});

test('two spellings of one venue are one expected row, as the sheet resolves them', () => {
  // The formula resolves every venue through the lookup before `UNIQUE` compares it, and the lookup
  // folds case as every name resolution in this sheet does. A count that does not fold it refuses an
  // importable tab the day someone types a venue in lower case.
  const { report } = refresh({
    events: [PUBLISHED, event({ dateStart: new Date(2026, 5, 6), title: 'Late Set',
      venue: 'paradiso', city: 'Amsterdam', status: status.confirmed, upcoming: scope.upcoming })],
  });
  assert.match(report, /1 row\(s\), 1 expected/);
});

test('two spellings of a venue the venues tab does not hold are two expected rows', () => {
  // The lookup only folds case for a name it resolves. An unlisted one keeps the spelling it was
  // typed in and `UNIQUE` compares those as typed, so two pins on one coordinate is what the formula
  // built; folding them together refuses that tab over a row `Check data` already names.
  const unlisted = spelling => event({ dateStart: new Date(2026, 5, 5), title: `At ${spelling}`,
    venue: spelling, city: 'Amsterdam', status: status.confirmed, upcoming: scope.upcoming });
  const { report } = refresh({
    events: [unlisted('The Back Room'), unlisted('the back room')],
    spill: [
      ['The Back Room — Amsterdam', 'Fri 5 Jun 2026 · At The Back Room',
        'The Back Room, Amsterdam, Netherlands', ''],
      ['the back room — Amsterdam', 'Fri 5 Jun 2026 · At the back room',
        'the back room, Amsterdam, Netherlands', ''],
    ],
  });
  assert.match(report, /2 row\(s\), 2 expected, 0 error cell\(s\) ✓/);
  assert.strictEqual(report.includes('DO NOT IMPORT'), false,
    'a tab holding the pins the formula builds was called unimportable');
});

test('a tab that computed nothing at all is reported as nothing, not as an error', () => {
  const { report } = refresh({ events: [], spill: [] });
  assert.match(report, /0 row\(s\), 0 expected, 0 error cell\(s\) ✓/);
});

test('an empty tab is not explained as no events at no venues', () => {
  // The line exists to stop a row count being read as an event count. With nothing placed there is
  // no count to explain, and the line above already says the tab is empty.
  const { report } = refresh({ events: [], spill: [] });
  assert.strictEqual(report.includes('One pin per venue'), false,
    'an empty tab was explained as one pin per venue for no venues');
});

/* ── the two venue-less lists, which mean opposite things ───────────────────────────────────── */

test('a concept event with no venue is named as expected, not as a gap', () => {
  const { report } = refresh({
    events: [event({ dateStart: new Date(2026, 5, 5), title: 'Somewhere Soon',
      status: status.concept, upcoming: scope.upcoming })],
    spill: [],
  });
  assert.match(report, new RegExp(`${status.concept}, venue still to be announced: Somewhere Soon`));
  assert.match(report, /Expected, not a gap/);
  assert.strictEqual(report.includes('⚠ ' + status.confirmed + ' with no venue'), false,
    'a concept event was listed as a hole in the sheet');
});

test('a confirmed event with no venue is a hole in the sheet, and says so', () => {
  const { report } = refresh({
    events: [event({ dateStart: new Date(2026, 5, 5), title: 'Roomless',
      status: status.confirmed, upcoming: scope.upcoming })],
    spill: [],
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
      event({ dateStart: new Date(2026, 5, 5), title: 'Announced', status: status.concept,
        upcoming: scope.upcoming }),
      event({ dateStart: new Date(2026, 5, 6), title: 'Roomless', status: status.confirmed,
        upcoming: scope.upcoming }),
    ],
    spill: [],
  });
  assert.match(report, /to be announced: Announced/);
  assert.match(report, /with no venue, so left off the map: Roomless/);
  assert.strictEqual(/to be announced:[^\n]*Roomless/.test(report), false,
    'the confirmed event was excused along with the concept one');
});

test('a venue-less event is not counted as an expected map row', () => {
  const { report } = refresh({
    events: [PUBLISHED, event({ dateStart: new Date(2026, 5, 6), title: 'Roomless',
      status: status.confirmed, upcoming: scope.upcoming })],
    spill: ONE_GOOD_ROW,
  });
  assert.match(report, /1 row\(s\), 1 expected/);
});

/* ── the pin that lands in the wrong place ──────────────────────────────────────────────────── */

test('a venue with no address is named, because its pin lands on the city centre', () => {
  // Counting commas cannot tell an approximate location from an exact one, so this asks the venues
  // tab: the difference is a pin on the door or a pin in the town square.
  const { report } = refresh({
    events: [event({ dateStart: new Date(2026, 5, 5), title: 'House Concert',
      venue: 'The Back Room', city: 'Amsterdam', status: status.confirmed,
      upcoming: scope.upcoming })],
    venues: [venue({ name: 'The Back Room', city: 'Amsterdam', status: venueStatus.active })],
    spill: [['The Back Room — Amsterdam', 'Fri 5 Jun 2026 · House Concert',
      'The Back Room, Amsterdam, Netherlands', '']],
  });
  assert.match(report,
    /Geocoding by venue name, so the pin lands on the city centre: The Back Room/);
});

test('a venue with an address is not named as approximate', () => {
  const { report } = refresh({});
  assert.strictEqual(report.includes('Geocoding by venue name'), false,
    'an exactly located venue was reported as approximate');
});

test('only the addressless venue is named, not every pin on the tab', () => {
  // One addressless venue must not tar the whole tab: a list that names every pin identifies
  // none of them.
  const { report } = refresh({
    events: [PUBLISHED, event({ dateStart: new Date(2026, 5, 6), title: 'House Concert',
      venue: 'The Back Room', city: 'Amsterdam', status: status.confirmed,
      upcoming: scope.upcoming })],
    venues: [PARADISO, venue({ name: 'The Back Room', city: 'Amsterdam',
      status: venueStatus.active })],
    spill: [
      ONE_GOOD_ROW[0],
      ['The Back Room — Amsterdam', 'Sat 6 Jun 2026 · House Concert',
        'The Back Room, Amsterdam, Netherlands', ''],
    ],
  });
  assert.match(report, /city centre: The Back Room/);
  assert.strictEqual(/city centre:[^\n]*Paradiso/.test(report), false,
    'a venue with a full address was named as geocoding by name');
});

test('an addressless venue with nothing booked in it is not named, since it has no pin', () => {
  // This report is about the pins the run produced; an unused lookup row is Check data's business.
  const { report } = refresh({
    venues: [PARADISO, venue({ name: 'The Back Room', city: 'Amsterdam',
      status: venueStatus.active })],
  });
  assert.strictEqual(report.includes('Geocoding by venue name'), false,
    'a venue with no events was reported as a misplaced pin');
});

test('a venue whose name merely prefixes another is not named as approximate', () => {
  // The pin belongs to `The Back Room Annex`, which has an address. Matching the addressless
  // `The Back Room` by anything looser than the whole name reports a pin that is exactly right.
  const { report } = refresh({
    events: [event({ dateStart: new Date(2026, 5, 6), title: 'At The Annex',
      venue: 'The Back Room Annex', city: 'Amsterdam', status: status.confirmed,
      upcoming: scope.upcoming })],
    venues: [
      venue({ name: 'The Back Room', city: 'Amsterdam', status: venueStatus.active }),
      venue({ name: 'The Back Room Annex', address: 'Kade 9', postcode: '1011 AA',
        city: 'Amsterdam', status: venueStatus.active }),
    ],
    spill: [['The Back Room Annex — Amsterdam', 'Sat 6 Jun 2026 · At The Annex',
      'Kade 9, 1011 AA Amsterdam, Netherlands', '']],
  });
  assert.strictEqual(report.includes('Geocoding by venue name'), false,
    'a prefix of another venue name was treated as a match');
});

/* ── the instructions, which are the point of the dialog ────────────────────────────────────── */

test('the report names the columns the import has to be pointed at', () => {
  // The position column is the geocodable line, wherever it sits. Pointed at the column beside it,
  // My Maps geocodes venue names or URLs and puts every pin somewhere plausible and wrong.
  const headers = CONFIG.mapExport.headers;
  const { report } = refresh({});
  assert.match(report, new RegExp(`Columns: ${headers.join(' \\| ')}`));
  assert.match(report,
    new RegExp(`position column\\s+"${headers[src.mapExportColumns_().indexOf('location')]}"`));
  assert.match(report,
    new RegExp(`title column "${headers[src.mapExportColumns_().indexOf('venue')]}"`));
});

test('the report says the layer must be deleted, not just re-imported', () => {
  // My Maps only appends to a layer's field list, so a column that has gone from this tab stays in
  // the popup until the layer is replaced. A re-import alone leaves a stale empty row.
  const { report } = refresh({});
  assert.match(report, /Deleting the layer is not optional/);
  assert.match(report, /only ever appends/);
});

/* ── refusals ───────────────────────────────────────────────────────────────────────────────── */

test('a missing map export tab is refused by name rather than written elsewhere', () => {
  const spreadsheet = fakeSpreadsheet(CONFIG, { tabs: { events: [], venues: [] } });
  const restore = installFakes({
    spreadsheet: spreadsheet, properties: { [SEPARATOR_KEY]: ',' }, notified: [],
  });
  try {
    assert.throws(() => src.refreshMapExport(),
      new RegExp(`No "${CONFIG.tabs.mapExport}" tab`));
  } finally {
    restore();
  }
});

test('a fixture that does not say what the formula computes is refused by the fake', () => {
  // An unstated spill would read as a tab that computed nothing, and the whole report would then
  // be asserted against a formula that never ran.
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    tabs: { mapExport: { headers: CONFIG.mapExport.headers, rows: [] }, events: [], venues: [] },
  });
  const restore = installFakes({
    spreadsheet: spreadsheet, properties: { [SEPARATOR_KEY]: ',' }, notified: [],
  });
  try {
    assert.throws(() => src.refreshMapExport(), /gave no `spill`/);
  } finally {
    restore();
  }
});
