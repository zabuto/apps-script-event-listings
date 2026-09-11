/**
 * What the build actually builds.
 *
 * `setupAll` is the only thing an installer runs, so anything a finished sheet needs has to be in
 * `setupSteps_()`. A step missing from it does not fail: the run reports every step it *did* take as
 * `ok`, the dialog says `build complete`, and the gap surfaces much later as a tab that looks
 * unfinished — indistinguishable from a maintainer having deleted something.
 *
 * The hygiene checks are the case that decides where the boundary sits. They are formulas on the
 * `Lists` tab, no different from the picker lists beside them, and an empty check cell is precisely
 * how this codebase says *the check did not run*. Seeding is optional, so nothing optional may be the
 * only thing that writes them.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');

const boot = loadProject('bootstrap');

/** Entry points that build or repair the sheet, and so belong to the build. */
const BUILD_STEPS = ['setupSkeleton', 'setupFormulas', 'setupChecks', 'setupDashboard',
  'setupDocument'];

/**
 * Entry points deliberately outside the build, with the reason each one is out.
 *
 * Absence from `setupAll` does not by itself make something a tool. A tool does something other than
 * build: it writes data, writes a file, or only reads. `repairDashboard` does none of those — it is
 * step 4 over a narrower range, which is why it stays beside `setupDashboard` and shares
 * `writeDashboard_` with it.
 */
const NOT_STEPS = {
  seedSheet: 'rewrites the three data tabs — destructive on a sheet in use',
  captureSheetData: 'writes a file to Drive; changes no part of the sheet',
  reportState: 'reads the sheet back and reports; writes only a throwaway probe tab',
  repairDashboard: 'a narrower rerun of the dashboard step, not a separate stage of the build',
};

test('every build step is in setupAll, in an order that respects what it reads', () => {
  assert.deepStrictEqual(boot.setupSteps_().map(step => step[0]),
    ['skeleton', 'formulas', 'checks', 'dashboard', 'document']);
});

test('each step names a function that exists, so no step can fail as "not a function"', () => {
  for (const [name, run] of boot.setupSteps_()) {
    assert.strictEqual(typeof run, 'function', `the "${name}" step is not a function`);
  }
});

test('the build writes the hygiene checks, so an unseeded sheet still has them', () => {
  // `writeChecks_` has two callers and one of them is optional, so the build has to be the other.
  const run = boot.setupSteps_().map(step => step[1]);
  assert.ok(run.includes(boot.setupChecks),
    'setupChecks is not part of setupAll — the Lists checks stay empty until someone seeds');
});

test('every entry point that builds the sheet is accounted for as a step', () => {
  const named = new Set(boot.setupSteps_().map(step => step[1]));
  for (const name of BUILD_STEPS) {
    assert.strictEqual(typeof boot[name], 'function', `${name} no longer exists`);
    assert.ok(named.has(boot[name]), `${name} builds the sheet but is not a step in setupAll`);
  }
});

test('the entry points kept out of the build are the ones on record, and each still exists', () => {
  // Adding to this list is a decision about what the build owns; removing from it should mean the
  // function is now a step. Either way it is written down rather than inferred from an absence.
  const named = new Set(boot.setupSteps_().map(step => step[1]));
  for (const [name, why] of Object.entries(NOT_STEPS)) {
    assert.strictEqual(typeof boot[name], 'function',
      `${name} is recorded as outside the build (${why}) but no longer exists`);
    assert.strictEqual(named.has(boot[name]), false,
      `${name} is recorded as outside the build (${why}) but setupAll now runs it`);
  }
});
