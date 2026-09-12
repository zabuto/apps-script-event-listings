/**
 * `City only?`, the one cell that says *this venue carries a city and nothing more*.
 *
 * One tick, two consequences — the venue is never nagged for a missing address, and a street number
 * on it is reported as a privacy breach — and three readers that have to agree about it: the
 * conditional format through `venueCityOnly_`, the `Venue without an address` block, and `checkData`
 * in the bound project through `cityOnlyVenue_`. A reader that decides differently from the sheet is
 * the two halves of one rule disagreeing, and the disagreement is silent either way round: a venue
 * exempted in the script and nagged by the sheet, or exempted by the sheet while the script reports
 * an address it was told to keep.
 *
 * The case worth having a file for is a cell holding *text*. `Boolean('FALSE')` is true, so any
 * reader looser than a strict comparison reads a pasted `FALSE` as a decision to publish nothing —
 * while the sheet's own `=TRUE` reads the same cell as untouched. Strictness is what keeps the two
 * answering together, and a tick box is what makes strictness enough: there is no phrase to spell
 * and nothing to search for.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor } = require('./helpers/fakes');

const src = loadProject('src');
const boot = loadProject('bootstrap');
const CONFIG = boot.CONFIG;

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('only a ticked box is city-only, so nothing that merely spells it exempts a venue', () => {
  // Each of these reaches a cell by being pasted, imported or typed over the box. The sheet compares
  // them with `=TRUE` and gets FALSE for every one; anything here answering true would exempt a
  // venue the sheet goes on nagging about.
  assert.strictEqual(boot.cityOnlyVenue_(true), true);
  for (const value of ['TRUE', 'true', 'FALSE', 'yes', 'ja', 'x', 1, -1, [], {},
    false, 0, '', null, undefined]) {
    assert.strictEqual(boot.cityOnlyVenue_(value), false,
      `${JSON.stringify(value)} is not a ticked box and was read as one`);
  }
});

test('the sheet is told the same thing the script reads, in the same column', () => {
  // Not a literal `$G2=TRUE`: the letter is whatever the contract makes it, and spelling it here
  // would leave this test passing while the rule pointed at the column beside the flag.
  const letter = boot.columnLetter_('venues', 'cityOnly');
  assert.strictEqual(boot.venueCityOnly_(), `$${letter}2=TRUE`);
});

test('the address check exempts on the flag column and reads no notes', () => {
  // The third reader of the flag, and the one a maintainer works from: the worklist on the Lists
  // tab. A venue is city-only because a box is ticked, never because of a word that happens to
  // appear in a note, so the check reads the flag column and nothing else.
  const check = boot.checkBlocks_().find(entry => entry[1] === 'Venue without an address');
  assert.ok(check,
    'no check block is labelled "Venue without an address" — fix the fixture, not the code');
  assert.ok(check[2].includes(`${boot.colRange_('venues', 'cityOnly')}<>TRUE`),
    `the check does not exempt on the flag column: ${check[2]}`);
  assert.strictEqual(check[2].includes(boot.colRange_('venues', 'notesPrivate')), false,
    'the check is reading the private notes');
});

/* ── the read-back, which reports on the rules above ────────────────────────────────────────── */

/*
 * `reportVenuesFormatting_` exists because a conditional format rule is invisible to a log: it says
 * which rows the two rules it just wrote will actually paint. That makes it a fourth reader of the
 * flag, and the one a maintainer reads instead of the sheet — so a disagreement here is a run
 * reporting confidently on a sheet that does something else.
 */

/** Runs `reportVenuesFormatting_` over a venues tab and hands back the lines it logged. */
function readBack(venues) {
  const spreadsheet = fakeSpreadsheet(CONFIG, { tabs: { venues: venues } });
  const restore = installFakes({ spreadsheet });
  boot.log_.length = 0;
  try {
    boot.reportVenuesFormatting_(spreadsheet);
    return boot.log_.join('\n');
  } finally {
    restore();
  }
}

const ACTIVE = CONFIG.values.venueStatus.active;
const CLEAN = new RegExp(`incomplete address: ${CONFIG.values.clean}`);
const addressless = values =>
  rowFor(CONFIG, 'venues', Object.assign({ city: 'Amsterdam', status: ACTIVE }, values));

test('a ticked venue is reported as city-only rather than as unfinished work', () => {
  const report = readBack([addressless({ name: 'Somewhere', cityOnly: true })]);
  assert.match(report, /city only, so no address expected: Somewhere/);
  assert.match(report, CLEAN);
});

test('an untouched box leaves the venue on the worklist, rather than exempting it', () => {
  // The inversion this file is about, reached through the reporting path: a reader that counts a
  // blank or a `FALSE` as ticked makes every unfinished venue read as deliberate, and the line a
  // maintainer checks says there is nothing left to finish.
  for (const cell of [undefined, false, 'FALSE']) {
    const report = readBack([addressless({ name: 'Somewhere', cityOnly: cell })]);
    assert.match(report, /incomplete address: 1 — Somewhere/);
    assert.match(report, /city only, so no address expected: none/);
  }
});

test('a closed venue is neither, because nobody is going to geocode it', () => {
  const report = readBack([addressless({ name: 'Zaal Zeeburg',
    status: CONFIG.values.venueStatus.closed })]);
  assert.match(report, /closed: 1 — Zaal Zeeburg/);
  assert.match(report, CLEAN);
});

test('a ticked venue that does have a full address is not painted at all', () => {
  // Both rules test incompleteness first, so the flag alone paints nothing: a city-only venue whose
  // address someone has since filled in reads like any other complete row. The privacy consequence
  // is `checkData`'s to report, not a fill's — see `data-check.test.js`.
  const report = readBack([rowFor(CONFIG, 'venues', { name: 'Somewhere', address: 'Kade 1',
    postcode: '1011 AA', city: 'Amsterdam', status: ACTIVE, cityOnly: true })]);
  assert.match(report, /city only, so no address expected: none/);
  assert.match(report, CLEAN);
});

/* ── both projects, one answer ──────────────────────────────────────────────────────────────── */

test('the bound project reads the flag exactly as the scaffolding does', () => {
  // Held by source and by behaviour in `cross-project-helpers.test.js` as well; stated here because
  // this is the file that says what the flag means, and the two copies of the helper are what make
  // one meaning reach both projects.
  for (const value of [true, false, 'TRUE', '', null]) {
    assert.strictEqual(src.cityOnlyVenue_(value), boot.cityOnlyVenue_(value));
  }
});
