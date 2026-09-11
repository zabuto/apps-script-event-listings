/**
 * Reuse by name, and the trash it has to look past.
 *
 * The one-time document setup finds its files by name so that re-running it keeps one id: every
 * link, short link and printed PDF points at that id, and creating a second file with the same name
 * is how they all go stale. `getFilesByName` and `getFoldersByName` answer with the trash included,
 * though, so the lookup that makes reuse possible also finds the file somebody deleted.
 *
 * Reusing a trashed one is worse than finding nothing. The run reports a stable id and prints it as
 * the one to configure, the rebuild writes into a file every reader's link shows as trashed, and
 * once the trash empties the id dies — while the lookup goes on finding it, so the step that would
 * recreate the file never does. Deleting the document is the obvious way to start again, and it is
 * exactly what must not leave the project stuck.
 *
 * `live_` is the single answer to that, and these hold it and its three callers to it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeDrive, fakeFolder } = require('./helpers/fakes');
const { fakeDocument } = require('./helpers/document');

const boot = loadProject('bootstrap');
const CONFIG = boot.CONFIG;

/** Runs `body` with the fakes in place and the run log reset, and hands back what it logged. */
function run(body, { document = null, drive = null } = {}) {
  const restore = installFakes({ document: document, drive: drive || fakeDrive({}) });
  boot.log_.length = 0;
  try {
    const value = body();
    return { value: value, report: boot.log_.join('\n') };
  } finally {
    restore();
  }
}

/* ── live_, which is the rule itself ────────────────────────────────────────────────────────── */

const iterate = items => {
  let at = 0;
  return { hasNext: () => at < items.length, next: () => items[at++] };
};
const item = (name, trashed) => ({ getName: () => name, isTrashed: () => trashed });

test('live_ drops the trashed entries and keeps the order of the rest', () => {
  const found = boot.live_(iterate([
    item('first', false), item('deleted', true), item('second', false),
  ]));
  assert.deepStrictEqual(found.map(entry => entry.getName()), ['first', 'second']);
});

test('live_ answers empty when every entry is trashed, which is the whole point', () => {
  assert.deepStrictEqual(boot.live_(iterate([item('deleted', true), item('also', true)])), []);
});

test('live_ answers empty for an empty iterator', () => {
  assert.deepStrictEqual(boot.live_(iterate([])), []);
});

/* ── the document ───────────────────────────────────────────────────────────────────────────── */

const DOC_ID = 'live-doc-id';

test('a trashed document is not reused — the run creates one instead of resurrecting it', () => {
  const document = fakeDocument({ id: DOC_ID });
  const folder = fakeFolder({ files: [{ name: CONFIG.doc.fileName, id: 'binned', trashed: true }] });
  const { value, report } = run(() => boot.ensureDoc_(folder), { document });

  assert.strictEqual(document.model.createdAs, CONFIG.doc.fileName,
    'the trashed document was reused rather than a new one created');
  assert.strictEqual(value.getId(), DOC_ID);
  assert.match(report, /created/);
  assert.strictEqual(/reused/.test(report), false,
    'the run reported reusing a document that is in the trash');
});

test('a live document is still reused, because one stable id is the point of the lookup', () => {
  const document = fakeDocument({ id: DOC_ID });
  const folder = fakeFolder({ files: [{ name: CONFIG.doc.fileName, id: DOC_ID }] });
  const { value, report } = run(() => boot.ensureDoc_(folder), { document });

  assert.strictEqual(document.model.createdAs, undefined, 'a second document was created');
  assert.strictEqual(value.getId(), DOC_ID);
  assert.match(report, /reused/);
});

test('a trashed namesake beside a live document is not counted as a stray', () => {
  // The stray warning tells a maintainer to go and delete files. Counting the trash would send them
  // after one that is already deleted, and the warning stops being read.
  const document = fakeDocument({ id: DOC_ID });
  const folder = fakeFolder({ files: [
    { name: CONFIG.doc.fileName, id: DOC_ID },
    { name: CONFIG.doc.fileName, id: 'binned', trashed: true },
  ] });
  const { report } = run(() => boot.ensureDoc_(folder), { document });

  assert.match(report, /reused/);
  assert.strictEqual(/more than one file/.test(report), false,
    'a file in the trash was reported as a stray to delete');
});

test('two live namesakes are reported, so the warning still fires where it should', () => {
  const document = fakeDocument({ id: DOC_ID });
  const folder = fakeFolder({ files: [
    { name: CONFIG.doc.fileName, id: DOC_ID },
    { name: CONFIG.doc.fileName, id: 'stray' },
  ] });
  const { report } = run(() => boot.ensureDoc_(folder), { document });
  assert.match(report, /more than one file/);
});

/* ── the logo ───────────────────────────────────────────────────────────────────────────────── */

test('a trashed logo is not found, so the document builds without one', () => {
  const folder = fakeFolder({
    files: [{ name: CONFIG.doc.logo.fileName, id: 'binned-logo', trashed: true }],
  });
  const { value, report } = run(() => boot.findLogo_(folder));

  assert.strictEqual(value, null, 'a logo in the trash was bound by id');
  assert.match(report, new RegExp(`no file called "${CONFIG.doc.logo.fileName}"`));
});

test('a live logo is found and reported by digest', () => {
  // The digest is the point of the report: the bound project binds the logo by id, so a file merely
  // called the right thing proves nothing.
  const folder = fakeFolder({
    files: [{ name: CONFIG.doc.logo.fileName, id: 'logo', bytes: [1, 2, 3, 4] }],
  });
  const { value, report } = run(() => boot.findLogo_(folder));

  assert.strictEqual(value.getId(), 'logo');
  assert.match(report, /MD5 [0-9a-f]{32}/, 'the digest is not 32 lowercase hex characters');
});

/* ── the archive folder ─────────────────────────────────────────────────────────────────────── */

test('a trashed archive folder is not reused — a new one is created', () => {
  const folder = fakeFolder({
    folders: [{ name: CONFIG.doc.pdfFolderName, id: 'binned-folder', trashed: true }],
  });
  const { value, report } = run(() => boot.ensurePdfFolder_(folder));

  assert.deepStrictEqual(folder.created.folders, [CONFIG.doc.pdfFolderName]);
  assert.strictEqual(value.getId().includes('binned'), false,
    'the id of a folder in the trash was handed back');
  assert.match(report, /created/);
});

test('a live archive folder is reused', () => {
  const folder = fakeFolder({
    folders: [{ name: CONFIG.doc.pdfFolderName, id: 'archive' }],
  });
  const { value, report } = run(() => boot.ensurePdfFolder_(folder));

  assert.deepStrictEqual(folder.created.folders, []);
  assert.strictEqual(value.getId(), 'archive');
  assert.match(report, /reused/);
});
