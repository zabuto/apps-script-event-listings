/**
 * Just enough of Apps Script to run the pure-ish parts of this codebase outside Google.
 *
 * Deliberately not a general emulator. Each stub does the one thing the code under test actually
 * asks of it, and throws on anything else rather than returning a plausible-looking lie — a fake
 * that quietly answers is how a test passes against behaviour Google does not have.
 *
 * `Utilities.formatDate` is the exception: it is implemented for real, against `Intl`, because the
 * whole point of the time-zone tests is that a date is projected into a *named* zone. A stub that
 * ignored the zone argument would make the bug it exists to catch invisible.
 */

/* ───────────────────────────────────────────────────────────────────────────── Utilities ─── */

const crypto = require('node:crypto');
const { documentApp } = require('./document');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** The zone a fixture sits in when it has no reason to care — matching `CONFIG.timeZone` is chance. */
const FIXTURE_ZONE = 'Europe/Amsterdam';

/** The calendar parts of an instant, as seen from a named zone. */
function partsIn(zone, date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const found = {};
  for (const part of formatter.formatToParts(date)) found[part.type] = part.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour === '24' ? '00' : found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/**
 * The subset of Java's `SimpleDateFormat` this codebase actually uses: `yyyy`, `MMMM`, `MMM`, `MM`,
 * `dd`, `d`. Longest token first, so `MMMM` is never eaten as `MM` + `MM`.
 */
function formatDate(date, zone, pattern) {
  if (!(date instanceof Date)) throw new Error('Utilities.formatDate: not a Date');
  const at = partsIn(zone, date);
  const pad = (n, width) => String(n).padStart(width, '0');
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|d/g, token => ({
    yyyy: pad(at.year, 4),
    MMMM: MONTHS[at.month - 1],
    MMM: MONTHS[at.month - 1].slice(0, 3),
    MM: pad(at.month, 2),
    dd: pad(at.day, 2),
    d: String(at.day),
  })[token]);
}

/**
 * The inverse: the instant at which a given calendar day starts in a given zone.
 *
 * This is what a date-only cell actually is. `getValues()` hands back midnight *in the
 * spreadsheet's zone*, not in the script's — the distinction the agenda's cutoff turns on.
 */
function midnightIn(zone, ymd) {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const seen = partsIn(zone, guess);
  const asUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return new Date(+guess - (asUtc - +guess));
}

/* ────────────────────────────────────────────────────────────────────────── SpreadsheetApp ─── */

/** A range over a fixed block of values. Only the reads the code under test performs. */
function fakeRange(values) {
  return {
    getValues: () => values.map(row => row.slice()),
    getDisplayValues: () => values.map(row => row.map(cell =>
      cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell === null ? '' : cell))),
    getValue: () => values[0][0],
    getDisplayValue: () => String(values[0][0] === null ? '' : values[0][0]),
  };
}

/** `A2` → row 1, column 1. Only the single-cell form, which is all the code under test writes. */
function parseA1_(reference) {
  const found = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(reference);
  if (!found) {
    throw new Error(`getRange("${reference}"): only a single cell like "A2" is faked here`);
  }
  let column = 0;
  for (const letter of found[1].toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(found[2]), column: column };
}

/**
 * A tab holding a header row and rows beneath it.
 *
 * `getLastRow` counts the rows it was given, which is the honest answer for a tab of *typed* data
 * and the wrong one for a tab fed by a formula. `docs/gotchas.md`: an array formula returns `""`
 * for every empty row, an empty string is a value, and the sheet duly reports a thousand rows. The
 * events tab is such a tab — `setupFormulas` writes `city`, `when` and `upcoming` as
 * `=ARRAYFORMULA(IF(title="","", …))` into row 2, spilling the whole column — and `table_` reads
 * `getLastRow()` directly, so `table_('events').rows` is a thousand rows with a handful typed.
 *
 * `lastRow` is that shape: rows below the ones given come back blank, as the array formula's `""`
 * does. It may not be less than the rows given, which would describe nothing real.
 *
 * `maxColumns` widens the tab past its headers — the state `refreshMapExport` clears, a column left
 * over from an earlier contract whose header a formula change does not clean up.
 *
 * `spill` is what a formula written into a cell computes to. Nothing here evaluates a formula, so a
 * test that exercises a formula writer says what the sheet came back with and `setFormula` lays
 * that block out from the cell written into. Without it `setFormula` throws: an empty tab is a
 * *result*, and a report asserted against a formula that never ran proves nothing. `spill: []` says
 * it computed nothing, which is a different statement from saying nothing.
 *
 * `coerce` stands in for what Sheets makes of a written value: it is given each one on the way in,
 * and its answer is what the cell holds — so a writer that reads its own block back is testable
 * against a cell that kept something else.
 *
 * Writes are recorded on `model` as well as applied, so a test can assert *where* the code wrote —
 * the anchor a spilled formula depends on — and not only what came back.
 */
function fakeSheet(name, headers, rows,
  { lastRow = null, maxColumns = null, spill = null, validation = null, coerce = null } = {}) {
  const grid = [headers.slice(), ...rows.map(row => {
    const filled = row.slice();
    while (filled.length < headers.length) filled.push('');
    return filled;
  })];
  if (lastRow !== null && lastRow < grid.length) {
    throw new Error(`fakeSheet("${name}"): lastRow ${lastRow} is fewer than the ` +
      `${grid.length} row(s) given, header included — a tab cannot report fewer rows than it holds`);
  }
  const last = lastRow === null ? grid.length : lastRow;
  const columns = maxColumns === null ? headers.length : maxColumns;
  if (columns < headers.length) {
    throw new Error(`fakeSheet("${name}"): maxColumns ${columns} is narrower than its ` +
      `${headers.length} header(s)`);
  }

  /**
   * Strict dropdowns, by column letter: `{ D: ['Venue A', 'Venue B'] }`.
   *
   * Only the strict kind is modelled, because only the strict kind changes what a script can do:
   * Sheets refuses a `setValues` carrying a value the rule does not allow, names one cell, and
   * writes none of the block. A fake that let the write through would pass a seed that a live sheet
   * rejects, which is exactly how that failure reached a manual run.
   */
  const rules = new Map();
  for (const [letter, allowed] of Object.entries(validation || {})) {
    rules.set(letter.toUpperCase().charCodeAt(0) - 64, new Set(allowed.map(String)));
  }
  /** Cells the code cleared the rule from, so a write may pass. Keyed `row,column`. */
  const suspended = new Set();

  /** Every write the code under test made, for the assertions that care where it landed. */
  const model = {
    name: name, grid: grid, frozenRows: null,
    formulas: [],   // { row, column, formula }
    cleared: [],    // { row, column, height, width }
    formats: [],    // { row, column, height, width, ...styles }
  };

  const cell = (row, column, value) => {
    while (grid.length < row) grid.push([]);
    const line = grid[row - 1];
    while (line.length < column) line.push('');
    line[column - 1] = value;
  };

  const rangeAt = (row, column, height, width) => {
    const read = () => {
      const block = [];
      for (let r = 0; r < height; r++) {
        const source = grid[row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < width; c++) {
          const found = source[column - 1 + c];
          line.push(found === undefined ? '' : found);
        }
        block.push(line);
      }
      return block;
    };
    const range = Object.assign({}, fakeRange(read()), {
      // A range is a window on the sheet, not a snapshot: this one is read back after being
      // written through.
      getValues: () => read(),
      getDisplayValues: () => fakeRange(read()).getDisplayValues(),
      getValue: () => read()[0][0],
      getDisplayValue: () => fakeRange(read()).getDisplayValue(),
      clearContent: () => {
        model.cleared.push({ row: row, column: column, height: height, width: width });
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) cell(row + r, column + c, '');
        }
        return range;
      },
      setValues: values => {
        if (values.length !== height || values.some(line => line.length !== width)) {
          throw new Error(`setValues: given ${values.length}×${values[0] && values[0].length}, ` +
            `range is ${height}×${width} — Sheets refuses a mismatch and so does this`);
        }
        // Checked before anything is written, and it names one cell: that is the shape of the real
        // failure, and a block half written would be a state Sheets never leaves behind.
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) {
            const allowed = rules.get(column + c);
            if (!allowed || suspended.has(`${row + r},${column + c}`)) continue;
            const value = values[r][c];
            if (value === '' || allowed.has(String(value))) continue;
            throw new Error(`The data entered in cell ` +
              `${String.fromCharCode(64 + column + c)}${row + r} does not meet the data validation ` +
              'rules set for this cell.');
          }
        }
        values.forEach((line, r) => line.forEach((value, c) =>
          cell(row + r, column + c, coerce ? coerce(value) : value)));
        return range;
      },
      getDataValidations: () => {
        const block = [];
        for (let r = 0; r < height; r++) {
          const line = [];
          for (let c = 0; c < width; c++) {
            const allowed = rules.get(column + c);
            line.push(allowed && !suspended.has(`${row + r},${column + c}`)
              ? { allowed: allowed } : null);
          }
          block.push(line);
        }
        return block;
      },
      clearDataValidations: () => {
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) suspended.add(`${row + r},${column + c}`);
        }
        return range;
      },
      setDataValidations: block => {
        if (block.length !== height || block.some(line => line.length !== width)) {
          throw new Error(`setDataValidations: given ${block.length}×` +
            `${block[0] && block[0].length}, range is ${height}×${width}`);
        }
        block.forEach((line, r) => line.forEach((rule, c) => {
          const key = `${row + r},${column + c}`;
          if (rule) suspended.delete(key);
          else suspended.add(key);
        }));
        return range;
      },
      setFormula: formula => {
        if (height !== 1 || width !== 1) {
          throw new Error('setFormula: only the single-cell form is faked here');
        }
        model.formulas.push({ row: row, column: column, formula: formula });
        if (spill === null) {
          throw new Error(`fakeSheet("${name}"): a formula was written to row ${row}, column ` +
            `${column}, but the fixture gave no \`spill\` — say what the sheet computes, or the ` +
            'report under test is asserted against a formula that never ran');
        }
        spill.forEach((line, r) => line.forEach((value, c) => cell(row + r, column + c, value)));
        return range;
      },
    });
    for (const style of ['setBackground', 'setFontColor', 'setFontWeight', 'setNumberFormat']) {
      range[style] = value => {
        model.formats.push({ row: row, column: column, height: height, width: width,
          style: style, value: value });
        return range;
      };
    }
    return range;
  };

  return {
    model: model,
    getName: () => name,
    // The read-backs print how many rules a tab carries. Nothing here writes one, so the honest
    // answer is none — a fake that invented a plausible count would be asserting its own fixture.
    getConditionalFormatRules: () => [],
    getLastRow: () => last,
    getMaxRows: () => Math.max(last, 1000),
    getMaxColumns: () => columns,
    setFrozenRows: count => { model.frozenRows = count; },
    getRange(row, column, numRows, numColumns) {
      if (typeof row === 'string') {
        const at = parseA1_(row);
        return rangeAt(at.row, at.column, 1, 1);
      }
      return rangeAt(row, column, numRows === undefined ? 1 : numRows,
        numColumns === undefined ? 1 : numColumns);
    },
  };
}

/**
 * A spreadsheet built from `{ tabKey: rows }`, with headers taken from the live column contract so a
 * test can never drift from `CONFIG.columns` — the contract is the thing being relied on, not a
 * copy of it pasted into a fixture.
 *
 * A tab may also be given as `{ rows, headers }`. Spelling the headers is right in two cases: a
 * header row that deliberately does *not* match the contract, which `table_` exists to refuse; and
 * the map export tab, which has no `CONFIG.columns` entry at all — its row 1 is
 * `CONFIG.mapExport.headers`, written by `refreshMapExport`. Anywhere else a spelled header row is
 * a copy of the contract, and the copy is what goes stale.
 *
 * `timeZone` defaults to `FIXTURE_ZONE`. A test whose answer depends on the zone names its own; one
 * that must agree with the shipped config passes `CONFIG.timeZone`.
 *
 * `lastRow`, `maxColumns`, `spill` and `coerce` pass through to `fakeSheet`.
 */
function fakeSpreadsheet(config, { timeZone = FIXTURE_ZONE, tabs = {} } = {}) {
  const sheets = {};
  for (const [tabKey, given] of Object.entries(tabs)) {
    const name = config.tabs[tabKey];
    if (!name) throw new Error(`No CONFIG.tabs entry for "${tabKey}"`);
    const spec = Array.isArray(given) ? { rows: given } : given;
    const contract = config.columns[tabKey];
    if (!spec.headers && !contract) {
      throw new Error(`"${tabKey}" has no CONFIG.columns contract, so its header row cannot be ` +
        'taken from one — spell `headers` for this tab');
    }
    const headers = spec.headers || contract.map(column => column.header);
    sheets[name] = fakeSheet(name, headers, spec.rows || [], {
      lastRow: spec.lastRow || null,
      maxColumns: spec.maxColumns || null,
      spill: spec.spill === undefined ? null : spec.spill,
      validation: spec.validation || null,
      coerce: spec.coerce || null,
    });
  }
  const spreadsheet = {
    getName: () => config.spreadsheet.fileName,
    getId: () => 'fake-spreadsheet-id',
    getSpreadsheetTimeZone: () => timeZone,
    getSpreadsheetLocale: () => config.spreadsheet.locale,
    getSheetByName: name => sheets[name] || null,
    getSheets: () => Object.values(sheets),
  };
  // A sheet knows its file, which is how the seed writers reach the time zone a date is read in.
  for (const sheet of Object.values(sheets)) sheet.getParent = () => spreadsheet;
  return spreadsheet;
}

/**
 * One row of a tab, in contract order, from `{ columnKey: value }`.
 *
 * Addressing columns by `key`, applied to the fixtures: a test that spelled a position would go on
 * describing a different event after a column moved, and would keep passing while doing it.
 * Unfilled columns come back as `''`, which is what an untyped cell hands to `getValues()`.
 */
function rowFor(config, tabKey, values) {
  const columns = config.columns[tabKey];
  if (!columns) throw new Error(`No CONFIG.columns entry for "${tabKey}"`);
  const row = columns.map(() => '');
  for (const [key, value] of Object.entries(values)) {
    const at = columns.findIndex(column => column.key === key);
    if (at < 0) throw new Error(`No "${key}" column on ${tabKey} — check the fixture, not the code.`);
    row[at] = value;
  }
  return row;
}

/* ──────────────────────────────────────────────────────────────────────────────── DriveApp ─── */

/**
 * The two things the document path asks of Drive: a logo blob, and re-asserting the sharing.
 *
 * `unreadable` is the case worth having: a logo id that no longer resolves must be skipped, never
 * allowed to block the listing, and the only way to assert that is to have Drive throw. Every id not
 * named in `blobs` or `unreadable` is unknown and throws too — a fake that handed back a plausible
 * blob for any id would make a wrong `CONFIG.properties.logoFileId` invisible.
 */
function fakeDrive({ blobs = {}, unreadable = [] } = {}) {
  const app = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    /** Every `setSharing` this run made, for the assertion that it happened — or did not. */
    recordedSharing: [],
    /** Every `moveTo`, which is how a newly created file reaches the project folder. */
    movedTo: [],
    getFileById: id => {
      if (unreadable.includes(id)) {
        throw new Error(
          `No item with the given ID could be found, or you do not have permission: ${id}`);
      }
      return {
        getId: () => id,
        getBlob: () => {
          if (!(id in blobs)) throw new Error(`DriveApp.getFileById("${id}"): no fake blob given`);
          return { id: id, content: blobs[id] };
        },
        setSharing: (access, permission) => {
          app.recordedSharing.push({ id: id, access: access, permission: permission });
        },
        // A document created by the one-time setup lands in My Drive root and is moved from there.
        moveTo: folder => { app.movedTo.push({ id: id, folder: folder.getName() }); },
      };
    },
  };
  return app;
}

/**
 * A Drive folder holding named files and subfolders, some of them trashed.
 *
 * Trash is the whole subject: `getFilesByName` and `getFoldersByName` answer with it included, which
 * is the one behaviour of theirs a reuse-by-name has to know about. Entries are given as
 * `{ name, trashed }`, and the iterator hands them back in order, trashed ones and all — exactly as
 * Drive would, so a lookup that forgets to filter finds one here too.
 *
 * `created` records what the code under test made rather than reused, which is what the assertions
 * are actually about.
 */
function fakeFolder({ name = 'Event Listings', files = [], folders = [] } = {}) {
  const created = { files: [], folders: [] };
  const iterator = items => {
    let at = 0;
    return { hasNext: () => at < items.length, next: () => items[at++] };
  };
  const entry = (spec, kind) => {
    const item = {
      getName: () => spec.name,
      getId: () => spec.id || `${kind}:${spec.name}${spec.trashed ? ':trashed' : ''}`,
      isTrashed: () => Boolean(spec.trashed),
      getBlob: () => ({ getBytes: () => spec.bytes || [1, 2, 3] }),
      setContent: text => { spec.content = text; },
      setSharing: () => item,
      moveTo: () => item,
    };
    return item;
  };
  const fileItems = files.map(spec => entry(spec, 'file'));
  const folderItems = folders.map(spec => entry(spec, 'folder'));

  const folder = {
    created: created,
    getName: () => name,
    getId: () => 'folder:' + name,
    isTrashed: () => false,
    getFilesByName: wanted => iterator(fileItems.filter(file => file.getName() === wanted)),
    getFoldersByName: wanted => iterator(folderItems.filter(sub => sub.getName() === wanted)),
    createFolder: wanted => {
      created.folders.push(wanted);
      const made = entry({ name: wanted, id: `folder:${wanted}:new` }, 'folder');
      folderItems.push(made);
      return made;
    },
    createFile: (wanted, content) => {
      created.files.push(wanted);
      const made = entry({ name: wanted, id: `file:${wanted}:new`, content: content }, 'file');
      fileItems.push(made);
      return made;
    },
  };
  return folder;
}

/* ─────────────────────────────────────────────────────────────────────────────────── clock ─── */

/**
 * `Date`, fixed at one instant, so a run cannot disagree with itself about what day it is.
 *
 * The agenda's cutoff compares *today* against a row's date, and a test builds that row from its own
 * reading of today. Two `new Date()` calls microseconds apart land on different days once per day,
 * which is the worst kind of failure to inherit: rare, unreproducible, and in the part of the suite
 * whose subject is that a date must not depend on when you look at it.
 *
 * Only the zero-argument form is fixed; every other call constructs as usual, which `midnightIn`
 * and every dated fixture need.
 *
 * The prototype is *shared with* the real `Date` rather than extended, and that is load bearing.
 * `class Frozen extends Date` gives the subclass a prototype of its own, so every `Date` built
 * before the freeze stops being `instanceof` the global one — and `upcomingEvents_` drops any row
 * whose start fails that check, emptying the listing. Assigning the real prototype keeps
 * `x instanceof Date` meaning what it did.
 */
function frozenDate(instant) {
  const Real = Date;
  const at = instant instanceof Real ? instant.getTime() : instant;
  function Frozen(...args) {
    return args.length ? new Real(...args) : new Real(at);
  }
  Frozen.prototype = Real.prototype;
  Frozen.now = () => at;
  Frozen.parse = Real.parse;
  Frozen.UTC = Real.UTC;
  return Frozen;
}

/* ────────────────────────────────────────────────────────────────────────────────────── Ui ─── */

/**
 * The spreadsheet menu, recorded rather than drawn.
 *
 * `onOpen` decides what to show: an item whose function does not exist is skipped, and a separator
 * waits for something to follow it.
 *
 * Not installed by default, deliberately. `notify_` alerts through `getUi()` and falls back to
 * `console.log` when there is none, and that fallback is where every other test reads a dialog's
 * text from — handing those tests a working UI would silence them.
 */
function fakeUi() {
  const menus = [];
  const ui = {
    menus: menus,
    createMenu: title => {
      const built = { title: title, items: [], addedToUi: false };
      menus.push(built);
      const builder = {
        addItem: (caption, functionName) => {
          built.items.push({ caption: caption, functionName: functionName });
          return builder;
        },
        addSeparator: () => { built.items.push(null); return builder; },
        addToUi: () => { built.addedToUi = true; },
      };
      return builder;
    },
    alert: message => { throw new Error(`unexpected Ui.alert: ${message}`); },
  };
  return ui;
}

/* ─────────────────────────────────────────────────────────────────────────────── install ─── */

/**
 * Puts the fakes on `globalThis`, where a loaded project's free identifiers resolve them, and hands
 * back a function that removes them again. Anything not passed in throws when touched.
 *
 * Pass `document` (from `helpers/document.js`) to make `DocumentApp.openById` answer, and `drive`
 * (from `fakeDrive`) for the logo blob and the sharing call. Without them both namespaces are
 * present but refuse, which is what every test that does not render a document wants.
 *
 * Pass `notified` — an array — to capture what the code under test would have shown a maintainer.
 * `notify_` alerts through `SpreadsheetApp.getUi()` and falls back to `console.log` when there is no
 * UI, which in a test run is always, so that fallback is where a dialog's text arrives. Without the
 * array the messages go to the real console, which is only noise in a passing run.
 */
function installFakes({
  spreadsheet = null,
  properties = {},
  notified = null,
  document = null,
  drive = null,
  ui = null,
  now = null,
} = {}) {
  const saved = {};
  const set = (name, value) => {
    saved[name] = { had: name in globalThis, value: globalThis[name] };
    globalThis[name] = value;
  };

  const refuse = label => () => { throw new Error(`${label} is not stubbed for this test`); };

  // Only when asked: most tests do not depend on a clock. Pass `now` where "today" is the subject.
  if (now !== null) set('Date', frozenDate(now));
  set('Utilities', {
    formatDate,
    sleep: () => {},
    DigestAlgorithm: { MD5: 'MD5' },
    // Real MD5, and signed bytes as Apps Script returns them — the sign is the whole reason `md5_`
    // masks before padding, so a fake handing back unsigned bytes would hide that.
    computeDigest: (algorithm, bytes) => {
      if (algorithm !== 'MD5') throw new Error(`computeDigest: only MD5 is faked, not ${algorithm}`);
      return [...crypto.createHash('md5').update(Buffer.from(bytes)).digest()]
        .map(byte => (byte > 127 ? byte - 256 : byte));
    },
  });
  set('SpreadsheetApp', {
    getActive: () => {
      if (!spreadsheet) throw new Error('SpreadsheetApp.getActive: no fake spreadsheet given');
      return spreadsheet;
    },
    getActiveSpreadsheet: () => spreadsheet,
    flush: () => {},
    // Without a `ui` this throws and `notify_` falls back to the log, which is where every test
    // that reads a dialog's text gets it from. Pass `fakeUi()` only to test the menu itself.
    getUi: () => {
      if (!ui) throw new Error('no UI in a test run');
      return ui;
    },
    newDataValidation: refuse('SpreadsheetApp.newDataValidation'),
  });
  set('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: key => (key in properties ? properties[key] : null),
      setProperty: (key, value) => { properties[key] = String(value); },
      deleteProperty: key => { delete properties[key]; },
    }),
  });
  set('Logger', { log: notified ? message => notified.push(String(message)) : () => {} });
  set('console', notified
    ? Object.assign({}, globalThis.console, { log: message => notified.push(String(message)) })
    : globalThis.console);
  set('DriveApp', drive || { getFileById: refuse('DriveApp.getFileById') });
  // The enums are always present — they are constants, and code reads them before it opens
  // anything. `openById` is the part that needs a document, and throws without one.
  set('DocumentApp', documentApp(document));
  set('ScriptApp', { getProjectTriggers: () => [] });
  set('Session', { getEffectiveUser: () => ({ getEmail: () => 'test@example.invalid' }) });

  return function restore() {
    for (const [name, previous] of Object.entries(saved)) {
      if (previous.had) globalThis[name] = previous.value;
      else delete globalThis[name];
    }
  };
}

module.exports = {
  installFakes, fakeSpreadsheet, fakeSheet, fakeDrive, fakeFolder, fakeUi, frozenDate, rowFor,
  formatDate, midnightIn, partsIn, FIXTURE_ZONE,
};
