/**
 * The separator translation, and the values that must survive being written into a cell.
 *
 * Both are silent failures in production. A comma-separated formula stores fine in a `;` locale and
 * only then evaluates to `#ERROR!`; a swallowed leading apostrophe turns a lookup key into a
 * different string and every reference to it quietly stops matching.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');

const boot = loadProject('bootstrap');

/* ── localizeFormula_ ───────────────────────────────────────────────────────────────────────── */

test('a comma-locale sheet gets the formula back untouched', () => {
  const formula = '=IF(A1="a, b",1,2)';
  assert.strictEqual(boot.localizeFormula_(formula, ','), formula);
});

test('argument separators outside strings are translated', () => {
  assert.strictEqual(boot.localizeFormula_('=IF(A1=1,2,3)', ';'), '=IF(A1=1;2;3)');
});

test('a comma inside a string literal survives', () => {
  // The country suffix the map export appends is exactly this shape, and it is the reason the
  // translation cannot be a blanket replace.
  assert.strictEqual(
    boot.localizeFormula_('=A1&", Netherlands"', ';'),
    '=A1&", Netherlands"');
});

test('separators are still translated after a string containing a comma', () => {
  assert.strictEqual(
    boot.localizeFormula_('=IF(A1="x, y",TRUE,FALSE)', ';'),
    '=IF(A1="x, y";TRUE;FALSE)');
});

test('a doubled "" escape does not unbalance the string tracking', () => {
  // Sheets escapes a quote by doubling it. The two are adjacent, so no separator can fall between
  // them — but a change to the toggle could easily break that, and it would be invisible.
  assert.strictEqual(
    boot.localizeFormula_('=IF(A1="say ""hi""",1,2)', ';'),
    '=IF(A1="say ""hi""";1;2)');
});

/* ── literal_ ───────────────────────────────────────────────────────────────────────────────── */

test("a leading apostrophe is doubled, so 't Blauwe Theehuis stays itself", () => {
  assert.strictEqual(boot.literal_("'t Blauwe Theehuis"), "''t Blauwe Theehuis");
});

test('a leading = or + is prevented from being read as a formula', () => {
  assert.strictEqual(boot.literal_('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(boot.literal_('+31 20 555 0000'), "'+31 20 555 0000");
});

test('an ordinary value is returned unchanged', () => {
  assert.strictEqual(boot.literal_('Beurs van Berlage'), 'Beurs van Berlage');
  assert.strictEqual(boot.literal_(''), '');
});

test('a non-string is passed through rather than coerced', () => {
  const date = new Date(2026, 0, 16);
  assert.strictEqual(boot.literal_(date), date);
  assert.strictEqual(boot.literal_(42), 42);
});

/* ── countFilled_ ───────────────────────────────────────────────────────────────────────────── */

test('countFilled_ ignores the empty strings a spilled formula leaves behind', () => {
  const range = { getValues: () => [['a'], [''], ['b'], [null], ['']] };
  assert.strictEqual(boot.countFilled_(range), 2);
});

/* ── quoteLiteral_ ──────────────────────────────────────────────────────────────────────────── */

test('an ordinary value becomes a plain quoted literal', () => {
  assert.strictEqual(boot.quoteLiteral_('house show'), '"house show"');
});

test('a quote inside a value is doubled, the way Sheets escapes one', () => {
  assert.strictEqual(boot.quoteLiteral_('the "barn"'), '"the ""barn"""');
});

test('empty and absent values still produce a valid empty literal', () => {
  assert.strictEqual(boot.quoteLiteral_(''), '""');
  assert.strictEqual(boot.quoteLiteral_(null), '""');
  assert.strictEqual(boot.quoteLiteral_(undefined), '""');
});

test('an escaped literal survives separator translation intact', () => {
  // The two quotes of an escape are adjacent, so no separator can fall between them — but the
  // string-tracking toggle is what guarantees that, and it is one edit from being broken.
  const formula = `=IF(A1=${boot.quoteLiteral_('a, "b"')},1,2)`;
  assert.strictEqual(boot.localizeFormula_(formula, ';'), '=IF(A1="a, ""b""";1;2)');
});

/* ── the venue rules, end to end ────────────────────────────────────────────────────────────── */

/**
 * Walks a formula the way a parser would, treating `""` inside a string as one escaped quote.
 * Returns false if a string is left open — the failure a raw interpolation causes.
 */
function stringsAreClosed(formula) {
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    if (formula[i] !== '"') continue;
    if (inString && formula[i + 1] === '"') { i++; continue; }   // an escaped quote
    inString = !inString;
  }
  return !inString;
}

test('a marker or venue name containing a quote still builds a valid rule', () => {
  // The offline formula check cannot catch this on its own: doubling a quote leaves the *count*
  // even, so an unescaped `the "barn"` passes it and fails only in the sheet.
  const savedMarkers = boot.CONFIG.privacy.cityOnlyMarkers;
  const savedVenues = boot.CONFIG.privacy.addresslessByDesign;
  boot.CONFIG.privacy.cityOnlyMarkers = ['house show', 'the "barn"'];
  boot.CONFIG.privacy.addresslessByDesign = ['Cafe "De Hoek"'];
  try {
    const rule = boot.venueAddresslessByDesign_();
    assert.ok(stringsAreClosed(rule), `a string is left open: ${rule}`);
    assert.ok(rule.includes('""barn""'), 'the quote in the marker was not escaped');
    assert.ok(rule.includes('""De Hoek""'), 'the quote in the venue name was not escaped');
  } finally {
    boot.CONFIG.privacy.cityOnlyMarkers = savedMarkers;
    boot.CONFIG.privacy.addresslessByDesign = savedVenues;
  }
});

/** The `Venue without an address` block, which spells the same two lists as a `FILTER`. */
function addressCheck() {
  const block = boot.checkBlocks_().find(entry => entry[1] === 'Venue without an address');
  assert.ok(block, 'the address check is no longer called that — the fixture, not the code');
  return block[2];
}

test('the address check escapes a quote in a marker or a venue name too', () => {
  // The third spelling of these two lists, and the one the offline check is blindest to: it lives
  // inside a `FILTER`, so an unescaped quote parses into a different argument list rather than
  // failing outright, and the block goes on printing something.
  const savedMarkers = boot.CONFIG.privacy.cityOnlyMarkers;
  const savedVenues = boot.CONFIG.privacy.addresslessByDesign;
  boot.CONFIG.privacy.cityOnlyMarkers = ['house show', 'the "barn"'];
  boot.CONFIG.privacy.addresslessByDesign = ['Cafe "De Hoek"'];
  try {
    const check = addressCheck();
    assert.ok(stringsAreClosed(check), `a string is left open: ${check}`);
    assert.ok(check.includes('""barn""'), 'the quote in the marker was not escaped');
    assert.ok(check.includes('""De Hoek""'), 'the quote in the venue name was not escaped');
  } finally {
    boot.CONFIG.privacy.cityOnlyMarkers = savedMarkers;
    boot.CONFIG.privacy.addresslessByDesign = savedVenues;
  }
});

test('the address check and the conditional format rule quote a list the same way', () => {
  // One vocabulary, and the sheet has to be told it identically twice. Asserted against a name that
  // needs escaping, since identical handling of a plain name proves nothing.
  const saved = boot.CONFIG.privacy.addresslessByDesign;
  boot.CONFIG.privacy.addresslessByDesign = ["Cafe 'tis \"Here\""];
  try {
    const quoted = boot.quoteLiteral_(boot.CONFIG.privacy.addresslessByDesign[0]);
    assert.ok(addressCheck().includes(quoted), 'the check spelled the venue name its own way');
    assert.ok(boot.venueAddresslessByDesign_().includes(quoted),
      'the conditional format rule spelled the venue name its own way');
  } finally {
    boot.CONFIG.privacy.addresslessByDesign = saved;
  }
});

test('the shipped config builds an address check whose strings all close', () => {
  assert.ok(stringsAreClosed(addressCheck()));
});

test('an empty marker list falls back to FALSE rather than an empty OR', () => {
  const saved = boot.CONFIG.privacy.cityOnlyMarkers;
  const savedVenues = boot.CONFIG.privacy.addresslessByDesign;
  boot.CONFIG.privacy.cityOnlyMarkers = [];
  boot.CONFIG.privacy.addresslessByDesign = [];
  try {
    assert.strictEqual(boot.venueAddresslessByDesign_(), 'FALSE');
  } finally {
    boot.CONFIG.privacy.cityOnlyMarkers = saved;
    boot.CONFIG.privacy.addresslessByDesign = savedVenues;
  }
});

test('the shipped config builds a rule whose strings all close', () => {
  assert.ok(stringsAreClosed(boot.venueAddresslessByDesign_()));
  assert.ok(stringsAreClosed(boot.venueIncomplete_()));
});
