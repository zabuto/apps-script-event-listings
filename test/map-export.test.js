/**
 * The map export formula: the properties that make it importable, and the spelling it must keep.
 *
 * `check-formulas.js` already proves it is balanced and free of `undefined`. What is asserted here
 * is what that check cannot see — that the formula still says the things My Maps and the geocoder
 * depend on, and that nobody has "simplified" it into the shape that returns nothing.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { withoutStrings, callsOf, lambdaParams, boundNamesAt, IDENTIFIER } =
  require('./helpers/formula');

const src = loadProject('src');
const CONFIG = src.CONFIG;

test('the header count is enforced rather than assumed', () => {
  const saved = CONFIG.mapExport.headers;
  CONFIG.mapExport.headers = ['Title', 'When', 'Venue'];
  try {
    assert.throws(() => src.mapExportFormula_(), /exactly the five columns/);
  } finally {
    CONFIG.mapExport.headers = saved;
  }
});

test('the formula is flat: no LET, which returns nothing here', () => {
  // The tidy spelling — one LET, names holding arrays, XLOOKUP over them — returns the right row
  // count with #VALUE! in every looked-up column, and IFERROR presents that as an empty tab.
  assert.strictEqual(/\bLET\s*\(/.test(src.mapExportFormula_()), false,
    'the map export has been rewritten as LET — see docs/gotchas.md');
});

/* ── the shape the formula has to keep ──────────────────────────────────────────────────────── */

/*
 * The rule is that every `XLOOKUP` searches for **one value**: over an array it collapses and takes
 * the looked-up columns down with it. Counting the vocabulary cannot say that — a formula with one
 * `LAMBDA` and four bare `XLOOKUP`s contains `LAMBDA(`, and stays balanced, so `check-formulas.js`
 * passes it too.
 *
 * So the argument is read instead. For each `XLOOKUP` the search key must be a bare name, and that
 * name must be bound by a `LAMBDA` enclosing it. Both halves are load bearing: the first rejects
 * `XLOOKUP(FILTER(…), …)` and `XLOOKUP(Events!D2:D, …)`, the second rejects a name holding an array
 * — which is what a `LET` name is, so the `LET` rewrite is caught by behaviour, not by spelling.
 */

/**
 * One argument as it was actually written, for the failure message.
 *
 * The parser works on blanked text, so `arg.text` reads `<>  ` where the formula says `<>""`.
 * `withoutStrings` keeps every offset, so the original can be quoted instead.
 */
const asWritten = (formula, argument) =>
  String(formula).slice(argument.from, argument.to).trim();

/** Fails unless every `XLOOKUP` in `formula` searches for a single value bound by a `LAMBDA`. */
function assertLookupsTakeOneValue(label, formula) {
  const text = withoutStrings(String(formula));
  const lambdas = callsOf(text, 'LAMBDA');
  const lookups = callsOf(text, 'XLOOKUP');

  // Nothing to check is not a pass: this is the assertion an over-eager simplification would empty.
  assert.ok(lookups.length > 0,
    `${label} contains no XLOOKUP at all, so this check compared nothing — if the lookups moved to ` +
    'another function, point this test at it');

  for (const lookup of lookups) {
    const key = lookup.args[0].text;
    const written = asWritten(formula, lookup.args[0]);
    assert.ok(IDENTIFIER.test(key),
      `${label}: XLOOKUP searches for "${written}", which is an expression rather than a single ` +
      'value — over an array it collapses and every looked-up column comes back #VALUE!');
    assert.ok(boundNamesAt(lambdas, lookup.open).has(key),
      `${label}: XLOOKUP searches for "${written}", which no enclosing LAMBDA binds — a name ` +
      'holding an array fails the same way the array does, and is what a LET name would be here');
  }
}

/** Fails unless every `MAP` hands its arrays to a `LAMBDA` taking exactly that many arguments. */
function assertMapArityMatches(label, formula) {
  const text = withoutStrings(String(formula));
  const maps = callsOf(text, 'MAP');

  assert.ok(maps.length > 0, `${label} contains no MAP at all, so this check compared nothing`);

  for (const map of maps) {
    const arrays = map.args.slice(0, -1);
    const body = map.args[map.args.length - 1];
    assert.match(body.text, /^LAMBDA\s*\(/,
      `${label}: MAP's last argument is "${asWritten(formula, body).slice(0, 40)}" rather than a ` +
      'LAMBDA, so the arrays are not being walked a row at a time');
    const [lambda] = callsOf(body.text, 'LAMBDA');
    assert.strictEqual(lambdaParams(lambda).length, arrays.length,
      `${label}: MAP is given ${arrays.length} array(s) but its LAMBDA takes ` +
      `${lambdaParams(lambda).length} — mismatched lengths are how this formula fails in a sheet`);
  }
}

test('every XLOOKUP searches for a single value handed to it by an enclosing LAMBDA', () => {
  assertLookupsTakeOneValue('mapExportFormula_', src.mapExportFormula_());
});

test('every MAP hands its arrays to a LAMBDA of matching arity', () => {
  // "MAP then receives arguments of different lengths" is the second half of the LET failure, and
  // the half a count of LAMBDAs could not see.
  assertMapArityMatches('mapExportFormula_', src.mapExportFormula_());
});

/* ── the two checks above, held to the shapes that fail in a sheet ──────────────────────────── */

/*
 * Each probe below is a formula that would come back #VALUE! from its looked-up columns, and each is
 * asserted to be *caught*. Without them the pair above says only "the shipped formula passes".
 */

/** The organiser column as it is shipped: one array, one LAMBDA, the lookup on the bound name. */
const SHIPPED = '=MAP(FILTER(Events!E2:E, Events!C2:C<>""), LAMBDA(pp, ' +
  'pp&IFERROR(XLOOKUP(pp, Organisers!$A:$A, Organisers!$B:$B, ""), "")))';

test('the shipped shape passes, so the checks are not simply always failing', () => {
  assert.doesNotThrow(() => assertLookupsTakeOneValue('a probe', SHIPPED));
  assert.doesNotThrow(() => assertMapArityMatches('a probe', SHIPPED));
});

test('an XLOOKUP over a FILTER is caught', () => {
  // The organiser column looking up the whole filtered array at once, with the other columns'
  // LAMBDAs still present — which is what makes it invisible to a count of the vocabulary.
  const leak = `=HSTACK(${SHIPPED.slice(1)}, IFERROR(XLOOKUP(FILTER(Events!E2:E, ` +
    'Events!C2:C<>""), Organisers!$A:$A, Organisers!$B:$B, ""), ""))';
  assert.throws(() => assertLookupsTakeOneValue('a probe', leak),
    /searches for "FILTER\(Events!E2:E, Events!C2:C<>""\)", which is an expression/);
});

test('an XLOOKUP over a bare range is caught', () => {
  assert.throws(() => assertLookupsTakeOneValue('a probe',
    '=IFERROR(XLOOKUP(Events!E2:E, Organisers!$A:$A, Organisers!$B:$B, ""), "")'),
  /which is an expression rather than a single value/);
});

test('an XLOOKUP over a LET name is caught, though the name is a bare identifier', () => {
  // Caught by what it does rather than by the word LET: `p` reads as a single value and holds an
  // array, which is the whole reason the tidy spelling returns nothing.
  assert.throws(() => assertLookupsTakeOneValue('a probe',
    '=LET(p, Events!E2:E, IFERROR(XLOOKUP(p, Organisers!$A:$A, Organisers!$B:$B, ""), ""))'),
  /which no enclosing LAMBDA binds/);
});

test('a name bound by a LAMBDA that does not enclose the lookup is caught', () => {
  // Scope is checked by offset, not by "does this name appear in a LAMBDA somewhere" — otherwise a
  // sibling column's parameter would launder any lookup in the formula.
  assert.throws(() => assertLookupsTakeOneValue('a probe',
    '=HSTACK(MAP(FILTER(Events!D2:D, Events!C2:C<>""), LAMBDA(vv, vv)), ' +
    'IFERROR(XLOOKUP(vv, Venues!$A:$A, Venues!$B:$B, ""), ""))'),
  /which no enclosing LAMBDA binds/);
});

test('a MAP whose LAMBDA takes too few arguments is caught', () => {
  assert.throws(() => assertMapArityMatches('a probe',
    '=MAP(FILTER(Events!C2:C, Events!C2:C<>""), FILTER(Events!H2:H, Events!C2:C<>""), ' +
    'LAMBDA(tt, tt))'),
  /given 2 array\(s\) but its LAMBDA takes 1/);
});

test('a MAP handed something other than a LAMBDA is caught', () => {
  assert.throws(() => assertMapArityMatches('a probe',
    '=MAP(FILTER(Events!C2:C, Events!C2:C<>""), Events!H2:H)'),
  /last argument is "Events!H2:H" rather than a LAMBDA/);
});

test('a formula with no lookups left in it fails rather than reporting clean', () => {
  assert.throws(() => assertLookupsTakeOneValue('a probe', '=FILTER(Events!C2:C, Events!C2:C<>"")'),
    /contains no XLOOKUP at all/);
  assert.throws(() => assertMapArityMatches('a probe', '=FILTER(Events!C2:C, Events!C2:C<>"")'),
    /contains no MAP at all/);
});

test('the whole formula is guarded, so an empty sheet is an empty tab and not an error', () => {
  // With nothing upcoming, FILTER returns #N/A and the import source becomes an error rather than
  // an empty tab — which My Maps would take as place names.
  const formula = src.mapExportFormula_();
  assert.ok(formula.startsWith('=IFERROR('), 'the IFERROR guard is gone');
  assert.ok(formula.includes('COUNTIFS('), 'the empty-sheet COUNTIFS guard is gone');
});

test('the condition is the sheet\'s own Upcoming? column, not a second opinion', () => {
  // If the map decided "does this publish?" for itself, it could disagree with the document and the
  // dashboard. It must read the one column instead.
  const condition = src.mapExportCondition_();
  assert.ok(condition.includes(src.colRange_('events', 'upcoming')),
    'the map export no longer reads the Upcoming? column');
  assert.ok(condition.includes(CONFIG.values.scope.upcoming));
});

test('an event with no venue is excluded, because it has no position', () => {
  assert.ok(src.mapExportCondition_().includes(`${src.colRange_('events', 'venue')}<>""`));
});

test('the geocodable line carries the country suffix', t => {
  // Skipped rather than returned when unset, so clearing the setting shows in the summary as a test
  // that did not run rather than one that passed.
  if (!CONFIG.mapExport.countrySuffix) {
    t.skip('CONFIG.mapExport.countrySuffix is not set');
    return;
  }
  assert.ok(src.mapExportFormula_().includes(CONFIG.mapExport.countrySuffix),
    'the country suffix is not in the location column, so addresses geocode ambiguously');
});

test('the country suffix is appended when set, and contributes nothing when cleared', () => {
  // The rule rather than the shipped value, since an installer is free to clear the setting. Both
  // states run off a probe value: using the live one would compare against `", "` when it is empty,
  // and `", "` is a legitimate join in the location line.
  const saved = CONFIG.mapExport.countrySuffix;
  try {
    CONFIG.mapExport.countrySuffix = 'Testland';
    assert.ok(src.mapExportFormula_().includes('", Testland"'),
      'a configured country suffix is not reaching the location line');

    CONFIG.mapExport.countrySuffix = '';
    const cleared = src.mapExportFormula_();
    assert.strictEqual(cleared.includes('Testland'), false, 'the suffix survived being cleared');
    // `[,)]` rather than just `)`: the suffix sits at the end of both branches of the location IF,
    // one followed by an argument separator and the other by the closing parenthesis. The
    // legitimate `&", "&cc` joins are followed by `&`, so they do not match.
    assert.strictEqual(/&", "[,)]/.test(cleared), false,
      'a dangling ", " was appended to the location line, so every address geocodes with it');
  } finally {
    CONFIG.mapExport.countrySuffix = saved;
  }
});

test('the city is appended to the title, since the layer panel lists titles and nothing else', () => {
  assert.ok(src.mapExportFormula_().includes(CONFIG.mapExport.titleSuffix));
});

test('a URL without a scheme is given one, because My Maps only linkifies those', () => {
  const formula = src.mapExportFormula_();
  assert.ok(formula.includes('https://'), 'the scheme is no longer added to bare hosts');
  assert.ok(formula.includes('LEFT(LOWER('), 'the "does it already have a scheme" test is gone');
});

test('the formula is a formula, and one cell of it', () => {
  // Where it is anchored is a property of the write, not of the formula, and is asserted in
  // `map-refresh.test.js`.
  const formula = src.mapExportFormula_();
  assert.ok(formula.startsWith('='), 'the map export is not a formula');
  assert.strictEqual(formula.includes('\n'), false, 'one cell holds one line');
});
