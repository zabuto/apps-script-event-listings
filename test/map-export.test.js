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

/**
 * The `HSTACK` whose columns spill onto the tab: the one no other `HSTACK` encloses.
 *
 * Nesting is what identifies it. The formula holds two, and both take the same number of arguments —
 * the one stacking an event's date, `When`, title and organiser before the block is sorted is shaped
 * exactly like the one My Maps imports — so counting arguments cannot tell them apart, and picking
 * by position holds only while nothing opens an `HSTACK` ahead of the columns.
 */
function outputStack(text) {
  const stacks = callsOf(text, 'HSTACK');
  const outermost = stacks.filter(stack =>
    !stacks.some(other => other.open < stack.open && stack.end < other.end));
  assert.strictEqual(outermost.length, 1,
    `${outermost.length} HSTACK(s) spill side by side, so what lands under the headers is not ` +
    'answerable from the structure — the columns this file asserts about cannot be identified');
  return outermost[0];
}

test('the header count is enforced rather than assumed', () => {
  const saved = CONFIG.mapExport.headers;
  CONFIG.mapExport.headers = ['Venue', 'Events'];
  try {
    assert.throws(() => src.mapExportFormula_(), /exactly the 4 columns/);
  } finally {
    CONFIG.mapExport.headers = saved;
  }
});

test('a header is refused for a column the formula does not build', () => {
  // `indexOf` answers -1 and `headers[-1]` answers `undefined`, which the import instructions would
  // otherwise print as the name of the column to point My Maps at — a sentence an installer can
  // only follow by guessing.
  assert.throws(() => src.mapExportHeader_('title'), /builds no "title" column/);
});

test('the formula builds a column for every header, and no more', () => {
  // The formula spills under the headers `refreshMapExport` writes: one column too few leaves an
  // empty labelled field in every pin, one too many puts a value under a header about something.
  const stack = outputStack(withoutStrings(src.mapExportFormula_()));
  assert.strictEqual(stack.args.length, CONFIG.mapExport.headers.length);
});

/**
 * What identifies each column of the output stack: a reference only that column can carry.
 *
 * The city hung off a pin name, an organiser's handle, a postcode and a site are each read by one
 * column and no other, so a mark found somewhere else names a column that has stopped being what it
 * is called. Keyed by `mapExportColumns_`, which is where the order itself is declared.
 */
function columnMarks() {
  return {
    venue: src.quoteLiteral_(CONFIG.mapExport.titleSuffix),
    events: src.colLookup_('organisers', 'social'),
    location: src.colLookup_('venues', 'postcode'),
    website: src.colLookup_('venues', 'url'),
  };
}

test('every column of the stack is identifiable, so the order below is answerable', () => {
  // A mark two columns carry, or none, would let the order check below pass on a stack it never
  // actually read.
  const formula = src.mapExportFormula_();
  const stack = outputStack(withoutStrings(formula));
  const marks = columnMarks();

  assert.deepStrictEqual(Object.keys(marks).sort(), [...src.mapExportColumns_()].sort(),
    'a column the formula builds has no mark, or a mark names a column it does not build');
  for (const [key, mark] of Object.entries(marks)) {
    // `withoutStrings` replaces a literal character for character, so an argument's offsets slice
    // the formula itself — a mark spelled inside a string is found where it is written.
    const carrying = stack.args.filter(column => formula.slice(column.from, column.to).includes(mark));
    assert.strictEqual(carrying.length, 1,
      `${carrying.length} column(s) read ${mark}, so it does not identify the ${key} column`);
  }
});

test('the columns land in the order mapExportColumns_ declares, which is what the report reads', () => {
  // `refreshMapExport` tells the installer which header to point the import at by looking `location`
  // up in this list. Swap two arguments of the stack and the position column named is the pin name
  // or the site: My Maps geocodes those happily, puts every pin somewhere plausible and wrong, and
  // reports nothing — the header count and every per-column property still hold.
  const formula = src.mapExportFormula_();
  const stack = outputStack(withoutStrings(formula));
  const marks = columnMarks();

  src.mapExportColumns_().forEach((key, at) => {
    assert.ok(formula.slice(stack.args[at].from, stack.args[at].to).includes(marks[key]),
      `column ${at + 1} is not the ${key} column, so "${CONFIG.mapExport.headers[at]}" labels ` +
      'something else and the import is pointed at the wrong one');
  });
});

/* ── one pin per venue ──────────────────────────────────────────────────────────────────────── */

test('the rows are the venues, not the events, because one room is one point on the ground', () => {
  // Events in one room geocode identically, and My Maps stacks those pins with one clickable. Every
  // column is walked off the same list of venues; one built off anything else is a column of a
  // different length, which is a value under the wrong header rather than an error.
  const text = withoutStrings(src.mapExportFormula_());
  const stack = outputStack(text);
  const [unique] = callsOf(text, 'UNIQUE');
  // The whole `UNIQUE` call, character for character: two columns walking two lists that merely
  // look alike is the same wrong-header failure as two lists of different lengths.
  const pins = text.slice(unique.at, unique.end + 1);
  for (const [at, column] of stack.args.entries()) {
    assert.ok(column.text.includes(pins),
      `the ${CONFIG.mapExport.headers[at]} column is not built over the list of venues`);
  }
});

test('the venues are resolved once per column, not once per field a column reads', () => {
  // Each walk is a pass over the events column and a lookup per placed event, so a column walking
  // the list a second time to pick up one more field pays all of that to save one venue lookup. An
  // applied `LAMBDA` binds every field a column needs off a single walk.
  const walks = callsOf(withoutStrings(src.mapExportFormula_()), 'UNIQUE');
  const columns = src.mapExportColumns_().length;
  assert.strictEqual(walks.length, columns,
    `the list of venues is built ${walks.length} time(s) for ${columns} column(s)`);
});

test('a venue is resolved to one spelling before UNIQUE compares it', () => {
  // `UNIQUE` compares text as typed, where `XLOOKUP` and the `venue=vv` the popup lines are filtered
  // by both fold case: handed the events column raw, `paradiso` and `Paradiso` are two pins on one
  // coordinate listing the same events, against a count that says one and refuses the tab.
  const text = withoutStrings(src.mapExportFormula_());
  const [unique] = callsOf(text, 'UNIQUE');
  const names = src.colLookup_('venues', 'name');

  const [resolve] = callsOf(unique.args[0].text, 'XLOOKUP');
  assert.ok(resolve, 'UNIQUE is handed the venue column as typed, so one room can be two pins');
  assert.strictEqual(resolve.args[1].text, names,
    'the venue names are compared against something other than the venues tab');
  assert.strictEqual(resolve.args[2].text, names,
    'the lookup answers with a field other than the name, so the pins are not venue names');
  assert.strictEqual(resolve.args[3].text, resolve.args[0].text,
    'a venue the venues tab does not hold falls back to something other than the typed name');

  // The key stays a single bound value: an array here is the collapse this whole formula is shaped
  // around, and it would take the list of pins down with it.
  const bound = boundNamesAt(callsOf(unique.args[0].text, 'LAMBDA'), resolve.at);
  assert.ok(bound.has(resolve.args[0].text),
    `the lookup key ${resolve.args[0].text} is not a single bound value`);
});

test('the events at a venue are lines in its own cell, which is what makes one pin enough', () => {
  // CRLF, because a popup does not break on a bare CHAR(10) and renders the run as one line.
  const formula = src.mapExportFormula_();
  assert.ok(/TEXTJOIN\(CHAR\(13\)&CHAR\(10\)/.test(formula),
    'the events at a venue are not joined into one cell as separate lines');
});

test('a venue with one event is not bulleted, since a bullet marks it off from nothing', () => {
  // Every bullet in the formula sits behind the row count, so the mark cannot appear on its own as
  // the first character of a popup that lists a single event.
  const formula = src.mapExportFormula_();
  const text = withoutStrings(formula);
  const counted = callsOf(text, 'IF').filter(call => /^ROWS\(/.test(call.args[0].text));
  assert.ok(counted.length > 0,
    'nothing counts the events at a venue, so a single one is bulleted like a list');

  for (let at = formula.indexOf('•'); at >= 0; at = formula.indexOf('•', at + 1)) {
    assert.ok(counted.some(call => call.open < at && at < call.end),
      'a bullet is written whatever the count, so a venue with one event carries a stray mark');
  }
});

test('the count behind the bullet is made once per venue, not once per use', () => {
  // The popup opens with the mark and separates its lines by it, and the count behind it is a
  // `FILTER` over the whole events column, per pin. Spelling it in both places is that scan twice
  // for a value that cannot differ between them.
  const counted = callsOf(withoutStrings(src.mapExportFormula_()), 'ROWS');
  assert.strictEqual(counted.length, 1,
    `the events at a venue are counted ${counted.length} time(s), where one bound mark serves both ` +
    'the prefix and the separator');
});

test('an organiser is looked up once per event line, not once per use of the answer', () => {
  // The handle decides whether a profile link is written and then supplies it, so reading it in
  // both places scans the organisers tab twice per event line for an answer that cannot differ.
  const text = withoutStrings(src.mapExportFormula_());
  const social = src.colLookup_('organisers', 'name');
  const looked = callsOf(text, 'XLOOKUP').filter(call => call.args[1].text === social);
  assert.strictEqual(looked.length, 1,
    `the organisers tab is searched ${looked.length} time(s) for one handle`);
});

test('the events in a pin are listed oldest first', () => {
  // The date column of the block is sorted on, ascending. Any other column orders a popup by title
  // or by whoever typed the row first, and a listing of what is coming has to read forwards.
  const text = withoutStrings(src.mapExportFormula_());
  const [sort] = callsOf(text, 'SORT');
  const [stacked] = callsOf(sort.args[0].text, 'HSTACK');
  assert.strictEqual(stacked.args[Number(sort.args[1].text) - 1].text,
    src.colRange_('events', 'dateStart'), 'the events at a venue are ordered by some other column');
  assert.strictEqual(sort.args[2].text, 'TRUE', 'the newest event is listed first');
});

test('the events in a pin are sorted once, as a block', () => {
  // Two things ride on the single sort. Columns ordered independently put the title of one event
  // beside the organiser of another whenever two share a date — a line that reads perfectly and is
  // about neither. And a sort per field is a `SORT(FILTER(HSTACK(…)))` apiece over four open-ended
  // columns, for every pin, on a formula the sheet recomputes on every edit.
  const text = withoutStrings(src.mapExportFormula_());
  const sorts = callsOf(text, 'SORT');
  assert.strictEqual(sorts.length, 1,
    `the events at a venue are ordered by ${sorts.length} sort(s): one pass over the events tab ` +
    'per pin is what a single block costs, and each extra is another');
  assert.match(sorts[0].args[0].text, /^FILTER\(\s*HSTACK\(/,
    'SORT is handed a single column, so the rest of the line is ordered on its own');
});

test('the sorted block is walked a row at a time, with its fields bound to names', () => {
  // `BYROW` hands the lambda one row, which is what lets a single block serve every field of the
  // line. The fields are then bound by an applied `LAMBDA` rather than read where they are used:
  // that is what keeps the organiser a single value under `XLOOKUP`, which the lookup-shape check
  // above holds the whole formula to.
  const text = withoutStrings(src.mapExportFormula_());
  const rows = callsOf(text, 'BYROW');
  assert.strictEqual(rows.length, 1,
    `the block is walked by ${rows.length} BYROW(s), where the line is built from exactly one`);

  const [walker] = callsOf(rows[0].args[1].text, 'LAMBDA');
  assert.deepStrictEqual(lambdaParams(walker), ['rr'],
    'BYROW hands its LAMBDA one row, so a LAMBDA taking any other number of arguments is an error');

  const [applied] = callsOf(walker.args[1].text, 'LAMBDA');
  assert.strictEqual(lambdaParams(applied).length, 3,
    'the row is not unpacked into the three fields a line is made of');
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

test('the city is appended to the venue, since the layer panel lists titles and nothing else', () => {
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
