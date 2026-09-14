/**
 * The rows the map export is built from: one per date, named for that date.
 *
 * Every assertion is about a value a pin ends up carrying: the map shows what the tab handed it.
 * Where those rows are written is `map-refresh.test.js`.
 *
 * The clock is frozen, because a run is expanded against *today*: read the real one and the row
 * count changes daily.
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
/** Wednesday, mid-morning: far enough from either midnight that the zone is not what is under test. */
const NOW = new Date('2026-06-10T09:00:00Z');
const day = ymd => midnightIn(SHEET_ZONE, ymd);

const TITLE = 0;
const WHEN = 1;
const VENUE = 2;
const ORGANISER = 3;
const LOCATION = 4;

const event = values => rowFor(CONFIG, 'events', Object.assign({
  status: status.confirmed, upcoming: scope.upcoming,
}, values));
const venue = values => rowFor(CONFIG, 'venues', Object.assign({
  status: venueStatus.active,
}, values));

const PARADISO = venue({
  name: 'Paradiso', address: 'Weteringschans 6', postcode: '1017 SG', city: 'Amsterdam',
});

/** `mapExportRows_` over a sheet holding these tabs. */
function build({ events = [], venues = [PARADISO], organisers = [] } = {}) {
  const spreadsheet = fakeSpreadsheet(CONFIG, {
    timeZone: SHEET_ZONE,
    tabs: { events: events, venues: venues, organisers: organisers },
  });
  const restore = installFakes({ spreadsheet: spreadsheet, now: NOW });
  try {
    return src.mapExportRows_();
  } finally {
    restore();
  }
}

/** One confirmed, upcoming event at Paradiso, over the dates given. */
function atParadiso(values) {
  return event(Object.assign({ venue: 'Paradiso', city: 'Amsterdam' }, values));
}

/* ── one row per date ───────────────────────────────────────────────────────────────────────── */

test('a one-day event is one row', () => {
  const built = build({ events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })] });
  assert.strictEqual(built.rows.length, 1);
  assert.strictEqual(built.placed, 1);
});

test('a run is one row per date it covers, ends included', () => {
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-12'), dateEnd: day('2026-06-14'), title: 'Weekender',
    })],
  });
  assert.deepStrictEqual(built.rows.map(row => row[TITLE]), [
    '12-06-26 Weekender',
    '13-06-26 Weekender',
    '14-06-26 Weekender',
  ]);
  // One event over three dates, because the count a maintainer checks against the sheet is events.
  assert.strictEqual(built.placed, 1);
});

test('the dates a run has already spent are not on the map', () => {
  // The event is still upcoming — its last day is ahead — but a pin on a date that has been and
  // gone is one a reader has to work out is past.
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-09'), dateEnd: day('2026-06-11'), title: 'Under Way',
    })],
  });
  assert.deepStrictEqual(built.rows.map(row => row[TITLE]), [
    '10-06-26 Under Way',
    '11-06-26 Under Way',
  ]);
  assert.strictEqual(built.past, 1);
});

test('a run is cut at the configured number of dates, and the cut is reported', () => {
  // A year of pins is what a mistyped end date otherwise becomes.
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-12'), dateEnd: day('2027-06-12'), title: 'Mistyped Year',
    })],
  });
  assert.strictEqual(built.rows.length, CONFIG.mapExport.maxDays);
  assert.deepStrictEqual(built.capped, ['Mistyped Year (366 dates)']);
});

test('an end date before the start is one row, not a negative count', () => {
  // Check data names this row, and the sheet is where it gets fixed. Until then the map shows the
  // start date rather than nothing at all.
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-20'), dateEnd: day('2026-06-12'), title: 'Backwards',
    })],
  });
  assert.deepStrictEqual(built.rows.map(row => row[TITLE]), ['20-06-26 Backwards']);
});

test('the rows are ordered by date, whatever order the events tab is in', () => {
  // The layer panel lists names and nothing else, and a name leads with its date.
  const built = build({
    events: [
      atParadiso({ dateStart: day('2026-06-13'), title: 'Later' }),
      atParadiso({ dateStart: day('2026-06-11'), dateEnd: day('2026-06-12'), title: 'Earlier' }),
    ],
  });
  assert.deepStrictEqual(built.rows.map(row => row[TITLE]), [
    '11-06-26 Earlier',
    '12-06-26 Earlier',
    '13-06-26 Later',
  ]);
});

/* ── what a pin is named ────────────────────────────────────────────────────────────────────── */

test('the date leads the name, spelled as the setting spells it', () => {
  const saved = CONFIG.mapExport.titleDateFormat;
  try {
    CONFIG.mapExport.titleDateFormat = 'yyyy-mm-dd';
    const built = build({
      events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
    });
    assert.strictEqual(built.rows[0][TITLE], '2026-06-12 Open Stage');
  } finally {
    CONFIG.mapExport.titleDateFormat = saved;
  }
});

test('every token the date format may hold is spelled from the configured names', () => {
  const parts = { year: 2026, month: 6, day: 7, weekDay: 0 };
  const spelled = format => {
    const saved = CONFIG.mapExport.titleDateFormat;
    try {
      CONFIG.mapExport.titleDateFormat = format;
      return src.mapDateText_(parts);
    } finally {
      CONFIG.mapExport.titleDateFormat = saved;
    }
  };
  assert.strictEqual(spelled('d-m-y'), '7-6-26');
  assert.strictEqual(spelled('dd-mm-yy'), '07-06-26');
  assert.strictEqual(spelled('dd-mm-yyyy'), '07-06-2026');
  assert.strictEqual(spelled('ddd d mmm yyyy'),
    `${CONFIG.values.dayNames[0]} 7 ${CONFIG.values.monthNames[5]} 2026`);
});

test('a date format this cannot spell is refused rather than printed', () => {
  // Passed through as text it names every pin after the setting: `dddd-mm` would read "dddd-06".
  const saved = CONFIG.mapExport.titleDateFormat;
  try {
    CONFIG.mapExport.titleDateFormat = 'dddd-mm';
    assert.throws(() => src.mapDateText_({ year: 2026, month: 6, day: 7, weekDay: 0 }),
      /named from "dddd"/);
  } finally {
    CONFIG.mapExport.titleDateFormat = saved;
  }
});

test('a name is the date and the title, and nothing else the popup already says', () => {
  // The layer panel truncates, and the city is the last field of `Location` in every popup.
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
  });
  assert.strictEqual(built.rows[0][TITLE], '12-06-26 Open Stage');
  assert.strictEqual(built.rows[0][TITLE].includes('Amsterdam'), false);
});

/* ── what a pin says ────────────────────────────────────────────────────────────────────────── */

test('a one-day event says its own date, in the words the document uses', () => {
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
  });
  assert.strictEqual(built.rows[0][WHEN], 'Fri 12 Jun 2026');
});

test('each date of a run says which day of the run it is', () => {
  // The events tab spells a run as a span, which every pin of it would otherwise repeat while its
  // name says a single date.
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-12'), dateEnd: day('2026-06-14'), title: 'Weekender',
    })],
  });
  assert.deepStrictEqual(built.rows.map(row => row[WHEN]), [
    'Fri 12 Jun 2026 (day 1 of 3)',
    'Sat 13 Jun 2026 (day 2 of 3)',
    'Sun 14 Jun 2026 (day 3 of 3)',
  ]);
});

test('a date left of a run counts from the run, not from what is left of it', () => {
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-09'), dateEnd: day('2026-06-11'), title: 'Under Way',
    })],
  });
  assert.deepStrictEqual(built.rows.map(row => row[WHEN]), [
    'Wed 10 Jun 2026 (day 2 of 3)',
    'Thu 11 Jun 2026 (day 3 of 3)',
  ]);
});

test('clearing the run wording leaves the date alone', () => {
  const saved = CONFIG.mapExport.runDay;
  try {
    CONFIG.mapExport.runDay = '';
    const built = build({
      events: [atParadiso({
        dateStart: day('2026-06-12'), dateEnd: day('2026-06-13'), title: 'Weekender',
      })],
    });
    assert.deepStrictEqual(built.rows.map(row => row[WHEN]),
      ['Fri 12 Jun 2026', 'Sat 13 Jun 2026']);
  } finally {
    CONFIG.mapExport.runDay = saved;
  }
});

/* ── the venue, the organiser and the line that is geocoded ─────────────────────────────────── */

test('the geocodable line is address, postcode, city and country', () => {
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
  });
  assert.strictEqual(built.rows[0][LOCATION],
    `Weteringschans 6, 1017 SG Amsterdam, ${CONFIG.mapExport.countrySuffix}`);
});

test('a venue with no address geocodes by name, and is named as approximate', () => {
  const built = build({
    events: [event({ dateStart: day('2026-06-12'), title: 'House Concert',
      venue: 'The Back Room', city: 'Amsterdam' })],
    venues: [venue({ name: 'The Back Room', city: 'Amsterdam' })],
  });
  assert.strictEqual(built.rows[0][LOCATION],
    `The Back Room, Amsterdam, ${CONFIG.mapExport.countrySuffix}`);
  assert.deepStrictEqual(built.approximate, ['House Concert']);
});

test('a venue with no postcode still plots, on street and city', () => {
  const built = build({
    events: [event({ dateStart: day('2026-06-12'), title: 'Matinee', venue: 'Zaal Zes',
      city: 'Utrecht' })],
    venues: [venue({ name: 'Zaal Zes', address: 'Kade 9', city: 'Utrecht' })],
  });
  assert.strictEqual(built.rows[0][LOCATION], `Kade 9, Utrecht, ${CONFIG.mapExport.countrySuffix}`);
  assert.deepStrictEqual(built.approximate, []);
});

test('the country is appended when set and contributes nothing when cleared', () => {
  const saved = CONFIG.mapExport.countrySuffix;
  const events = [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })];
  try {
    CONFIG.mapExport.countrySuffix = 'Testland';
    assert.ok(build({ events: events }).rows[0][LOCATION].endsWith(', Testland'));

    CONFIG.mapExport.countrySuffix = '';
    const cleared = build({ events: events }).rows[0][LOCATION];
    assert.strictEqual(cleared, 'Weteringschans 6, 1017 SG Amsterdam');
  } finally {
    CONFIG.mapExport.countrySuffix = saved;
  }
});

test('the venue carries its own site, with a scheme My Maps will linkify', () => {
  // A URL column tends to hold bare hosts, and only a URL carrying a scheme becomes a link.
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
    venues: [venue({ name: 'Paradiso', address: 'Weteringschans 6', postcode: '1017 SG',
      city: 'Amsterdam', url: 'paradiso.nl' })],
  });
  assert.strictEqual(built.rows[0][VENUE], 'Paradiso — https://paradiso.nl');
});

test('a site that already has a scheme keeps the one it has', () => {
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
    venues: [venue({ name: 'Paradiso', address: 'Weteringschans 6', postcode: '1017 SG',
      city: 'Amsterdam', url: 'http://paradiso.nl' })],
  });
  assert.strictEqual(built.rows[0][VENUE], 'Paradiso — http://paradiso.nl');
});

test('a venue with no site is the name alone, with no separator left hanging', () => {
  const built = build({
    events: [atParadiso({ dateStart: day('2026-06-12'), title: 'Open Stage' })],
  });
  assert.strictEqual(built.rows[0][VENUE], 'Paradiso');
});

test('the organiser carries a profile link, and a missing handle carries nothing', () => {
  const built = build({
    events: [
      atParadiso({ dateStart: day('2026-06-12'), title: 'Linked', organiser: 'Studio Zuid' }),
      atParadiso({ dateStart: day('2026-06-13'), title: 'Unlinked', organiser: 'Aurora Collective' }),
    ],
    organisers: [
      rowFor(CONFIG, 'organisers', { name: 'Studio Zuid', social: 'studiozuid' }),
      rowFor(CONFIG, 'organisers', { name: 'Aurora Collective' }),
    ],
  });
  assert.strictEqual(built.rows[0][ORGANISER],
    `Studio Zuid — ${CONFIG.social.profileBaseUrl}studiozuid`);
  assert.strictEqual(built.rows[1][ORGANISER], 'Aurora Collective');
});

test('a venue named in another case reaches the venue the sheet resolved', () => {
  // Every name lookup in the sheet folds case, so the map must agree with the City column rather
  // than dropping to geocoding by name.
  const built = build({
    events: [event({ dateStart: day('2026-06-12'), title: 'Open Stage', venue: 'paradiso',
      city: 'Amsterdam' })],
  });
  assert.strictEqual(built.rows[0][LOCATION],
    `Weteringschans 6, 1017 SG Amsterdam, ${CONFIG.mapExport.countrySuffix}`);
  assert.deepStrictEqual(built.approximate, []);
});

/* ── what is left off, and why ──────────────────────────────────────────────────────────────── */

test('an event with no venue has no position, and is kept out', () => {
  const built = build({
    events: [event({ dateStart: day('2026-06-12'), title: 'Roomless', status: status.confirmed })],
  });
  assert.deepStrictEqual(built.rows, []);
  assert.strictEqual(built.placed, 0);
});

test('the two venue-less kinds are kept apart, because they mean opposite things', () => {
  // A concept event is allowed to have no room yet; a confirmed one is a hole in the sheet.
  const built = build({
    events: [
      event({ dateStart: day('2026-06-12'), title: 'Announced', status: status.concept }),
      event({ dateStart: day('2026-06-13'), title: 'Roomless', status: status.confirmed }),
    ],
  });
  assert.deepStrictEqual(built.announced, ['Announced']);
  assert.deepStrictEqual(built.roomless, ['Roomless']);
});

test('what the Upcoming? column excludes never reaches the map', () => {
  const built = build({
    events: [
      atParadiso({ dateStart: day('2026-06-12'), title: 'Published' }),
      atParadiso({ dateStart: day('2026-06-13'), title: 'Cancelled', status: status.cancelled,
        upcoming: scope.cancelled }),
      atParadiso({ dateStart: day('2026-06-01'), title: 'Finished', upcoming: scope.past }),
    ],
  });
  assert.deepStrictEqual(built.rows.map(row => row[TITLE]),
    ['12-06-26 Published']);
});

/* ── the contract the rows are built against ────────────────────────────────────────────────── */

test('the header count is enforced rather than assumed', () => {
  const saved = CONFIG.mapExport.headers;
  CONFIG.mapExport.headers = ['Title', 'When', 'Venue'];
  try {
    assert.throws(() => build({}), /exactly the five columns/);
  } finally {
    CONFIG.mapExport.headers = saved;
  }
});

test('a cap under one date is refused rather than emptying the map', () => {
  const saved = CONFIG.mapExport.maxDays;
  CONFIG.mapExport.maxDays = 0;
  try {
    assert.throws(() => build({}), /an event occupies at least one date/);
  } finally {
    CONFIG.mapExport.maxDays = saved;
  }
});

test('every row has one cell per configured column', () => {
  const built = build({
    events: [atParadiso({
      dateStart: day('2026-06-12'), dateEnd: day('2026-06-13'), title: 'Weekender',
    })],
  });
  for (const row of built.rows) {
    assert.strictEqual(row.length, CONFIG.mapExport.headers.length);
  }
});
