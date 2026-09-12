/**
 * What a reseed is allowed to destroy.
 *
 * `seedSheet` regenerates all three data tabs from `SeedData.gs`, so every value a maintainer typed
 * into a column the seed does not own has to be read off the sheet *before* the tab is cleared and
 * written back onto the regenerated rows. That is the whole contract of the three writers, and the
 * private notes are the part of it that matters: they are the one thing in this system that exists
 * nowhere else — not in the repo, not in the map, not in the document.
 *
 * The order is the contract. A writer that clears first harvests a blank sheet, carries nothing
 * over, and still reports a plausible count, because the seed supplies notes of its own. Nothing
 * about the run looks wrong; the notes are simply gone.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor } = require('./helpers/fakes');

const boot = loadProject('bootstrap');
const CONFIG = boot.CONFIG;

const NOTE = 'Ask for Jo at the side door — not for the map';

/** The seed rows, which can only be built with `Utilities` in place. */
function seedRows(name) {
  const restore = installFakes({ spreadsheet: fakeSpreadsheet(CONFIG, { tabs: {} }) });
  try {
    return boot[name]();
  } finally {
    restore();
  }
}

/**
 * A seeded name that `literal_` writes to the cell unchanged.
 *
 * The writers escape a name before storing it, so `'t Blauwe Theehuis` is written as `''t Blauwe
 * Theehuis` — the leading apostrophe Sheets treats as a prefix rather than as text, which the fake
 * grid keeps verbatim. That escaping is `formula-dialect.test.js`'s subject; keying these fixtures
 * to a name it leaves alone keeps the carry-over the only thing under test here.
 */
function plainName(names) {
  const found = names.find(name => boot.literal_(name) === name);
  assert.ok(found, 'every seeded name is escaped on the way in, so none can key a fixture');
  return found;
}

/** Runs one writer over a tab that already holds `rows`, and hands back the grid it left behind. */
function reseed(writer, tabKey, rows) {
  const ss = fakeSpreadsheet(CONFIG, { timeZone: 'Europe/Amsterdam', tabs: { [tabKey]: rows } });
  const sheet = ss.getSheetByName(CONFIG.tabs[tabKey]);
  const restore = installFakes({ spreadsheet: ss });
  try {
    boot[writer](sheet);
  } finally {
    restore();
  }
  return sheet.model.grid.slice(1);
}

/** The written row for a name, found by key rather than by position. */
function rowNamed(grid, tabKey, key, value) {
  const at = boot.columnIndex_(tabKey, key);
  return grid.find(row => row[at] === value);
}

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('a hand-typed private note survives the reseed of the event it is on', () => {
  // The tab is cleared and rewritten from the seed, and the note is on a column the seed also
  // carries — so a writer that harvests after clearing hands back the *seed's* note, which reads as
  // a working carry-over until someone looks for what they typed.
  const [startIso, , title] = seedRows('seedEvents_')[0];
  const grid = reseed('writeEvents_', 'events', [rowFor(CONFIG, 'events', {
    dateStart: new Date(`${startIso}T00:00:00Z`),
    title: title,
    notePrivate: NOTE,
  })]);

  const written = rowNamed(grid, 'events', 'title', title);
  assert.ok(written, `"${title}" is in the seed but was not written back`);
  assert.strictEqual(written[boot.columnIndex_('events', 'notePrivate')], NOTE,
    'the note typed on the sheet was cleared before it could be harvested');
});

test('the same guarantee holds for a venue and for an organiser', () => {
  // Stated for all three writers, not just the events one: the carry-over is the reason any of them
  // may clear a tab at all, so each has to be held to it.
  const venue = plainName(seedRows('seedVenues_').map(row => row[0]));
  const venueGrid = reseed('writeVenues_', 'venues',
    [rowFor(CONFIG, 'venues', { name: venue, notesPrivate: NOTE })]);
  assert.strictEqual(
    rowNamed(venueGrid, 'venues', 'name', venue)[boot.columnIndex_('venues', 'notesPrivate')], NOTE,
    'a venue note typed on the sheet was lost by the reseed');

  const organiser = plainName(seedRows('seedOrganisers_'));
  const organiserGrid = reseed('writeOrganisers_', 'organisers',
    [rowFor(CONFIG, 'organisers', { name: organiser, notesPrivate: NOTE })]);
  assert.strictEqual(
    rowNamed(organiserGrid, 'organisers', 'name', organiser)[
      boot.columnIndex_('organisers', 'notesPrivate')], NOTE,
    'an organiser note typed on the sheet was lost by the reseed');
});

test('the sheet wins over the seed, rather than merely filling a gap it left', () => {
  // The carry-over is not a fallback: a venue the seed has an address for still keeps the address
  // the sheet holds, because the sheet is the authority once anyone has typed into it.
  const venue = plainName(seedRows('seedVenues_').map(row => row[0]));
  const grid = reseed('writeVenues_', 'venues',
    [rowFor(CONFIG, 'venues', { name: venue, address: 'Typed on the sheet 1' })]);
  assert.strictEqual(rowNamed(grid, 'venues', 'name', venue)[boot.columnIndex_('venues', 'address')],
    'Typed on the sheet 1', 'the seed overwrote an address the sheet already held');
});

test('a ticked City only? box survives the reseed of the venue it is on', () => {
  // The flag is the one column on the venues tab with a privacy consequence: losing it in a reseed
  // puts the venue back on the address worklist, and the next person to work the worklist fills in
  // the street the tick existed to keep out of the sheet.
  const seeded = seedRows('seedVenueDetails_');
  const venue = plainName(seedRows('seedVenues_')
    .map(row => row[0])
    .filter(name => !(seeded[name] || {}).cityOnly));
  boot.log_.length = 0;                    // the writers append; this test reads its own run's line
  const grid = reseed('writeVenues_', 'venues',
    [rowFor(CONFIG, 'venues', { name: venue, cityOnly: true })]);

  assert.strictEqual(
    rowNamed(grid, 'venues', 'name', venue)[boot.columnIndex_('venues', 'cityOnly')], true,
    'a tick typed on the sheet was lost by the reseed, and the venue is back on the worklist');

  // The report is the proof: a writer that carried the tick and did not count it reads exactly like
  // one that dropped it, and the count is all anybody sees of a run that touched twelve rows.
  assert.match(boot.log_.join('\n'),
    new RegExp(`carried over from the sheet:.*${boot.headerOf_('venues', 'cityOnly')}`));
});

/* ── what the carry-over may not invent ─────────────────────────────────────────────────────── */

test('an event the sheet knows nothing about keeps the note the seed gives it', () => {
  // The empty sheet is the fresh-build case: nothing to carry, and the seed's own notes still land.
  const seed = seedRows('seedEvents_');
  const withNote = seed.find(event => event[6]);
  assert.ok(withNote, 'no seeded event carries a private note, so this case cannot be stated');

  const grid = reseed('writeEvents_', 'events', []);
  assert.strictEqual(rowNamed(grid, 'events', 'title', withNote[2])[
    boot.columnIndex_('events', 'notePrivate')], withNote[6]);
});

test('a note is keyed to its own event, not spread across the tab', () => {
  const seed = seedRows('seedEvents_');
  const [firstIso, , firstTitle] = seed[0];
  const other = seed.find(event => event[2] !== firstTitle);
  assert.ok(other, 'the seed holds only one event, so this case cannot be stated');

  const grid = reseed('writeEvents_', 'events', [rowFor(CONFIG, 'events', {
    dateStart: new Date(`${firstIso}T00:00:00Z`),
    title: firstTitle,
    notePrivate: NOTE,
  })]);

  const at = boot.columnIndex_('events', 'notePrivate');
  assert.strictEqual(rowNamed(grid, 'events', 'title', firstTitle)[at], NOTE);
  assert.notStrictEqual(rowNamed(grid, 'events', 'title', other[2])[at], NOTE,
    'the note reached an event it was never typed on');
});

test('a note on a row the seed no longer holds is not carried onto some other event', () => {
  // A dropped event takes its note with it. Keying the carry-over on start date plus title is what
  // makes that true — the note has nowhere to land, rather than landing on whatever sorts first.
  const grid = reseed('writeEvents_', 'events', [rowFor(CONFIG, 'events', {
    dateStart: new Date('1999-01-01T00:00:00Z'),
    title: 'An event no longer in the seed',
    notePrivate: NOTE,
  })]);

  const at = boot.columnIndex_('events', 'notePrivate');
  assert.strictEqual(grid.some(row => row[at] === NOTE), false,
    'the note of a dropped event was carried onto a row it does not belong to');
});

/* ── writing past the dropdowns that guard the tab ──────────────────────────────────────────── */

/**
 * The seed's own historical case is the one the venue dropdown refuses.
 *
 * The dropdown lists *active* venues, so a closed one cannot be chosen for a new event — and
 * `SeedData.gs` carries a past event at a venue that has since closed on purpose, because history is
 * allowed to name a venue that has shut. A strict rule refuses a script as readily as a person:
 * `setValues` throws, names one cell, and writes none of the block, so the whole reseed dies on the
 * row that proves the feature.
 */
function activeVenueNames() {
  const closed = CONFIG.values.venueStatus.closed;
  const details = seedRows('seedVenueDetails_');
  return seedRows('seedVenues_')
    .map(venue => venue[0])
    .filter(name => (details[name] || {}).status !== closed)
    .map(name => boot.literal_(name));
}

test('the seed writes an event at a closed venue, which the venue dropdown refuses', () => {
  const venueColumn = boot.columnLetter_('events', 'venue');
  const grid = reseed('writeEvents_', 'events', {
    rows: [],
    validation: { [venueColumn]: activeVenueNames() },
  });

  const closedVenue = seedRows('seedVenues_')
    .map(venue => venue[0])
    .find(name => (seedRows('seedVenueDetails_')[name] || {}).status
      === CONFIG.values.venueStatus.closed);
  const at = boot.columnIndex_('events', 'venue');
  assert.ok(grid.some(row => row[at] === boot.literal_(closedVenue)),
    `no seeded event names "${closedVenue}", so this test no longer covers the case it exists for`);
});

test('the dropdowns are back on the block after the write, not left suspended', () => {
  // Suspending a rule to get a write through and never restoring it would take the refusal off the
  // column for good: the next person typing an unknown venue is accepted, and the sheet stops
  // guaranteeing the one thing the map depends on.
  const venueColumn = boot.columnLetter_('events', 'venue');
  const ss = fakeSpreadsheet(CONFIG, {
    timeZone: 'Europe/Amsterdam',
    tabs: { events: { rows: [], validation: { [venueColumn]: activeVenueNames() } } },
  });
  const sheet = ss.getSheetByName(CONFIG.tabs.events);
  const restore = installFakes({ spreadsheet: ss });
  try {
    boot.writeEvents_(sheet);
  } finally {
    restore();
  }

  const written = sheet.model.grid.length - 1;
  const rules = sheet.getRange(2, boot.columnNumber_('events', 'venue'), written, 1)
    .getDataValidations();
  assert.strictEqual(rules.every(row => row[0] !== null), true,
    'the venue dropdown was left off the rows the seed wrote');
});
