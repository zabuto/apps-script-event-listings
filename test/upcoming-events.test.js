/**
 * The agenda's cutoff must be the *sheet's* today, never the script's.
 *
 * A bare `new Date()` resolves in the Apps Script **project's** zone, while dates from
 * `getValues()` arrive as midnight in the **spreadsheet's**. Those are two separate settings and
 * `clasp push` does not reconcile them — `docs/gotchas.md`: the server keeps the project's own
 * `timeZone` and ignores the manifest.
 *
 * Comparing the two directly fails silently and in one direction: an event whose last day is
 * *today* drops out of the published document while the sheet still reports it `Upcoming`, and
 * `docReport_` then blames a row "with no real date", which is never the cause.
 *
 * Node resolves `new Date()` against `process.env.TZ`, and re-reads it per call, so flipping it here
 * stands in exactly for a project sitting on the wrong zone. The contract each test asserts is the
 * one that matters: **whatever the script's zone is, the answer must not change.**
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, midnightIn } = require('./helpers/fakes');

const SHEET_ZONE = 'Europe/Amsterdam';
/** West of the sheet, east of it, and the sheet's own — the three shapes of disagreement. */
const SCRIPT_ZONES = ['America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', SHEET_ZONE];

const project = loadProject('src');
const CONFIG = project.CONFIG;
const scope = CONFIG.values.scope;

/**
 * One instant, read once, shared by the fixtures and by the code under test.
 *
 * Every test here builds a row from its own reading of "today" and then asks `upcomingEvents_` for
 * its reading of the same. Two `new Date()` calls disagree across midnight, and this is the file
 * about a date not depending on when you look at it.
 */
const NOW = new Date();

/** One events row in contract order, so a reordered column breaks the test rather than the meaning. */
function eventRow({ start, end = '', title, venue = '', organiser = '', status, note = '',
                    city = '', when = '', upcoming }) {
  const row = [];
  const put = (key, value) => { row[CONFIG.columns.events.findIndex(c => c.key === key)] = value; };
  put('dateStart', start);
  put('dateEnd', end);
  put('title', title);
  put('venue', venue);
  put('organiser', organiser);
  put('status', status);
  put('notePrivate', note);
  put('city', city);
  put('when', when);
  put('upcoming', upcoming);
  return row;
}

/**
 * Runs `upcomingEvents_` against a sheet fixed in `SHEET_ZONE`, with the script on `scriptZone`.
 *
 * `lastRow` presents the events tab as the live one actually is: its three array formulas spill the
 * whole column, so `getLastRow()` reports a thousand and `table_` hands back a thousand rows with
 * the typed ones at the top. See `helpers/fakes.js`.
 */
function listedUnder(scriptZone, rows, organisers = [], { lastRow = null } = {}) {
  const before = process.env.TZ;
  process.env.TZ = scriptZone;
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    timeZone: SHEET_ZONE,
    tabs: { events: lastRow ? { rows: rows, lastRow: lastRow } : rows, organisers: organisers },
  });
  const restore = installFakes({ spreadsheet: spreadsheet, now: NOW });
  try {
    return project.upcomingEvents_().map(event => event.title);
  } finally {
    restore();
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
}

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('an event whose last day is today is listed, whatever zone the script is on', () => {
  // "Today" is fixed to a date, and the clock is left alone: the point is the *zone*, and a test
  // that also moved the instant would not say which of the two caused a difference.
  const today = midnightIn(SHEET_ZONE, todayIn(SHEET_ZONE));
  const rows = [eventRow({
    start: today, title: 'Ends today', venue: 'Somewhere',
    status: CONFIG.values.eventStatus.confirmed, upcoming: scope.upcoming,
  })];

  for (const zone of SCRIPT_ZONES) {
    assert.deepStrictEqual(listedUnder(zone, rows), ['Ends today'],
      `dropped by a script on ${zone} — the cutoff is following the script's zone again`);
  }
});

test('a multi-day run that ends today is listed, whatever zone the script is on', () => {
  const start = midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), -2));
  const end = midnightIn(SHEET_ZONE, todayIn(SHEET_ZONE));
  const rows = [eventRow({
    start, end, title: 'Started Monday', venue: 'Somewhere',
    status: CONFIG.values.eventStatus.confirmed, upcoming: scope.upcoming,
  })];

  for (const zone of SCRIPT_ZONES) {
    assert.deepStrictEqual(listedUnder(zone, rows), ['Started Monday'],
      `dropped by a script on ${zone}`);
  }
});

test('the listing is identical under every script zone', () => {
  const day = offset => midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), offset));
  const confirmed = CONFIG.values.eventStatus.confirmed;
  const rows = [
    eventRow({ start: day(-1), title: 'Yesterday', status: confirmed, upcoming: scope.past }),
    eventRow({ start: day(0), title: 'Today', status: confirmed, upcoming: scope.upcoming }),
    eventRow({ start: day(1), title: 'Tomorrow', status: confirmed, upcoming: scope.upcoming }),
    eventRow({ start: day(9), title: 'Next week', status: confirmed, upcoming: scope.upcoming }),
  ];

  const answers = SCRIPT_ZONES.map(zone => listedUnder(zone, rows));
  for (const [i, answer] of answers.entries()) {
    assert.deepStrictEqual(answer, ['Today', 'Tomorrow', 'Next week'],
      `script on ${SCRIPT_ZONES[i]} disagreed with the sheet`);
  }
});

/* ── the filter's other guarantees ──────────────────────────────────────────────────────────── */

test('what the Upcoming? column excludes never reaches the document', () => {
  const day = offset => midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), offset));
  const rows = [
    eventRow({ start: day(2), title: 'Published', status: CONFIG.values.eventStatus.confirmed,
      upcoming: scope.upcoming }),
    eventRow({ start: day(2), title: 'Cancelled', status: CONFIG.values.eventStatus.cancelled,
      upcoming: scope.cancelled }),
    eventRow({ start: day(-9), title: 'Finished', status: CONFIG.values.eventStatus.confirmed,
      upcoming: scope.past }),
  ];
  assert.deepStrictEqual(listedUnder(SHEET_ZONE, rows), ['Published']);
});

test('a row the sheet calls upcoming but cannot be sorted is dropped rather than thrown on', () => {
  // A titled row whose date column holds text. It must not reach `sort`, and it must not crash a
  // rebuild halfway through — the whole reason the guard sits after the column filter.
  const rows = [
    eventRow({ start: 'december 2026', title: 'No real date',
      status: CONFIG.values.eventStatus.concept, upcoming: scope.upcoming }),
    eventRow({ start: midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), 3)), title: 'Real',
      status: CONFIG.values.eventStatus.confirmed, upcoming: scope.upcoming }),
  ];
  assert.deepStrictEqual(listedUnder(SHEET_ZONE, rows), ['Real']);
});

/* ── the blank tail the array formulas leave, and the guards for it ─────────────────────────── */

test('the thousand blank rows a live events tab reports are not listed as events', () => {
  // `table_` trusts `getLastRow()`, which on this tab is the bottom of the sheet, so the function
  // receives ~999 blank rows on every run and has to hand back only the two typed ones.
  const day = offset => midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), offset));
  const confirmed = CONFIG.values.eventStatus.confirmed;
  const rows = [
    eventRow({ start: day(1), title: 'Tomorrow', status: confirmed, upcoming: scope.upcoming }),
    eventRow({ start: day(4), title: 'Later', status: confirmed, upcoming: scope.upcoming }),
  ];
  assert.deepStrictEqual(listedUnder(SHEET_ZONE, rows, [], { lastRow: 1000 }),
    ['Tomorrow', 'Later']);
});

test('an untitled row whose Upcoming? cell was overwritten is still not listed', () => {
  // A row reads `Upcoming` with no title only when that computed cell holds a literal instead of
  // the array formula — a state the build treats as real, since `setupFormulas` counts formulas
  // below row 2 in the computed block and flags any as ⚠. Unguarded, the row reaches the document
  // as an event with an empty title, sorted among the real ones by whatever date it carries.
  const rows = [
    eventRow({ start: midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), 1)), title: '',
      venue: 'Somewhere', status: CONFIG.values.eventStatus.confirmed, upcoming: scope.upcoming }),
    eventRow({ start: midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), 2)), title: 'Real',
      status: CONFIG.values.eventStatus.confirmed, upcoming: scope.upcoming }),
  ];
  assert.deepStrictEqual(listedUnder(SHEET_ZONE, rows, [], { lastRow: 1000 }), ['Real']);
});

test('the private note column never reaches a listed event', () => {
  const rows = [eventRow({
    start: midnightIn(SHEET_ZONE, shiftDays(todayIn(SHEET_ZONE), 3)),
    title: 'Open Stage', venue: 'Somewhere', status: CONFIG.values.eventStatus.confirmed,
    note: 'SECRET-NOTE-DO-NOT-PUBLISH', upcoming: scope.upcoming,
  })];

  const before = process.env.TZ;
  process.env.TZ = SHEET_ZONE;
  const spreadsheet = fakeSpreadsheet(CONFIG,
    { timeZone: SHEET_ZONE, tabs: { events: rows, organisers: [] } });
  const restore = installFakes({ spreadsheet: spreadsheet, now: NOW });
  try {
    const listed = project.upcomingEvents_();
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(JSON.stringify(listed).includes('SECRET-NOTE-DO-NOT-PUBLISH'), false,
      'the private note reached an object the document renders');
  } finally {
    restore();
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

/* ── the frozen clock these tests stand on ──────────────────────────────────────────────────── */

test('the clock the fixtures read and the clock the code reads are the same one', () => {
  // A freeze that stopped working would put the midnight flake back with no test going red. The
  // `instanceof` assertion is the one that matters: a freeze built by subclassing `Date` gives the
  // subclass its own prototype, and every fixture date built before it then fails
  // `upcomingEvents_`'s `start instanceof Date` guard and is dropped.
  const RealDate = Date;
  const madeBeforeTheFreeze = new Date(2026, 0, 16);
  const spreadsheet = fakeSpreadsheet(CONFIG, { timeZone: SHEET_ZONE,
    tabs: { events: [], organisers: [] } });
  const restore = installFakes({ spreadsheet: spreadsheet, now: NOW });
  try {
    assert.strictEqual(new Date().getTime(), NOW.getTime(), 'the code under test reads its own now');
    assert.strictEqual(Date.now(), NOW.getTime());
    assert.ok(madeBeforeTheFreeze instanceof Date,
      'a date built before the freeze is no longer a Date, so every dated row would be dropped');
    assert.strictEqual(new Date(2026, 0, 16).getFullYear(), 2026, 'arguments are still honoured');
  } finally {
    restore();
  }
  assert.strictEqual(globalThis.Date, RealDate, 'the real clock was not put back');
});

/* ── small date helpers, in the sheet's zone ────────────────────────────────────────────────── */

function todayIn(zone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(NOW);
}

function shiftDays(ymd, days) {
  const moved = new Date(`${ymd}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}
