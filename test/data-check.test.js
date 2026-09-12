/**
 * `checkData`, the hygiene check — and what it deliberately stays quiet about.
 *
 * Two failure modes matter here and they pull against each other. A check that misses a real problem
 * lets a confirmed event go out with no date; a check that names a settled decision on every run
 * teaches maintainers to close the dialog unread, at which point it misses everything. The silences
 * are therefore as load-bearing as the reports, and each one is asserted below beside the report it
 * is the exception to.
 *
 * The dialog's text is what is examined, because that is the entire output: `checkData` returns
 * nothing and writes nothing. `notify_` falls back to `console.log` where there is no UI, which
 * `installFakes({ notified })` captures.
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
const organiser = values => rowFor(CONFIG, 'organisers', values);

/** A venue every fixture can point at without tripping a check of its own. */
const KNOWN_VENUE = venue({
  name: 'Beurs van Berlage', address: 'Damrak 243', postcode: '1012 LP', city: 'Amsterdam',
  status: venueStatus.active,
});

/**
 * Runs `checkData` and hands back the one message it would have shown.
 *
 * `lastRow` presents the events tab as the live one is — its array formulas spill the whole column,
 * so `getLastRow()` reports the bottom of the sheet and `table_` hands back a blank tail. See
 * `helpers/fakes.js`.
 */
function report({ events = [], venues = [KNOWN_VENUE], organisers = [], lastRow = null } = {}) {
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    tabs: { events: lastRow ? { rows: events, lastRow: lastRow } : events, venues, organisers },
  });
  const notified = [];
  const restore = installFakes({ spreadsheet, notified });
  try {
    src.checkData();
  } finally {
    restore();
  }
  assert.strictEqual(notified.length, 1,
    `checkData reported ${notified.length} times, expected once`);
  return notified[0];
}

/** The report, asserted to be the all-clear — which is a different thing from reporting nothing. */
function assertClean(fixture, why) {
  assert.match(report(fixture), /No issues found/, why);
}

/* ── nothing wrong ──────────────────────────────────────────────────────────────────────────── */

test('a sheet with nothing wrong says so, rather than saying nothing', () => {
  assert.match(report({
    events: [event({
      dateStart: new Date(2026, 4, 1), title: 'Open Stage', venue: 'Beurs van Berlage',
      organiser: 'Stichting Podium', status: status.confirmed, upcoming: scope.upcoming,
    })],
    organisers: [organiser({ name: 'Stichting Podium', social: 'stichtingpodium' })],
  }), /No issues found/);
});

test('an empty sheet is clean', () => {
  assertClean({ venues: [] });
});

test('an untitled row is a placeholder, not an event with everything missing', () => {
  // Rows are typed into from the top down and a half-filled one is normal. Reporting it would put a
  // problem on screen for every row a maintainer has not got to yet.
  assertClean({ events: [event({ status: status.confirmed })] },
    'an untitled row was reported');
});

/* ── the events tab ─────────────────────────────────────────────────────────────────────────── */

test('a confirmed event with no date is reported', () => {
  assert.match(
    report({ events: [event({ title: 'Nameless Night', venue: 'Beurs van Berlage',
      status: status.confirmed })] }),
    /"Nameless Night" is Confirmed with no date/);
});

test('a concept or cancelled event with no date is not — the date only matters once confirmed', () => {
  for (const state of [status.concept, status.cancelled]) {
    assertClean({ events: [event({ title: 'Maybe In June', venue: 'Beurs van Berlage',
      status: state })] }, `a ${state} event with no date was reported`);
  }
});

test('a confirmed event with no venue is reported', () => {
  assert.match(
    report({ events: [event({ dateStart: new Date(2026, 4, 1), title: 'Roomless',
      status: status.confirmed })] }),
    /"Roomless" is Confirmed with no venue/);
});

test('a concept event with no venue is not — dates are announced before rooms are booked', () => {
  assertClean({ events: [event({ dateStart: new Date(2026, 4, 1), title: 'Roomless',
    status: status.concept })] }, 'a concept event with no venue was reported');
});

test('an end date before the start date is reported', () => {
  assert.match(
    report({ events: [event({ dateStart: new Date(2026, 4, 10), dateEnd: new Date(2026, 4, 3),
      title: 'Backwards', venue: 'Beurs van Berlage', status: status.confirmed })] }),
    /end date is before the start date/);
});

test('an end date equal to the start date is a one-day run, not an error', () => {
  const day = new Date(2026, 4, 10);
  assertClean({ events: [event({ dateStart: day, dateEnd: day, title: 'One Day',
    venue: 'Beurs van Berlage', status: status.confirmed })] });
});

test('a venue that is not on the Venues tab is reported by name', () => {
  assert.match(
    report({ events: [event({ dateStart: new Date(2026, 4, 1), title: 'Somewhere Else',
      venue: 'Typo Hall', status: status.confirmed })] }),
    /unknown venue "Typo Hall"/);
});

test('an organiser that is not on the Organisers tab is reported by name', () => {
  assert.match(
    report({ events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
      venue: 'Beurs van Berlage', organiser: 'Nobody', status: status.confirmed })] }),
    /unknown organiser "Nobody"/);
});

test('an upcoming event booked into a closed venue is reported', () => {
  // The one thing closing a venue can actually break.
  assert.match(
    report({
      events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage', venue: 'Het Slot',
        status: status.confirmed, upcoming: scope.upcoming })],
      venues: [venue({ name: 'Het Slot', address: 'Kade 1', city: 'Utrecht',
        status: venueStatus.closed })],
    }),
    /"Open Stage" is upcoming at "Het Slot", which is closed/);
});

test('a past event at a since-closed venue is not — history may name a venue that has shut', () => {
  assertClean({
    events: [event({ dateStart: new Date(2020, 1, 1), title: 'Long Gone', venue: 'Het Slot',
      status: status.confirmed, upcoming: scope.past })],
    venues: [venue({ name: 'Het Slot', address: 'Kade 1', city: 'Utrecht',
      status: venueStatus.closed })],
  }, 'a past event at a closed venue was reported');
});

/* ── the venues tab, where the privacy rule bites ───────────────────────────────────────────── */

test('a venue with no address is reported', () => {
  assert.match(
    report({ venues: [venue({ name: 'Somewhere', city: 'Amsterdam',
      status: venueStatus.active })] }),
    /"Somewhere" has no address/);
});

test('a city-only venue is not nagged for the address it is never going to have', () => {
  assertClean({ venues: [venue({ name: 'Somewhere', city: 'Amsterdam',
    status: venueStatus.active, cityOnly: true })] },
    'a venue with its City only? box ticked was nagged for an address');
});

test('a box holding text is not ticked, so the venue stays on the worklist', () => {
  // `Boolean('FALSE')` is true, and the sheet's own rule compares with `=TRUE` and gets FALSE. A
  // reader looser than that would exempt a venue the sheet goes on nagging about — and would take
  // the street-number report off the same row, which is the half that protects an address.
  for (const cell of ['TRUE', 'FALSE', 'yes', 1]) {
    assert.match(
      report({ venues: [venue({ name: 'Somewhere', city: 'Amsterdam',
        status: venueStatus.active, cityOnly: cell })] }),
      /"Somewhere" has no address/,
      `${JSON.stringify(cell)} in the box was read as a tick`);
  }
});

test('a closed venue is not nagged either', () => {
  assertClean({ venues: [venue({ name: 'Het Slot', city: 'Utrecht',
    status: venueStatus.closed })] }, 'a closed venue was nagged for an address');
});

test('a street number on a city-only venue is reported — that is the shape a leak takes', () => {
  // It goes public the moment the map is re-imported, so this one names the deadline.
  const message = report({ venues: [venue({ name: 'A Living Room',
    address: 'Prinsengracht 12', city: 'Amsterdam', status: venueStatus.active,
    cityOnly: true })] });
  assert.match(message, /is marked city-only but its address has a street number/);
  assert.match(message, /before the next map refresh/);
});

/**
 * Address fields that identify a building, in the shapes Dutch addresses actually take.
 *
 * The rule is `/\d/` over the whole field: *any* digit, anywhere. A house number is one to five
 * digits and may carry a huisletter and a toevoeging — per the BAG the maximum is 5 + 1 + 4, so
 * `99151A 0001` — may be written as a range, and the field may hold a whole address whose postcode
 * is four digits of its own.
 *
 * The last two carry no house number at all and still have to be caught: a postcode narrows a venue
 * to one side of one block, which is the thing a city-only venue avoids.
 */
const IDENTIFYING_ADDRESSES = [
  'Kade 1',                                 // one digit, and the case /\d\d/ would publish
  'Damrak 243',
  'Weteringschans 6A',                      // huisnummer + huisletter
  'Prinsengracht 12-14',                    // a range, as a door spanning two numbers is written
  'Nieuwezijds Voorburgwal 147hs',          // + toevoeging, here the ground floor
  'Lange Straat 99151A 0001',               // the BAG maximum: 5 digits, a letter, a 4-char addition
  'Weteringschans 6, 1017 SG Amsterdam',    // the whole address in one field
  '1017 SG Amsterdam',                      // no house number, and still one block of one street
];

test('a street number on a city-only venue is reported however the address is written', () => {
  for (const address of IDENTIFYING_ADDRESSES) {
    assert.match(
      report({ venues: [venue({ name: 'A Living Room', address: address, city: 'Amsterdam',
        status: venueStatus.active, cityOnly: true })] }),
      /is marked city-only but its address has a street number/,
      `"${address}" identifies a building and was not reported`);
  }
});

test('a postcode on a city-only venue is reported, whatever its address column holds', () => {
  // The geocoded line is `address, postcode city`, so the postcode publishes one side of one block
  // the moment the address column holds anything — and a place name there is correct, which makes
  // this the combination nobody would look at twice.
  for (const address of ['', 'Amsterdam-Noord']) {
    const message = report({ venues: [venue({ name: 'A Living Room', address: address,
      postcode: '1011 AA', city: 'Amsterdam', status: venueStatus.active, cityOnly: true })] });
    assert.match(message, /is marked city-only but has a postcode/);
    assert.match(message, /before the next map refresh/);
  }
});

test('a postcode on a venue nobody ticked is what the sheet is for', () => {
  assertClean({ venues: [venue({ name: 'Beurs van Berlage', address: 'Damrak 243',
    postcode: '1012 LP', city: 'Amsterdam', status: venueStatus.active })] },
    'an ordinary venue was reported for carrying a postcode');
});

test('a city-only venue carrying only a place name is right, and is left alone', () => {
  // A place name is what a city-only venue is supposed to carry, and reporting one would tell a
  // maintainer to delete correct data. Apostrophes, hyphens and spaces are not digits.
  for (const address of ['Amsterdam', 'Amsterdam-Noord', "'s-Hertogenbosch", 'Bergen op Zoom']) {
    assertClean({ venues: [venue({ name: 'A Living Room', address: address, city: 'Amsterdam',
      status: venueStatus.active, cityOnly: true })] },
      `"${address}" is a place name and was reported as a street number`);
  }
});

test('an address on a venue nobody ticked is nobody\'s business to report', () => {
  // The street-number report is the flag's second consequence, not a rule about addresses: every
  // other venue in the sheet is supposed to carry one.
  assertClean({ venues: [venue({ name: 'Beurs van Berlage', address: 'Damrak 243',
    postcode: '1012 LP', city: 'Amsterdam', status: venueStatus.active })] },
    'a venue with an ordinary address was reported as a breach');
});

/* ── the organisers tab ─────────────────────────────────────────────────────────────────────── */

test('a handle typed with its @ is reported, because the link is built from it', () => {
  assert.match(
    report({ organisers: [organiser({ name: 'Stichting Podium', social: '@stichtingpodium' })] }),
    new RegExp(`"Stichting Podium" — drop the @ from the ${CONFIG.social.label} handle`));
});

test('a handle typed without its @ is right', () => {
  assertClean({ organisers: [organiser({ name: 'Stichting Podium',
    social: 'stichtingpodium' })] });
});

/* ── the report itself ──────────────────────────────────────────────────────────────────────── */

test('problems are counted, and a long list is truncated rather than filling the dialog', () => {
  // A dialog holding 200 lines is a dialog nobody reads to the end of. The count has to be the real
  // one even so, or the truncation would understate the work left.
  const organisers = [];
  for (let i = 0; i < 45; i++) {
    organisers.push(organiser({ name: `Organiser ${i}`, social: `@handle${i}` }));
  }
  const message = report({ organisers });

  assert.match(message, /^45 issue\(s\):/);
  assert.match(message, /…and 5 more/);
  assert.strictEqual(message.includes('"Organiser 39"'), true, 'the 40th problem was dropped');
  assert.strictEqual(message.includes('"Organiser 40"'), false, 'the 41st problem was not truncated');
});

test('exactly 40 problems are all shown, with nothing claimed to be missing', () => {
  const organisers = [];
  for (let i = 0; i < 40; i++) {
    organisers.push(organiser({ name: `Organiser ${i}`, social: `@handle${i}` }));
  }
  const message = report({ organisers });

  assert.match(message, /^40 issue\(s\):/);
  assert.strictEqual(/…and \d+ more/.test(message), false, 'a full list claimed to be truncated');
});

test('every problem names the tab and the row a maintainer has to go and fix', () => {
  const message = report({
    events: [
      event({ title: 'First', status: status.confirmed }),
      event({ title: 'Second', venue: 'Typo Hall', status: status.concept }),
    ],
  });
  assert.match(message, new RegExp(`${CONFIG.tabs.events} row 2:`));
  assert.match(message, new RegExp(`${CONFIG.tabs.events} row 3:`));
});

/* ── the blank tail a live events tab reports ───────────────────────────────────────────────── */

test('the blank rows the array formulas occupy produce no reports of their own', () => {
  // The live tab hands `checkData` about a thousand rows on every run. A dialog of a thousand
  // reports about empty rows is the same outcome as no check at all.
  assertClean({
    events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
      venue: 'Beurs van Berlage', status: status.confirmed, upcoming: scope.upcoming })],
    lastRow: 1000,
  }, 'the blank tail was reported');
});

test('a problem keeps its real row number when a blank row sits above it', () => {
  // The row number is what makes a report actionable, and it is the index into `table_`'s rows
  // plus two. Filtering the empty rows out before the loop would renumber every report below the
  // first gap. The blank row goes above the problem, since below it the difference is invisible.
  const message = report({
    events: [
      event({ status: status.concept }),                    // an untitled placeholder, row 2
      event({ title: 'Second', venue: 'Typo Hall', status: status.concept }),
    ],
    lastRow: 1000,
  });
  assert.match(message, new RegExp(`${CONFIG.tabs.events} row 3: unknown venue "Typo Hall"`));
  assert.match(message, /^1 issue\(s\):/, 'the blank rows contributed reports of their own');
});

test('a blank row among the venues is not reported as a venue with no address', () => {
  // Rows are cleared rather than deleted — it keeps the row heights and the conditional formats —
  // so a gap mid-list is ordinary, and each one would otherwise report as `"" has no address`.
  assertClean({
    venues: [KNOWN_VENUE, venue({}), venue({ name: 'Paradiso', address: 'Weteringschans 6',
      city: 'Amsterdam', status: venueStatus.active })],
  }, 'a cleared venue row was reported');
});

test('a handle with no organiser name is a placeholder, not an @ to be fixed', () => {
  // A social handle typed in before the name is a row someone is still filling in.
  assertClean({ organisers: [organiser({ social: '@orphan' })] },
    'a handle with no name was reported');
});

/* ── names, as the sheet itself compares them ───────────────────────────────────────────────── */

/*
 * Every sheet-side resolution of a venue or organiser name ignores case: `XLOOKUP` fills the `City`
 * column and builds the map popup, `MATCH(…,0)` drives the hygiene checks on the `Lists` tab, and
 * `requireValueInRange` is what the dropdown accepts. Validation cannot keep the two spellings in
 * step — it applies on entry only, `setValues` bypasses it, and recapitalising a name in a lookup tab
 * leaves every row that already named it spelled the old way.
 *
 * So `checkData` compares names the same way, and the consequences run in both directions: a row the
 * rest of the sheet resolves must not be reported, and a closed venue must stay recognised. The
 * second is the one that fails silently, so it is asserted beside the first.
 */

const CLOSED_VENUE = venue({ name: 'De Nieuwe Anita', address: 'Frederik Hendrikstraat 111',
  postcode: '1052 HN', city: 'Amsterdam', status: venueStatus.closed });
const OPEN_VENUE = venue({ name: 'De Nieuwe Anita', address: 'Frederik Hendrikstraat 111',
  postcode: '1052 HN', city: 'Amsterdam', status: venueStatus.active });

test('a venue named in another case is the venue, because everywhere else it is', () => {
  assertClean({
    events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
      venue: '  de nieuwe ANITA  ', status: status.confirmed, upcoming: scope.upcoming })],
    venues: [OPEN_VENUE],
  }, 'a venue the City column and the map both resolve was reported unknown');
});

test('an organiser named in another case is the organiser', () => {
  assertClean({
    events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
      venue: 'Beurs van Berlage', organiser: 'stichting PODIUM', status: status.confirmed })],
    organisers: [organiser({ name: 'Stichting Podium', social: 'stichtingpodium' })],
  }, 'an organiser the map export resolves was reported unknown');
});

test('an upcoming event at a closed venue is reported however the name is capitalised', () => {
  // The silent half: a raw comparison leaves the venue out of `closedVenues` too, so the check that
  // exists for exactly this says nothing at all rather than saying the wrong thing.
  assert.match(
    report({
      events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
        venue: 'de nieuwe anita', status: status.confirmed, upcoming: scope.upcoming })],
      venues: [CLOSED_VENUE],
    }),
    /"Open Stage" is upcoming at "de nieuwe anita", which is closed/);
});

test('the report quotes the spelling in the events row, not the one on the lookup tab', () => {
  // Folding case is for the comparison. A maintainer fixes the cell they typed, so the message has
  // to name what is in it.
  const message = report({
    events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
      venue: 'de nieuwe anita', status: status.confirmed, upcoming: scope.upcoming })],
    venues: [CLOSED_VENUE],
  });
  assert.strictEqual(message.includes('De Nieuwe Anita'), false,
    'the message named the lookup tab\'s spelling instead of the row\'s');
});

test('a name that differs by more than case is still unknown', () => {
  // Case is all that is folded: a typo is a typo.
  assert.match(
    report({
      events: [event({ dateStart: new Date(2026, 4, 1), title: 'Open Stage',
        venue: 'de nieuwe anitas', status: status.confirmed })],
      venues: [OPEN_VENUE],
    }),
    /unknown venue "de nieuwe anitas"/);
});

/* ── what checkData is reading through ──────────────────────────────────────────────────────── */

test('a sheet whose headers no longer match the contract is refused, not checked', () => {
  // The alternative is the worst outcome available here: `checkData` compares every rule against a
  // column one over and reports *clean*, and a check that says clean because it was looking at the
  // wrong column is worse than no check at all. `table_` is what makes that impossible — this is the
  // assertion that it is still in the path.
  const headers = CONFIG.columns.events.map(column => column.header);
  headers[3] = 'Location';
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    tabs: { events: { headers, rows: [] }, venues: [KNOWN_VENUE], organisers: [] },
  });
  const restore = installFakes({ spreadsheet, notified: [] });
  try {
    assert.throws(() => src.checkData(), /does not match the column contract/);
  } finally {
    restore();
  }
});
