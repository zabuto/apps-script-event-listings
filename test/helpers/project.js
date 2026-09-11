/**
 * Loads an Apps Script project the way Apps Script itself does: every file into one shared scope,
 * in one order, with no module boundaries between them.
 *
 * That is the whole reason this repo can be tested offline at all, and it is the same trick
 * `scripts/check-formulas.js` uses. It is done with `new Function` rather than `eval` so each call
 * gets a fresh, isolated scope — two projects loaded in one test file must not see each other's
 * helpers, because in Google they never would. A whole set of helper names exists in *both* projects;
 * `cross-project-helpers.test.js` holds that list and keeps the two copies in step.
 *
 * `const` and `let` are rewritten to `var` for the same reason as in `check-formulas.js`: the
 * concatenated source declares some names more than once, and only `var` tolerates that.
 *
 * Free identifiers inside the returned functions resolve against `globalThis` at call time, which is
 * what lets `installFakes()` stand in for `SpreadsheetApp` and friends *after* loading.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

/** The files of each project, in the order the build depends on. */
const PROJECTS = {
  bootstrap: [
    'shared/Config.gs',
    'bootstrap/Common.gs',
    'bootstrap/Setup1Skeleton.gs',
    'bootstrap/Setup2Formulas.gs',
    'bootstrap/Setup3Checks.gs',
    'bootstrap/Setup4Dashboard.gs',
    'bootstrap/Setup5Document.gs',
    'bootstrap/SeedData.gs',
    'bootstrap/ToolSeed.gs',
    'bootstrap/ToolCapture.gs',
    'bootstrap/ToolState.gs',
    'bootstrap/SetupAll.gs',
  ],
  src: [
    'src/Config.gs',
    'src/Code.gs',
  ],
};

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm, 'var ');
}

/**
 * Every top-level binding the concatenated source declares — the project's "globals", which is
 * exactly what Apps Script would expose to every other file in it.
 */
function declaredNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^var\s+([A-Za-z0-9_$]+)/gm)) names.add(match[1]);
  return [...names];
}

/**
 * Loads one project and hands back everything it declares.
 *
 * @param {'bootstrap'|'src'} name
 * @returns {Object} every top-level function and variable the project declares
 */
function loadProject(name) {
  const files = PROJECTS[name];
  if (!files) throw new Error(`No such project "${name}" — use 'bootstrap' or 'src'.`);

  const source = files.map(readSource).join('\n\n');
  const names = declaredNames(source);
  // Built inside a function body, so these declarations never touch the real global scope.
  const factory = new Function(`${source}\nreturn { ${names.join(', ')} };`);
  return factory();
}

/** The raw text of a project's files, for the checks that compare source rather than behaviour. */
function projectSource(name) {
  return PROJECTS[name].map(readSource).join('\n\n');
}

module.exports = { loadProject, projectSource, readSource, PROJECTS, root };
