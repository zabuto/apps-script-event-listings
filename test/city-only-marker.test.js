/**
 * `cityOnlyMarker_`, the JavaScript half of the city-only vocabulary.
 *
 * One list in `CONFIG.privacy.cityOnlyMarkers` drives two consequences — a venue marked city-only is
 * never nagged for a missing address, and a street number on one is reported as a privacy breach —
 * and it reaches the sheet three ways: as this regular expression for `checkData`, as a formula by
 * `venueAddresslessByDesign_` for the conditional formats, and as the `FILTER` in the
 * `Venue without an address` block. All three must agree, so the cases here deliberately mirror the
 * ones in `formula-dialect.test.js`, and `reportVenuesFormatting_` — which tells a maintainer which
 * rows those rules will paint — is held to the same answer at the end.
 *
 * The empty list is the case worth having a file for. `new RegExp('')` matches everything, which is
 * the precise inverse of what an empty vocabulary means, and it is reachable by clearing a setting
 * an installer owns.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor } = require('./helpers/fakes');

const src = loadProject('src');
const boot = loadProject('bootstrap');
const CONFIG = src.CONFIG;

/** Runs `cityOnlyMarker_` against a temporary marker list. */
function markerFor(markers) {
  const saved = CONFIG.privacy.cityOnlyMarkers;
  CONFIG.privacy.cityOnlyMarkers = markers;
  try {
    return src.cityOnlyMarker_();
  } finally {
    CONFIG.privacy.cityOnlyMarkers = saved;
  }
}

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('an empty marker list matches nothing, not everything', () => {
  // `new RegExp('')` matches every string, so an installer who clears the setting would have every
  // venue treated as city-only: `checkData` stops reporting a missing address at all, and every
  // venue with a street number is reported as a breach to go and delete. The empty list has to mean
  // "no venue is city-only" — which is what the formula side already does by falling back to FALSE.
  const marker = markerFor([]);
  assert.strictEqual(marker.test(''), false);
  assert.strictEqual(marker.test('Ground floor, ring the bell'), false,
    'an empty marker list is matching every note — every venue now counts as city-only');
  assert.strictEqual(marker.test('house show'), false,
    'a phrase matches although it is not in the list');
});

test('the empty list agrees with the formula spelling of the same setting', () => {
  // The invariant the docstring on CONFIG.privacy.cityOnlyMarkers claims: one vocabulary, and the
  // two consequences cannot disagree. `venueAddresslessByDesign_` is asserted to fall back to FALSE
  // in formula-dialect.test.js; this is the same statement about the other half.
  const boot = loadProject('bootstrap');
  const savedMarkers = boot.CONFIG.privacy.cityOnlyMarkers;
  const savedVenues = boot.CONFIG.privacy.addresslessByDesign;
  boot.CONFIG.privacy.cityOnlyMarkers = [];
  boot.CONFIG.privacy.addresslessByDesign = [];
  try {
    const nothingMatchesInAFormula = boot.venueAddresslessByDesign_() === 'FALSE';
    const nothingMatchesInJs = markerFor([]).test('house show') === false;
    assert.strictEqual(nothingMatchesInJs, nothingMatchesInAFormula,
      'the sheet and the script disagree about what an empty marker list means');
  } finally {
    boot.CONFIG.privacy.cityOnlyMarkers = savedMarkers;
    boot.CONFIG.privacy.addresslessByDesign = savedVenues;
  }
});

/* ── what the list is for, still working ────────────────────────────────────────────────────── */

test('a note carrying a shipped marker is city-only', () => {
  const marker = src.cityOnlyMarker_();
  for (const phrase of CONFIG.privacy.cityOnlyMarkers) {
    assert.strictEqual(marker.test(`Booked as a ${phrase}, no street address`), true,
      `"${phrase}" is configured as a marker but does not match`);
  }
});

test('an ordinary note is not city-only', () => {
  const marker = src.cityOnlyMarker_();
  assert.strictEqual(marker.test('Load-in through the side door after 18:00'), false);
  assert.strictEqual(marker.test(''), false);
});

test('a marker is matched whatever the case, because a maintainer types it by hand', () => {
  assert.strictEqual(markerFor(['house show']).test('HOUSE SHOW — ask first'), true);
});

test('a marker is matched as a whole phrase, not as a regular expression', () => {
  // The escaping in cityOnlyMarker_ is what makes this true, and the setting's own note explains
  // why substrings are not an option: `house|home|huis` flags a public bar named `-huis`.
  const marker = markerFor(['house show (by arrangement)']);
  assert.strictEqual(marker.test('house show (by arrangement)'), true);
  assert.strictEqual(marker.test('house show by arrangement'), false,
    'the parentheses were treated as a group rather than as text');
  assert.strictEqual(markerFor(['a.b']).test('axb'), false, 'the dot matched any character');
});

/* ── the read-back, which reports on the rules above ────────────────────────────────────────── */

/*
 * `reportVenuesFormatting_` exists because a conditional format rule is invisible to a log: it says
 * which rows the two rules it just wrote will actually paint. That makes it a fourth evaluation of
 * the same vocabulary, and the one a maintainer reads instead of the sheet — so a disagreement here
 * is a run reporting confidently on a sheet that does something else.
 */

/** Runs `reportVenuesFormatting_` over a venues tab and hands back the lines it logged. */
function readBack(venues, { markers = null, byDesign = null } = {}) {
  const savedMarkers = boot.CONFIG.privacy.cityOnlyMarkers;
  const savedByDesign = boot.CONFIG.privacy.addresslessByDesign;
  if (markers) boot.CONFIG.privacy.cityOnlyMarkers = markers;
  if (byDesign) boot.CONFIG.privacy.addresslessByDesign = byDesign;

  const spreadsheet = fakeSpreadsheet(boot.CONFIG, { tabs: { venues: venues } });
  const restore = installFakes({ spreadsheet });
  boot.log_.length = 0;
  try {
    boot.reportVenuesFormatting_(spreadsheet);
    return boot.log_.join('\n');
  } finally {
    restore();
    boot.CONFIG.privacy.cityOnlyMarkers = savedMarkers;
    boot.CONFIG.privacy.addresslessByDesign = savedByDesign;
  }
}

const ADDRESSLESS = boot.CONFIG.values.venueStatus.active;
const venueRow = values => rowFor(boot.CONFIG, 'venues', values);

test('an empty marker list leaves the read-back nagging, rather than exempting every venue', () => {
  // The inversion at the top of this file, reached through the reporting path: `new RegExp('')`
  // matches every note, so every incomplete venue reads as deliberate and the line a maintainer
  // checks says there is nothing to finish.
  const report = readBack([venueRow({ name: 'Somewhere', city: 'Amsterdam', status: ADDRESSLESS })],
    { markers: [], byDesign: [] });
  assert.match(report, /incomplete address: 1 — Somewhere/);
  assert.match(report, /addressless by design: none/);
});

test('a marked venue is still reported as by design, so the exemption has not been lost', () => {
  const report = readBack([venueRow({ name: 'Somewhere', city: 'Amsterdam', status: ADDRESSLESS,
    notesPrivate: 'house show — ask first' })], { markers: ['house show'], byDesign: [] });
  assert.match(report, /addressless by design: Somewhere/);
  assert.match(report, new RegExp(`incomplete address: ${CONFIG.values.clean}`));
});

test('a venue named in addresslessByDesign is exempted whatever its case', () => {
  // The sheet's own rule is `$A2="…"`, which ignores case; a read-back that compares raw describes
  // a different sheet from the one the rule paints. The marker list is deliberately not empty: an
  // empty one matches every note, which would exempt this venue by the wrong route and prove
  // nothing about its name.
  const report = readBack([venueRow({ name: 'the back room', city: 'Amsterdam',
    status: ADDRESSLESS })], { markers: ['house show'], byDesign: ['The Back Room'] });
  assert.match(report, /addressless by design: the back room/);
  assert.match(report, new RegExp(`incomplete address: ${CONFIG.values.clean}`));
});
