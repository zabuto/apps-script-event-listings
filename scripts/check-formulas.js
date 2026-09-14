#!/usr/bin/env node
/**
 * Builds every formula this codebase generates and checks it, without touching Google.
 *
 *     node scripts/check-formulas.js
 *
 * The formula builders are pure functions of `shared/Config.gs` — that is what makes this possible,
 * and it is worth keeping that way. Run it after any change to the config or to a builder: a
 * mis-nested parenthesis or a column key that no longer exists is otherwise a `#ERROR!` you find in
 * the sheet, twenty minutes later, in a formula three hundred characters long.
 *
 * What it checks: balanced parentheses and quotes, no unexpanded template placeholder, no `undefined`
 * from a missing config key, and that every seeded event names a venue and an organiser that exist.
 * It also fails when a generated copy differs from its canonical file in `shared/` — the copies are
 * what `clasp push` sends, so a forgotten `sync-config.sh` otherwise pushes one thing and tests
 * another.
 *
 * What it cannot check: whether a formula *means* what you intended. Only a sheet can answer that,
 * which is what the probes inside each setup step are for.
 */
// Not strict mode, deliberately: a direct `eval` in strict mode keeps its function declarations to
// itself, and loading the project files the way Apps Script does — one shared scope — is the whole
// trick that lets this run outside Google at all.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const load = file => fs.readFileSync(path.join(root, file), 'utf8')
  .replace(/^const /gm, 'var ')          // so repeated eval() in one scope does not redeclare
  .replace(/^let /gm, 'var ');

const problems = [];

/** The only Apps Script global the pure builders touch. */
global.Utilities = { formatDate: () => '2026-01-01' };

function check(name, formula) {
  const text = String(formula);
  let depth = 0;
  let lowest = 0;
  let inString = false;
  for (const character of text) {
    if (character === '"') inString = !inString;
    if (inString) continue;
    if (character === '(') depth++;
    if (character === ')') { depth--; if (depth < lowest) lowest = depth; }
  }
  if (depth !== 0) problems.push(
    `${name}: unbalanced parentheses (${depth > 0 ? depth + ' unclosed' : -depth + ' extra'})`);
  if (lowest < 0) problems.push(`${name}: a ")" before its "("`);
  if ((text.match(/"/g) || []).length % 2) problems.push(`${name}: odd number of double quotes`);
  if (/undefined|\[object Object\]|NaN/.test(text)) problems.push(
    `${name}: contains "undefined" — a config key is missing`);
  if (text.includes('${')) problems.push(`${name}: an unexpanded template placeholder`);
  return text;
}

/**
 * Runs one section and turns anything it throws into a reported problem.
 *
 * The builders throw deliberately and with a useful message — a column key that no longer exists, a
 * list that has moved — and a node stack trace on top of that message helps nobody. This keeps the
 * output readable and the exit code honest.
 */
function section(name, body) {
  try {
    body();
  } catch (err) {
    problems.push(`${name}: ${err.message}`);
  }
}

/* ── the generated copies ───────────────────────────────────────────────────────────────── */
/*
 * Checked first, because a drift is silent and total either way: a stale config means the sheet
 * writes a value the bound script does not recognise, and a stale manifest means an advanced service
 * the code calls is no longer declared. Neither raises.
 */
[['bootstrap/Config.gs', 'shared/Config.gs'],
 ['src/Config.gs', 'shared/Config.gs'],
 ['bootstrap/appsscript.json', 'shared/appsscript.bootstrap.json'],
 ['src/appsscript.json', 'shared/appsscript.src.json']].forEach(([copy, canonical]) => {
  if (fs.readFileSync(path.join(root, copy), 'utf8')
      !== fs.readFileSync(path.join(root, canonical), 'utf8')) {
    problems.push(`${copy} differs from ${canonical} — run scripts/sync-config.sh`);
  }
});

/* ── the scaffolding project ─────────────────────────────────────────────────────────────── */

section('the scaffolding project', function bootstrapProject() {
  // A `for` loop, not `forEach`: an eval inside a callback would define the project's functions in
  // that callback's scope and they would vanish with it. This is the same one-shared-scope loading
  // Apps Script does.
  for (const file of ['shared/Config.gs', 'bootstrap/Common.gs', 'bootstrap/Setup1Skeleton.gs',
                      'bootstrap/Setup2Formulas.gs', 'bootstrap/Setup3Checks.gs',
                      'bootstrap/Setup4Dashboard.gs', 'bootstrap/SeedData.gs']) {
    eval(load(file));
  }

  console.log('computed columns');
  check('city', cityFormula_());
  check('upcoming', upcomingFormula_());
  check('when', whenFormula_('A2:A', 'B2:B', 'C2:C'));
  check('when (MID spelling)', midWhenFormula_('A2:A', 'B2:B', 'C2:C'));
  columnSpec_('events').filter(column => column.computed).forEach(column =>
    console.log(`  ${columnLetter_('events', column.key)}  ${column.header}`));

  console.log('picker lists');
  listBlocks_().forEach(block => {
    if (!Array.isArray(block[2])) check('list ' + block[1], block[2]);
    console.log(`  ${block[0]}  ${block[1]}` +
      (Array.isArray(block[2]) ? ` (${block[2].length} fixed values)` : ''));
  });
  Object.keys(listColumns_()).forEach(key => listRange_(key));

  console.log('hygiene checks');
  checkBlocks_().forEach(block => {
    check('check ' + block[1], block[2]);
    console.log(`  ${block[0]}  ${block[1]}`);
  });

  console.log('dashboard');
  check('filter', dashboardFilter_(true));
  check('filter, unwrapped', dashboardFilter_(false));
  check('filter, LET spelling', dashboardFilterLet_());
  check('count', dashboardCount_());
  console.log('  columns: ' + dashboardColumns_().map(key => headerOf_('events', key)).join(' | '));
  console.log('  protected: ' + protectedRanges_().concat(warnedRanges_())
    .map(entry => `${CONFIG.tabs[entry[0]]}!${entry[1]}`).join(', '));

  console.log('venue rules');
  check('incomplete address', venueIncomplete_());
  check('city only', venueCityOnly_());
  console.log('  ' + venueCityOnly_());

  console.log('seed data');
  const venues = seedVenues_().map(venue => venue[0]);
  const organisers = seedOrganisers_();
  seedEvents_().forEach((event, i) => {
    if (event[3] && !venues.includes(event[3])) {
      problems.push(`seedEvents_[${i}] "${event[2]}": unknown venue "${event[3]}"`);
    }
    if (event[4] && !organisers.includes(event[4])) {
      problems.push(`seedEvents_[${i}] "${event[2]}": unknown organiser "${event[4]}"`);
    }
  });
  Object.keys(seedVenueDetails_()).forEach(name => {
    if (!venues.includes(name)) problems.push(`seedVenueDetails_: "${name}" is not in seedVenues_`);
  });
  Object.keys(seedOrganiserDetails_()).forEach(name => {
    if (!organisers.includes(name)) {
      problems.push(`seedOrganiserDetails_: "${name}" is not in seedOrganisers_`);
    }
  });
  console.log(`  ${organisers.length} organisers · ${venues.length} venues · ` +
    `${seedEvents_().length} events, all cross-references resolve`);
});

console.log('');
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  problems.forEach(problem => console.log('  ' + problem));
  process.exit(1);
}
console.log('no problems found');
