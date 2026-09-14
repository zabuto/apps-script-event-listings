/**
 * The helpers that exist in **both** Apps Script projects must not drift apart.
 *
 * `EXPECTED_SHARED` below is the list, and the only place it is written down: a count repeated in
 * prose drifts from it the first time a helper is duplicated or dropped.
 *
 * `shared/Config.gs` has this problem and is guarded on both sides: `sync-config.sh` writes the
 * copies and `check-formulas.js` fails when they differ. The helper copies have neither, and Apps
 * Script gives no way to share a file between two projects — so `bootstrap/Common.gs` and
 * `src/Code.gs` each carry their own `columnIndex_`, `lookupKey_`, `countFilled_` and friends. Fix
 * a bug in one and nothing tells you the other still has it.
 *
 * The guard is **behavioural first**. Identical source is a proxy for what actually matters — that
 * the two answer the same way — and holding two projects to byte-identical text would force
 * artificial edits, since they legitimately do not carry the same helper *set*. So every shared
 * helper that can be called is called on both sides and compared, and the source comparison runs
 * second, with an explicit list of the differences that are intended.
 *
 * The shared set is discovered rather than hard-coded, so a newly duplicated helper is surfaced here
 * as a decision to acknowledge rather than slipping in unnoticed.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject, projectSource } = require('./helpers/project');

const boot = loadProject('bootstrap');
const src = loadProject('src');

/** Helpers that appear in both projects and are expected to. */
const EXPECTED_SHARED = [
  'cityOnlyVenue_', 'columnIndex_', 'columnSpec_', 'countFilled_', 'headers_', 'lookupKey_',
  'notify_',
];

/**
 * Differences that are deliberate. Anything else differing is drift.
 *
 * Both are still held to the behavioural checks below where they can be called, so an entry here
 * buys an exemption from *text* comparison only.
 */
const INTENDED_DIFFERENCES = {
  notify_: 'different signatures by design: the scaffolding reports title + body through a dialog '
    + 'and falls back to Logger; the bound project takes one message and falls back to console.',
};

/* ── extracting one function's source ───────────────────────────────────────────────────────── */

/** Keywords after which a `/` opens a pattern rather than dividing. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await']);

/**
 * Whether the `/` at `at` opens a regular expression rather than dividing.
 *
 * Only the preceding token tells the two apart: after a value — an identifier, a number, `)` or `]`
 * — a slash divides; after a punctuator or a keyword that takes an expression next, it opens a
 * pattern. Reading `/"/g` as division leaves a quote open and swallows everything to the next one.
 */
function startsRegex(source, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  if (i < 0) return true;
  if (/[)\]}]/.test(source[i])) return false;
  if (!/[A-Za-z0-9_$]/.test(source[i])) return true;
  let start = i;
  while (start >= 0 && /[A-Za-z0-9_$]/.test(source[start])) start--;
  return BEFORE_REGEX.has(source.slice(start + 1, i + 1));
}

/**
 * Every top-level function in a source, by name, as text.
 *
 * Brace counting that skips strings, template literals, comments and regular expressions — a `}` or
 * a quote inside any of them would otherwise end the function early and the comparison would be
 * against a truncated body, which is the kind of test that passes for the wrong reason. A regex
 * character class is tracked too, because `]` is the only thing that ends one and a `/` inside a
 * class does not close the pattern.
 */
function functionSources(source) {
  const found = {};
  const declaration = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let match;
  while ((match = declaration.exec(source))) {
    const open = source.indexOf('{', match.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    let quote = null;
    let lineComment = false;
    let blockComment = false;
    let regex = false;
    let charClass = false;
    for (; i < source.length; i++) {
      const c = source[i];
      const next = source[i + 1];
      if (lineComment) { if (c === '\n') lineComment = false; continue; }
      if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (regex) {
        if (c === '\\') { i++; continue; }
        if (c === '[') charClass = true;
        else if (c === ']') charClass = false;
        else if (c === '/' && !charClass) regex = false;
        continue;
      }
      if (c === '/' && next === '/') { lineComment = true; i++; continue; }
      if (c === '/' && next === '*') { blockComment = true; i++; continue; }
      if (c === '/' && startsRegex(source, i)) { regex = true; charClass = false; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    found[match[1]] = source.slice(match.index, i);
  }
  return found;
}

const bootSources = functionSources(projectSource('bootstrap'));
const srcSources = functionSources(projectSource('src'));
const shared = Object.keys(bootSources).filter(name => name in srcSources).sort();
const normalise = text => text.replace(/\s+/g, ' ').trim();

/* ── the set itself ─────────────────────────────────────────────────────────────────────────── */

test('the set of helpers duplicated across the projects is the expected one', () => {
  // A new name here is not necessarily wrong — it is a decision. Add it to EXPECTED_SHARED once you
  // have decided the duplication is worth carrying, and the checks below will hold it in step.
  assert.deepStrictEqual(shared, EXPECTED_SHARED.slice().sort());
});

test('every intended difference names a helper that really is shared', () => {
  for (const name of Object.keys(INTENDED_DIFFERENCES)) {
    assert.ok(shared.includes(name), `${name} is exempted but no longer exists in both projects`);
  }
});

/* ── source, with the intended differences excused ──────────────────────────────────────────── */

test('a shared helper has the same source in both projects', () => {
  for (const name of shared) {
    if (name in INTENDED_DIFFERENCES) continue;
    assert.strictEqual(normalise(bootSources[name]), normalise(srcSources[name]),
      `${name} has drifted between bootstrap/ and src/ — fix both, or record why not in ` +
      'INTENDED_DIFFERENCES');
  }
});

test('an exempted helper is still genuinely different, so the list stays honest', () => {
  // A stale exemption is worse than none: it silently turns off the check for a helper that no
  // longer needs it.
  for (const name of Object.keys(INTENDED_DIFFERENCES)) {
    assert.notStrictEqual(normalise(bootSources[name]), normalise(srcSources[name]),
      `${name} is identical in both projects now — drop it from INTENDED_DIFFERENCES`);
  }
});

/* ── behaviour, which is what actually has to match ─────────────────────────────────────────── */

const TABS = ['events', 'venues', 'organisers'];

/** Calls the same helper on both sides and compares. */
function sameAnswer(name, call) {
  assert.deepStrictEqual(call(boot), call(src), `${name} answers differently in the two projects`);
}

test('the column contract helpers answer identically', () => {
  for (const tab of TABS) {
    sameAnswer('columnSpec_', p => p.columnSpec_(tab));
    sameAnswer('headers_', p => p.headers_(tab));
    for (const column of boot.CONFIG.columns[tab]) {
      sameAnswer('columnIndex_', p => p.columnIndex_(tab, column.key));
    }
  }
});

test('the column helpers fail identically on an unknown key', () => {
  const message = p => {
    try { p.columnIndex_('events', 'noSuchColumn'); return null; } catch (err) { return err.message; }
  };
  assert.strictEqual(message(boot), message(src));
  assert.notStrictEqual(message(boot), null, 'neither project threw on an unknown column key');
});

test('countFilled_ counts the same', () => {
  const range = { getValues: () => [['a'], [''], ['b'], [null], [''], [0]] };
  sameAnswer('countFilled_', p => p.countFilled_(range));
});

test('lookupKey_ folds a name the same way', () => {
  for (const value of ['De Nieuwe Anita', '  de NIEUWE anita  ', "'t Blauwe Theehuis", '', null,
    undefined, 0, 42]) {
    sameAnswer('lookupKey_', p => p.lookupKey_(value));
  }
});

test('cityOnlyVenue_ reads a City only? cell the same way in both projects', () => {
  // One flag, two projects: the bound project decides whether a venue is nagged for an address and
  // whether a street number on it is a breach, the scaffolding reports which rows its conditional
  // formats will paint. A cell that means different things on the two sides is the two halves of one
  // rule disagreeing.
  //
  // The text values are the ones that reach a cell by being pasted or imported over the box. Only a
  // boolean is a tick, and both sides have to say so — see `city-only-flag.test.js`.
  for (const value of [true, false, 'TRUE', 'true', 'FALSE', 'yes', 1, 0, '', null, undefined]) {
    sameAnswer('cityOnlyVenue_', p => p.cityOnlyVenue_(value));
  }
});

/* ── what is not covered here, said out loud ────────────────────────────────────────────────── */

test('the helpers that cannot be compared by behaviour are the ones on record', () => {
  // `notify_` needs a UI, so it cannot be called from a plain comparison, and the source comparison
  // that would otherwise guard it is exempted — which leaves it guarded by nothing. Stated here so
  // the gap is visible rather than assumed covered.
  const behaviourallyChecked = [
    'cityOnlyVenue_', 'columnIndex_', 'columnSpec_', 'countFilled_', 'headers_', 'lookupKey_',
  ];
  const notChecked = shared.filter(name => !behaviourallyChecked.includes(name));
  assert.deepStrictEqual(notChecked, ['notify_']);
});
