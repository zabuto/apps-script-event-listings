/**
 * The menu, which is the only interface a maintainer ever sees.
 *
 * `onOpen` offers an item only if its function exists, and holds a separator back until something
 * follows it. Both are deliberate — an item answering `Script function not found` is worse than a
 * missing one — and the first has a failure mode of its own: a typo in `menuItems_` does not raise,
 * it removes a working feature from the menu, silently, on every open.
 *
 * The file ends with the entry points that have no behavioural test, recorded so they read as known
 * holes rather than as covered. `cross-project-helpers.test.js` ends the same way.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeUi } = require('./helpers/fakes');

const src = loadProject('src');
const CONFIG = src.CONFIG;

/**
 * Puts the project's own functions on `globalThis`, which is where Apps Script keeps them.
 *
 * `onOpen` decides what to offer with `typeof globalThis[name] !== 'function'`, which works in
 * Google because a project's files share one global scope. `project.js` isolates each project
 * instead, so that two projects in one test file cannot see each other's helpers — undone here for
 * this one function, and put back afterwards.
 */
function withProjectGlobals(project, run) {
  const saved = new Map();
  for (const [name, value] of Object.entries(project)) {
    if (typeof value !== 'function') continue;
    saved.set(name, { had: name in globalThis, value: globalThis[name] });
    globalThis[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, previous] of saved) {
      if (previous.had) globalThis[name] = previous.value;
      else delete globalThis[name];
    }
  }
}

/** Runs `onOpen` against a recording UI and hands back the menu it built. */
function openedMenu() {
  const ui = fakeUi();
  const restore = installFakes({ ui: ui });
  let menus;
  try {
    withProjectGlobals(src, () => src.onOpen());
    menus = ui.menus;
  } finally {
    restore();
  }
  assert.strictEqual(menus.length, 1, `onOpen built ${menus.length} menus, expected one`);
  // A menu with nothing in it means the harness is not reproducing the scope `onOpen` resolves
  // against, and every check below would pass for the wrong reason.
  assert.ok(menus[0].items.length > 0,
    'onOpen offered nothing at all, so every assertion about the menu would be vacuous');
  return menus[0];
}

/* ── menuItems_, and the silent drop ───────────────────────────────────────────────────────── */

test('every function the menu offers exists, so no item is silently dropped', () => {
  // `onOpen` skips an item whose function is missing: right for one deliberately deleted, wrong
  // for one mistyped, and the two are indistinguishable at run time.
  const named = src.menuItems_().filter(Boolean).map(item => item[1]);
  assert.ok(named.length > 0, 'the menu offers nothing, so this test compared nothing');
  for (const functionName of named) {
    assert.strictEqual(typeof src[functionName], 'function',
      `menuItems_ offers "${functionName}", which is not a function in this project — a typo here ` +
      'removes the item from the menu instead of failing');
  }
});

test('every menu item has a caption, and the pair is [caption, function]', () => {
  for (const item of src.menuItems_().filter(Boolean)) {
    assert.strictEqual(item.length, 2, `${JSON.stringify(item)} is not a [caption, function] pair`);
    assert.ok(item[0] && typeof item[0] === 'string', `${JSON.stringify(item)} has no caption`);
  }
});

/* ── onOpen ─────────────────────────────────────────────────────────────────────────────────── */

test('the menu is built under the configured name and added to the UI', () => {
  const menu = openedMenu();
  assert.strictEqual(menu.title, CONFIG.brand.menu);
  assert.strictEqual(menu.addedToUi, true, 'the menu was built and never added');
});

test('the menu offers every configured item, in order', () => {
  const menu = openedMenu();
  assert.deepStrictEqual(
    menu.items.filter(Boolean).map(item => [item.caption, item.functionName]),
    src.menuItems_().filter(Boolean));
});

test('a separator never leads or trails, because a menu cannot open on a divider', () => {
  const menu = openedMenu();
  assert.notStrictEqual(menu.items[0], null, 'the menu opens on a separator');
  assert.notStrictEqual(menu.items[menu.items.length - 1], null, 'the menu ends on a separator');
  assert.strictEqual(menu.items.some((item, i) => item === null && menu.items[i + 1] === null),
    false, 'two separators in a row');
});

test('an item whose function is missing is skipped, and takes its separator with it', () => {
  // Deleting a function shrinks the menu rather than leaving an item that errors when pressed.
  // The last item is the one sitting behind the final separator.
  const items = src.menuItems_();
  const last = items[items.length - 1][1];
  const saved = src[last];
  const savedGlobal = globalThis[last];
  src[last] = undefined;
  globalThis[last] = undefined;
  try {
    const menu = openedMenu();
    assert.strictEqual(menu.items.some(item => item && item.functionName === last), false,
      'the item was offered although its function is gone');
    assert.notStrictEqual(menu.items[menu.items.length - 1], null,
      'the separator that preceded the dropped item was left dangling at the end');
  } finally {
    src[last] = saved;
    if (savedGlobal === undefined) delete globalThis[last];
    else globalThis[last] = savedGlobal;
  }
});

/* ── what is not covered, said out loud ─────────────────────────────────────────────────────── */

test('the entry points with no behavioural test are the ones on record', () => {
  // Each reaches a Google service this suite does not fake. They are thin, but "thin" is a
  // judgement rather than a test, so the gap is named instead of left to look like coverage.
  // Adding to this list is a decision; removing from it should mean a test now exists.
  const untested = {
    installWeeklyRefresh: 'ScriptApp trigger builder — newTrigger().timeBased().onWeekDay()…',
    saveEventsPdf: 'DriveApp getAs(MimeType.PDF) into a folder, and MimeType itself',
    showConfiguration: 'resolves every configured id against Drive to report whether it still opens',
  };
  for (const [name, why] of Object.entries(untested)) {
    assert.strictEqual(typeof src[name], 'function',
      `${name} is recorded as untested (${why}) but no longer exists — update the list`);
  }
});
