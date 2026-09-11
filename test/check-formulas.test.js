/**
 * Folds `scripts/check-formulas.js` into the one command, so `node --test test/` really is the
 * whole suite and not most of it.
 *
 * It stays a script rather than being rewritten as tests: run directly it prints a readable
 * inventory of every formula the build generates, which is the thing you want in front of you after
 * a config change. Here only its verdict matters.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { root } = require('./helpers/project');

function runCheckFormulas() {
  try {
    return { status: 0, output: execFileSync(process.execPath,
      [path.join(root, 'scripts', 'check-formulas.js')], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, output: (err.stdout || '') + (err.stderr || '') };
  }
}

test('every generated formula is structurally sound', () => {
  const result = runCheckFormulas();
  assert.strictEqual(result.status, 0,
    `scripts/check-formulas.js reported problems:\n\n${result.output}`);
  assert.match(result.output, /no problems found/);
});

test('every generated copy is in sync with its canonical file in shared/', () => {
  // The same guard, named separately: this is the one that catches a forgotten sync-config.sh, and
  // a drift between a copy and its canonical file is silent and total.
  const result = runCheckFormulas();

  // Proving the checker *ran* has to come first. Asserting only that the output lacks "differs
  // from" passes just as happily when there is no output at all — a missing or crashed script would
  // report the copies as in sync, which is the one answer this test must never give by default.
  assert.match(result.output, /computed columns/,
    `scripts/check-formulas.js did not run:\n\n${result.output}`);
  assert.strictEqual(/differs from shared\//.test(result.output), false,
    'run ./scripts/sync-config.sh');
});
