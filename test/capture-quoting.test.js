/**
 * `quote_`, and the generated `SeedData.gs` parsing at all.
 *
 * `captureSheetData` turns the live sheet back into JavaScript source, which a maintainer pastes
 * into `SeedData.gs` and pushes. Everything it emits has to be a string literal node first and a
 * readable one second: a backslash or a line break written through unescaped does not produce a
 * wrong seed, it produces a file that does not parse — and in Apps Script a syntax error in one file
 * takes every function in the project with it, including the ones that would repair the sheet.
 *
 * The notes columns are where this bites. They are free text, typed by hand, and Alt+Enter puts a
 * real newline in the cell.
 *
 * The assertions here parse what `quote_` emits and compare the value that comes back, rather than
 * matching the text: how a value is spelled is `quote_`'s business, what it round-trips to is the
 * contract.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, rowFor, formatDate } = require('./helpers/fakes');

const boot = loadProject('bootstrap');

/** `Utilities` for the stretch of a test that reaches a date — the seed builders and `isoOrBlank_`. */
function withUtilities(body) {
  const saved = globalThis.Utilities;
  const had = 'Utilities' in globalThis;
  globalThis.Utilities = { formatDate: formatDate };
  try {
    return body();
  } finally {
    if (had) globalThis.Utilities = saved;
    else delete globalThis.Utilities;
  }
}

/** What a generated literal evaluates to, whatever its spelling. */
function evaluate(literal) {
  return new Function(`return (${literal});`)();
}

/** The value a generated literal evaluates back to — the only thing the paste has to preserve. */
function roundTrip(value) {
  const emitted = boot.quote_(value);
  let parsed;
  try {
    parsed = new Function(`return (${emitted});`)();
  } catch (err) {
    assert.fail(`quote_(${JSON.stringify(String(value))}) emitted ${JSON.stringify(emitted)}, ` +
      `which is not parseable JavaScript: ${err.message}`);
  }
  assert.strictEqual(typeof parsed, 'string',
    `quote_ emitted ${JSON.stringify(emitted)}, which is not a string literal`);
  return parsed;
}

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('a line break in a notes cell survives being written out as source', () => {
  // Alt+Enter in a cell. Written into a single-quoted literal verbatim it is an unterminated
  // string, so the pasted SeedData.gs stops the whole project from loading.
  assert.strictEqual(roundTrip('Ask for Jo\nSide door after 18:00'),
    'Ask for Jo\nSide door after 18:00');
  assert.strictEqual(roundTrip('first\r\nsecond'), 'first\nsecond',
    'a Windows line ending came back as something other than one break');
});

test('a backslash is escaped rather than left to escape the closing quote', () => {
  assert.strictEqual(roundTrip('path C:\\'), 'path C:\\');
  assert.strictEqual(roundTrip('a\\b'), 'a\\b');
});

test('a value carrying both an apostrophe and a backslash still closes its literal', () => {
  // The double-quoted spelling escapes `"` but a trailing `\` would eat the closing quote — the two
  // escapes have to compose, which is why the backslash is handled before the quote is chosen.
  assert.strictEqual(roundTrip("O'Brien \\"), "O'Brien \\");
  assert.strictEqual(roundTrip("'t Voorbeeld \\ back"), "'t Voorbeeld \\ back");
});

/* ── what the spelling is for ───────────────────────────────────────────────────────────────── */

test('an ordinary value is single-quoted, which is what keeps the pasted seed readable', () => {
  assert.strictEqual(boot.quote_('Beurs van Berlage'), "'Beurs van Berlage'");
});

test('a leading apostrophe switches the literal to double quotes rather than being escaped', () => {
  // `'t Voorbeeld` is a real venue shape here. Escaping it would read as `\'t Voorbeeld` in the
  // file a maintainer has to eyeball; the double-quoted spelling leaves the name itself alone.
  assert.strictEqual(boot.quote_("'t Voorbeeld"), '"\'t Voorbeeld"');
  assert.strictEqual(roundTrip("'t Voorbeeld"), "'t Voorbeeld");
});

test('a double quote inside a double-quoted value is escaped', () => {
  assert.strictEqual(roundTrip('the "Grand" hall of \'t Voorbeeld'),
    'the "Grand" hall of \'t Voorbeeld');
});

test('a value is trimmed, and an absent one is still a valid empty literal', () => {
  assert.strictEqual(roundTrip('  padded  '), 'padded');
  assert.strictEqual(roundTrip(''), '');
  assert.strictEqual(roundTrip(null), '');
  assert.strictEqual(roundTrip(undefined), '');
});

test('a number is written as a string, because that is what the seed reads back', () => {
  assert.strictEqual(roundTrip(1012), '1012');
});

/* ── the same guarantee where it actually lands ─────────────────────────────────────────────── */

test('a captured date is a literal too, and anything that is not a date is an empty one', () => {
  const tz = 'Europe/Amsterdam';
  withUtilities(() => {
    assert.strictEqual(evaluate(boot.isoOrBlank_(new Date('2026-08-12T10:00:00Z'), tz)),
      '2026-08-12');
    assert.strictEqual(evaluate(boot.isoOrBlank_('', tz)), '');
    assert.strictEqual(evaluate(boot.isoOrBlank_('not a date', tz)), '');
  });
});

test('every seeded value already in the repo round-trips, so the shipped seed stays capturable', () => {
  // Re-capturing the sample data is the ordinary workflow, and it has to survive its own contents.
  const values = withUtilities(() => [
    ...boot.seedOrganisers_(),
    ...boot.seedVenues_().flat(),
    ...boot.seedEvents_().flat(),
    ...Object.values(boot.seedVenueDetails_()).flatMap(Object.values),
    ...Object.values(boot.seedOrganiserDetails_()).flatMap(Object.values),
  ].filter(value => typeof value === 'string'));

  assert.ok(values.length, 'no seeded strings were collected, so this proves nothing');
  for (const value of values) assert.strictEqual(roundTrip(value), value.trim());
});

/* ── a boolean column, captured as one ──────────────────────────────────────────────────────── */

/** `seedVenueDetails_` as `captureSheetData` would rewrite it for a one-venue sheet. */
function captureVenue(values) {
  const config = boot.CONFIG;
  const ss = fakeSpreadsheet(config, {
    tabs: { venues: [rowFor(config, 'venues', Object.assign({ name: 'A Living Room' }, values))] },
  });
  const restore = installFakes({ spreadsheet: ss });
  try {
    return boot.detailsFunction_(ss, 'venues', 'seedVenueDetails_');
  } finally {
    restore();
  }
}

test('a ticked box is captured as a boolean, not as a quoted string', () => {
  // `seedSheet` reads this file back through `cityOnlyVenue_`, which is strict: `'true'` under this
  // key writes an unticked box on the next build while reading, on the page, like a ticked one.
  const captured = captureVenue({ cityOnly: true });
  assert.match(captured, /cityOnly: true\b/);
  assert.strictEqual(/cityOnly: ['"]/.test(captured), false,
    `the flag was quoted, so the seed will read it as unticked: ${captured}`);
});

test('nothing but a tick is written down for a boolean column', () => {
  // An unticked box is every other venue's state, and text in the cell is not a decision the sheet
  // reads — writing either one down would put a value in the seed that the seed cannot act on.
  for (const cell of [false, 'TRUE', 'yes', 1]) {
    const captured = captureVenue({ cityOnly: cell, address: 'Kade 1' });
    assert.strictEqual(captured.includes('cityOnly'), false,
      `${JSON.stringify(cell)} was captured as a value for the flag: ${captured}`);
  }
});
