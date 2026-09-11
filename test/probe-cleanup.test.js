/**
 * `probeInPlace_`, which evaluates formulas in cells of a tab that is not throwaway.
 *
 * Every other probe in this codebase writes to a tab of its own and deletes it in a `finally`. Two
 * of the dashboard's formulas cannot be probed that way: `$B$1:$B$3` are relative to the sheet
 * holding them, so the filter means something different anywhere else, and it has to be evaluated on
 * the dashboard itself.
 *
 * That makes the cleanup the subject. The cells sit on a tab a maintainer reads, in columns outside
 * the block `writeDashboard_` rewrites, so nothing else would ever remove them — and one of the two
 * formulas probed this way is the `LET` spelling, which is expected to fail. A probe that cleans up
 * only when it succeeds is a probe that litters exactly when it is doing its job.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes } = require('./helpers/fakes');

const boot = loadProject('bootstrap');

/**
 * A tab that records every write and clear, and computes whatever the fixture says.
 *
 * `computed` maps a cell to its display value; a cell not named there computes to nothing, which is
 * what a formula that failed looks like from the outside.
 */
function probeSheet({ computed = {}, failOn = null } = {}) {
  const model = { written: [], cleared: [] };
  const sheet = {
    model: model,
    getRange: a1 => ({
      setFormula: formula => {
        if (a1 === failOn) throw new Error(`setFormula failed on ${a1}`);
        model.written.push({ cell: a1, formula: formula });
      },
      getDisplayValue: () => {
        if (a1 === failOn) throw new Error(`getDisplayValue failed on ${a1}`);
        return computed[a1] === undefined ? '' : computed[a1];
      },
      clearContent: () => { model.cleared.push(a1); },
    }),
  };
  return sheet;
}

const PROBES = [
  ['controls', 'J1', '=IF(1=1,"a","b")'],
  ['flat', 'K1', '=ROWS(A1:A3)'],
  ['LET', 'L1', '=ROWS(B1:B3)'],
];

function withFakes(body) {
  const restore = installFakes({});
  try {
    return body();
  } finally {
    restore();
  }
}

/* ── the happy path ─────────────────────────────────────────────────────────────────────────── */

test('every probed cell is written, read and then cleared', () => {
  const sheet = probeSheet({ computed: { J1: '[a] [b] [c]', K1: '3', L1: '#N/A' } });
  const lines = withFakes(() => boot.probeInPlace_(sheet, ',', PROBES));

  assert.deepStrictEqual(lines, ['controls: [a] [b] [c]', 'flat: 3', 'LET: #N/A']);
  assert.deepStrictEqual(sheet.model.written.map(write => write.cell), ['J1', 'K1', 'L1']);
  assert.deepStrictEqual(sheet.model.cleared, ['J1', 'K1', 'L1']);
});

test('a probed formula that computes to an error is reported, not swallowed', () => {
  // Telling a failing spelling from a succeeding one is why these are probed at all.
  const sheet = probeSheet({ computed: { J1: '[a]', K1: '12', L1: '#N/A' } });
  const lines = withFakes(() => boot.probeInPlace_(sheet, ',', PROBES));
  assert.strictEqual(lines[2], 'LET: #N/A');
});

test('the formula is written in the dialect the sheet parses', () => {
  const sheet = probeSheet({ computed: { J1: 'a' } });
  const written = withFakes(() => {
    boot.probeInPlace_(sheet, ';', [['one', 'J1', '=IF(1=1,"a, b","c")']]);
    return sheet.model.written[0].formula;
  });
  assert.strictEqual(written, '=IF(1=1;"a, b";"c")', 'the separator was not translated');
});

/* ── the regression ─────────────────────────────────────────────────────────────────────────── */

test('a failure while reading still clears every cell the probe wrote', () => {
  const sheet = probeSheet({ computed: { J1: '[a]' }, failOn: 'L1' });
  assert.throws(() => withFakes(() => boot.probeInPlace_(sheet, ',', PROBES)), /L1/);
  assert.deepStrictEqual(sheet.model.cleared, ['J1', 'K1', 'L1'],
    'scratch formulas were left on a tab a maintainer reads');
});

test('a failure while writing still clears the cells, including the one that failed', () => {
  // Clearing a cell that was never written costs nothing; leaving one that was is the whole bug.
  const sheet = probeSheet({ failOn: 'K1' });
  assert.throws(() => withFakes(() => boot.probeInPlace_(sheet, ',', PROBES)), /K1/);
  assert.deepStrictEqual(sheet.model.cleared, ['J1', 'K1', 'L1']);
});

/* ── the caller it exists for ───────────────────────────────────────────────────────────────── */

test('the dashboard probe leaves no cell of its own behind', () => {
  // `writeDashboard_` clears and rewrites A6 down across the dashboard's own width only, so a cell
  // outside that block is cleared by this probe or by nothing.
  const width = boot.dashboardColumns_().length;
  const source = require('fs')
    .readFileSync(require('path').join(__dirname, '..', 'bootstrap', 'Setup4Dashboard.gs'), 'utf8');
  const probed = [...source.matchAll(/probeInPlace_\(dash[\s\S]*?\]\)/g)];
  assert.strictEqual(probed.length, 1, 'the dashboard probe is no longer a single probeInPlace_ call');
  const cells = [...probed[0][0].matchAll(/'([A-Z]{1,2})\d+'/g)].map(match => match[1]);
  assert.ok(cells.length, 'no probed cells found — the fixture, not the code');
  for (const column of cells) {
    assert.ok(column.charCodeAt(0) - 64 > width,
      `${column} is inside the dashboard's own ${width} columns, which the probe must not touch`);
  }
});
