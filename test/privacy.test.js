/**
 * **No output may read a `(private)` column**, made mechanical — not the map, the document, the
 * dashboard, or the `When` string.
 *
 * Stated in prose in `AGENTS.md`, `README.md` and `docs/architecture.md`; enforced here. A private
 * column is one edit away from being published, and the edit that does it looks harmless: adding a
 * column shifts a letter, and a formula that spelled a position rather than a key starts reading
 * the note beside the title.
 *
 * The venues rules and the hygiene checks are held to the rule as well, and they are the ones with
 * a reason to break it: what makes a venue city-only is a flag in the sheet, and the sheet is where
 * it has to live so that the script and the sheet cannot hold two drifting copies of it. The flag is
 * a column of its own, so those rules read a cell that is theirs to read; a rule that reached into
 * the notes instead would be one edit from a formula that publishes what it found there.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { withoutStrings } = require('./helpers/formula');

const boot = loadProject('bootstrap');
const src = loadProject('src');
const CONFIG = src.CONFIG;

/** Every `(private)` column of a tab, with the position a reference has to cover to read it. */
function privateColumns(project, tabKey) {
  return CONFIG.columns[tabKey]
    .filter(column => /\(private\)/i.test(column.header))
    .map(column => ({
      header: column.header,
      letter: project.columnLetter_(tabKey, column.key),
      index: project.columnIndex_(tabKey, column.key),
    }));
}

/* ── which cells a formula actually refers to ───────────────────────────────────────────────── */

/*
 * The check works from the columns, not from the spellings.
 *
 * A list of forbidden A1 fragments only knows the fragments on it: `Venues!$G$2:$G` and
 * `Venues!$A:$G` read the private note as surely as `Venues!G2:G` does. So the formula is parsed —
 * every range it refers to, the columns each one covers, and a failure if any lands on a private
 * column. A new way of spelling a range is then something the reader has to handle rather than
 * something the check misses.
 *
 * Out of reach: a reference built at run time. `INDIRECT("Venues!G2:G")` hides inside a string
 * literal, and string literals are deliberately not scanned (`withoutStrings` in
 * `helpers/formula.js`). Nothing here uses `INDIRECT`; anything that does needs its own check.
 */

/** `A` → 0, `Z` → 25, `AA` → 26 — `columnLetter_` backwards, for reading a formula. */
function columnNumberOf(letters) {
  let number = 0;
  for (const character of letters.toUpperCase()) {
    number = number * 26 + (character.charCodeAt(0) - 64);
  }
  return number - 1;
}

const COLUMN = '\\$?[A-Za-z]{1,3}';
const ROW = '\\$?\\d{1,7}';
/** One side of a range: a cell, a bare column, or a bare row. `$` may sit before either half. */
const SIDE = `(?:${COLUMN}${ROW}|${COLUMN}|${ROW})`;
/** `Events!C2:C`, `'Map Export'!A1:E1`, `$B$1`, `A:A`, `2:5` — an optional tab, then a range. */
const REFERENCE = new RegExp(
  `(?:('(?:[^']|'')+'|[A-Za-z0-9_]+)!)?(${SIDE}:${SIDE}|${COLUMN}${ROW})`, 'g');

const unquoteTab = name =>
  (name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name);

const forRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The columns a range covers, as an inclusive `[first, last]` pair.
 *
 * `null` means *every* column, which is what a whole-row reference such as `2:5` reads — the
 * honest answer, and the one that makes it fail rather than slip through as "no columns named".
 */
function columnSpan(range) {
  const sides = range.split(':');
  const columnOf = side => {
    const found = /^\$?([A-Za-z]{1,3})/.exec(side);
    return found ? columnNumberOf(found[1]) : null;
  };
  const first = columnOf(sides[0]);
  const last = sides.length > 1 ? columnOf(sides[1]) : first;
  if (first === null || last === null) return null;
  return [Math.min(first, last), Math.max(first, last)];
}

/**
 * Every reference in an already-blanked formula that lands on `tabKey`.
 *
 * `local` is for a formula that lives *on* that tab, where an unqualified `G2:G` means that tab's
 * column G. Counting unqualified ranges against a formula that lives elsewhere is not a stricter
 * test, it is a wrong one: `Organisers!` column D is the private note, and the map export
 * legitimately contains `Events!D2:D` for the venue — a collision that would fail a formula which
 * reads nothing private.
 */
function referencesIn(blanked, tabKey, { local }) {
  const name = CONFIG.tabs[tabKey];
  const found = [];
  for (const match of blanked.matchAll(REFERENCE)) {
    const qualified = match[1] !== undefined;
    if (qualified ? unquoteTab(match[1]) !== name : !local) continue;
    found.push({ text: match[0], qualified: qualified, span: columnSpan(match[2]) });
  }
  return found;
}

/** Fails when any range in `formula` covers a private column of `tabKey`. */
function assertNoPrivate(project, tabKey, label, formula, { local = false } = {}) {
  const columns = privateColumns(project, tabKey);
  const name = CONFIG.tabs[tabKey];

  // An empty list is not a pass: every assertion below is driven by it, so a tab with no matching
  // header would check nothing and report clean. Renaming `Note (private)` to `Note (internal)`
  // leaves the column exactly as publishable and silences this whole file.
  assert.ok(columns.length > 0,
    `${tabKey} has no (private) column, so ${label} was compared against nothing — ` +
    'if a header was renamed, rename it back or teach privateColumns the new marker');

  const blanked = withoutStrings(String(formula));
  const references = referencesIn(blanked, tabKey, { local });

  // A parse that read nothing would report clean, so the reader is checked against the text: every
  // `Tab!` the formula spells has to have produced a reference.
  const spelled =
    (blanked.match(new RegExp(`(?:'${forRegex(name)}'|${forRegex(name)})!`, 'g')) || []).length;
  const qualified = references.filter(reference => reference.qualified).length;
  assert.strictEqual(qualified, spelled,
    `${label}: the reader found ${qualified} of the ${spelled} "${name}!" reference(s) this ` +
    'formula spells, so it is not reading the spelling in use — teach REFERENCE that form rather ' +
    'than trusting the silence');

  if (local) {
    assert.ok(references.some(reference => !reference.qualified),
      `${label} was checked as a formula living on ${name}, but no unqualified range was read ` +
      'from it — either it does not live there and `local` is wrong, or the reader missed its ' +
      'own columns');
  }

  for (const reference of references) {
    for (const column of columns) {
      const reads = reference.span === null ||
        (reference.span[0] <= column.index && column.index <= reference.span[1]);
      assert.strictEqual(reads, false,
        `${label} reads ${column.header} (column ${column.letter}) through ${reference.text}`);
    }
  }
}

/* ── the check itself, held to a known leak ─────────────────────────────────────────────────── */

/*
 * Everything below asserts that `assertNoPrivate` *fails* on a formula that reads a private column.
 * Without them the rest of the file says only "the shipped formulas pass", and a check whose
 * failure path is never exercised is not a check.
 */

/** The private note on the venues tab, which the probes below read in every spelling. */
const PRIVATE_VENUE_COLUMN = privateColumns(src, 'venues')[0];

/** Fails unless `formula` is caught reading `PRIVATE_VENUE_COLUMN`. */
function assertCaught(formula, why, options) {
  assert.throws(() => assertNoPrivate(src, 'venues', 'a probe', formula, options),
    new RegExp(`reads ${forRegex(PRIVATE_VENUE_COLUMN.header)}`), why);
}

test('every spelling of a private range is caught', () => {
  // All ten read the same cells. The `$`-before-the-row forms are the ones a fragment list built
  // from the range helpers would not hold, since no helper emits them.
  const g = PRIVATE_VENUE_COLUMN.letter;
  const spellings = [
    `${g}2:${g}`, `${g}:${g}`, `$${g}:$${g}`, `$${g}2:$${g}`,           // what the helpers emit
    `$${g}$2:$${g}`, `${g}$2:${g}`, `$${g}$2:$${g}$1000`,               // row-absolute
    `${g}2:${g}1000`, `${g}5`, `$${g}$5`,                               // bounded, and single cells
  ];
  for (const range of spellings) {
    assertCaught(`=IFERROR(XLOOKUP(A2, Venues!$A:$A, Venues!${range}, ""), "")`,
      `a reference spelled Venues!${range} was not seen as reading the private note`);
  }
});

test('a range that merely ends at the private column is caught', () => {
  // The shape a whole-row lookup takes: `XLOOKUP(…, Venues!$A:$A, Venues!$A:$G)` hands back every
  // venue column at once, naming the private letter only as the far end of a span.
  const g = PRIVATE_VENUE_COLUMN.letter;
  assertCaught(`=IFERROR(XLOOKUP(A2, Venues!$A:$A, Venues!$A:$${g}, ""), "")`,
    'a span ending at the private column was not seen as covering it');
});

test('a whole-row reference is caught, because it reads every column there is', () => {
  assertCaught('=IFERROR(XLOOKUP(A2, Venues!$A:$A, Venues!2:2, ""), "")',
    'a whole-row reference was read as naming no columns at all');
});

test('an on-tab formula is caught reading its own private column by a bare letter', () => {
  const g = privateColumns(src, 'events')[0].letter;
  assert.throws(
    () => assertNoPrivate(src, 'events', 'a probe', `=ARRAYFORMULA(IF(${g}2:${g}="","",${g}2:${g}))`,
      { local: true }),
    /reads Note \(private\)/);
});

test('the same bare letter is not held against a formula that lives on another tab', () => {
  // Not a stricter test but a wrong one: `Organisers!` column D is the private note, and the map
  // export legitimately contains `Events!D2:D` for the venue. An unqualified range belongs to
  // whatever tab the formula sits on, which only `local` can say.
  assert.doesNotThrow(() => assertNoPrivate(src, 'organisers', 'a probe',
    '=FILTER(Events!C2:C, Events!D2:D<>"")'));
});

test('a formula reading only public columns passes, so the check is not always failing', () => {
  assert.doesNotThrow(() => assertNoPrivate(src, 'venues', 'a probe',
    '=IFERROR(XLOOKUP(A2, Venues!$A:$A, Venues!$B:$B, ""), "")'));
});

test('a reference the reader cannot parse fails rather than passing', () => {
  // A reader that silently reads nothing makes every assertion after it vacuous. A named range
  // could point anywhere, so a spelling the regex cannot follow has to stop the test.
  assert.throws(() => assertNoPrivate(src, 'venues', 'a probe', '=SUM(Venues!SomeNamedRange)'),
    /found 0 of the 1 "Venues!" reference/);
});

test('a private column that lost its marker stops the file rather than emptying it', () => {
  // Renaming the header leaves the column exactly as publishable, and would otherwise turn every
  // assertion in this file into a no-op.
  const saved = CONFIG.columns.venues.map(column => column.header);
  CONFIG.columns.venues.forEach(column => {
    column.header = column.header.replace(/\(private\)/i, '(internal)');
  });
  try {
    assert.throws(() => assertNoPrivate(src, 'venues', 'a probe', '=Venues!$A:$A'),
      /has no \(private\) column/);
  } finally {
    CONFIG.columns.venues.forEach((column, i) => { column.header = saved[i]; });
  }
});

/* ── the computed columns, which every output reuses ────────────────────────────────────────── */

test('the When string does not read the private note', () => {
  assertNoPrivate(boot, 'events', 'whenFormula_',
    boot.whenFormula_(boot.local_('events', 'dateStart'), boot.local_('events', 'dateEnd'),
      boot.local_('events', 'title')), { local: true });
});

test('the City lookup does not read the private note', () => {
  assertNoPrivate(boot, 'events', 'cityFormula_', boot.cityFormula_(), { local: true });
  assertNoPrivate(boot, 'venues', 'cityFormula_', boot.cityFormula_());
});

test('the Upcoming? column does not read the private note', () => {
  assertNoPrivate(boot, 'events', 'upcomingFormula_', boot.upcomingFormula_(), { local: true });
});

/* ── the rules that stay inside the sheet ───────────────────────────────────────────────────── */

/*
 * Nothing here is published, and that is exactly why it is checked: a formula that reads the private
 * note is one `XLOOKUP` away from carrying it into an output, and the venues rules are the formulas
 * with a motive — they decide what a venue is allowed to leave out.
 */

test('the venues completeness rules read no private column', () => {
  assertNoPrivate(boot, 'venues', 'venueCityOnly_', boot.venueCityOnly_(), { local: true });
  assertNoPrivate(boot, 'venues', 'venueIncomplete_', boot.venueIncomplete_(), { local: true });
});

test('no hygiene check reads a private column', () => {
  const blocks = boot.checkBlocks_();
  assert.ok(blocks.length > 0, 'there are no check blocks, so this test checks nothing');
  for (const [column, label, formula] of blocks) {
    for (const tabKey of ['events', 'venues', 'organisers']) {
      assertNoPrivate(boot, tabKey, `the "${label}" check in ${column}`, formula);
    }
  }
});

/* ── the three outputs ──────────────────────────────────────────────────────────────────────── */

test('the map export formula does not read a private column', () => {
  const formula = src.mapExportFormula_();
  assertNoPrivate(src, 'events', 'mapExportFormula_', formula);
  assertNoPrivate(src, 'venues', 'mapExportFormula_', formula);
  assertNoPrivate(src, 'organisers', 'mapExportFormula_', formula);
});

test('the map export condition does not read a private column', () => {
  assertNoPrivate(src, 'events', 'mapExportCondition_', src.mapExportCondition_());
});

test('the dashboard filter does not read a private column', () => {
  assertNoPrivate(boot, 'events', 'dashboardFilter_', boot.dashboardFilter_(true));
  assertNoPrivate(boot, 'events', 'dashboardFilter_ (unwrapped)', boot.dashboardFilter_(false));
});

test('no dashboard column is a private column', () => {
  const privateKeys = CONFIG.columns.events
    .filter(column => /\(private\)/i.test(column.header))
    .map(column => column.key);
  assert.ok(privateKeys.length > 0, 'no events column is marked (private) — this test checks nothing');
  for (const key of boot.dashboardColumns_()) {
    assert.strictEqual(privateKeys.includes(key), false, `the dashboard shows ${key}`);
  }
});

test('the LET spelling kept for the probe is held to the same rule', () => {
  // It is never shipped, but it is rendered on the dashboard on every setup run, so a private
  // column in it would be just as visible.
  assertNoPrivate(boot, 'events', 'dashboardFilterLet_', boot.dashboardFilterLet_());
});

/* ── the sheet's own copy of the rule ───────────────────────────────────────────────────────── */

test('every tab that takes typed notes marks them private', () => {
  // These tabs exist to be read by outputs. A notes column that was not marked private would be
  // publishable by default, which is the wrong default for free text a maintainer types.
  //
  // `events` is here as well as the two lookup tabs, and it is the one that matters most: every
  // assertion in this file is driven by the `(private)` marker in a header, so the events note
  // losing it would turn the file green rather than red.
  for (const tab of ['events', 'venues', 'organisers']) {
    const notes = CONFIG.columns[tab].filter(column => /note/i.test(column.header));
    assert.ok(notes.length > 0, `${tab} has no notes column`);
    for (const column of notes) {
      assert.match(column.header, /\(private\)/i,
        `${tab}.${column.key} is a notes column that is not private`);
    }
  }
});
