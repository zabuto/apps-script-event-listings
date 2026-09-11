/**
 * Tool — capture the sheet back into code.
 *
 * Not a step. Run `captureSheetData` after a stretch of manual work; it writes paste-ready
 * replacements for the three functions in `SeedData.gs` to a file in Drive and logs its URL.
 *
 * Why it exists: `seedSheet` preserves hand-entered columns by reading the sheet it is about to
 * rewrite, which works only while that sheet exists. Delete the spreadsheet — as a fresh build does —
 * and the hour spent on addresses is gone. Captured in code, it comes back on the next build.
 *
 * The loop: fill in the sheet → run this → paste the output into `SeedData.gs` → push. The sheet
 * stays the place to type; the code becomes the place it survives.
 */

/**
 * Which columns of each lookup tab are typed by a human, what to call them in the output, and
 * optionally a value not worth writing down.
 *
 * Keys, not positions: the same contract the rest of the codebase reads, so a reordered column
 * changes nothing here.
 *
 * `status` is in the list because closing a venue is a human decision nothing can regenerate. Its
 * default is given, so open venues stay out of the dump and a closed one is impossible to miss.
 */
function capturedColumns_() {
  return {
    venues: [
      ['address', 'address'],
      ['postcode', 'postcode'],
      ['url', 'url'],
      ['notesPrivate', 'notes'],
      ['status', 'status', CONFIG.values.venueStatus.active],
    ],
    organisers: [
      ['social', 'social'],
      ['website', 'website'],
      ['notesPrivate', 'notes'],
    ],
  };
}

/** The Drive file the dump is written to, beside the spreadsheet, so its URL stays stable. */
function dumpFileName_() {
  return 'captured-seed-data.js';
}

/**
 * Writes the three seed functions as JavaScript.
 *
 * The two detail maps hold only rows with something in them, sorted by key so a re-run gives a
 * stable diff. The events function is the sheet's own rows, in sheet order, since the sheet is the
 * thing being described.
 *
 * **Not through the log.** Apps Script truncates execution output at roughly 8 KB, and a real dataset
 * is past that on its own: the log then reads as a complete listing having dropped most of the
 * events, and pasting it would delete them — the exact loss this tool exists to prevent. The payload
 * goes to a Drive file and the log carries only counts and the URL, so it can never be the short
 * one.
 */
function captureSheetData() {
  log_ = [];
  const ss = openSpreadsheet_();

  const blocks = [
    detailsFunction_(ss, 'venues', 'seedVenueDetails_'),
    detailsFunction_(ss, 'organisers', 'seedOrganiserDetails_'),
    eventsFunction_(ss),
  ];
  const text = `// Captured by captureSheetData from ${ss.getName()}.\n` +
    '// Paste each function over the one of the same name in bootstrap/SeedData.gs, then push.\n' +
    '//\n' +
    '// The dates below are fixed, not offsets: these are real events, so they should not move when\n' +
    '// the seed is next run. The sample data ships with offsets only so that a first install has\n' +
    '// something upcoming to show whenever it happens.\n\n' +
    blocks.join('\n\n') + '\n';

  const file = writeDumpFile_(ss, text);

  report_(`Written to Drive, not to this log — the log truncates at about 8 KB and this is ` +
    `${Math.round(text.length / 1024)} KB.`);
  report_(`  ${dumpFileName_()}: ${file.getUrl()}`);
  report_('--- what it contains ---');
  blocks.forEach(block => {
    // Count entries by counting the lines that open one, so a truncated block cannot read as full.
    const name = block.slice(block.indexOf('function ') + 9, block.indexOf('('));
    const entries = block.split('\n').filter(line => line.indexOf('    ') === 0).length;
    report_(`  ${name}: ${entries} entries`);
  });
  report_('Open the file, copy each function over the one of the same name, then push.');

  notify_('Sheet data captured', log_.join('\n'));
  return text;
}

/** Creates or updates the dump beside the spreadsheet, so re-running does not litter Drive. */
function writeDumpFile_(ss, text) {
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const name = dumpFileName_();

  const existing = live_(folder.getFilesByName(name));
  if (existing.length) {
    existing[0].setContent(text);
    return existing[0];
  }
  return folder.createFile(name, text, MimeType.PLAIN_TEXT);
}

/**
 * One `function name_() { return { … }; }` block for the filled rows of a lookup tab.
 *
 * A column carrying a default is written only where the sheet disagrees with it, so a value every row
 * shares does not bury the one row that differs.
 */
function detailsFunction_(ss, tabKey, name) {
  const sheet = sheetFor_(ss, tabKey);
  const rows = sheet.getLastRow() - 1;
  const columns = capturedColumns_()[tabKey];
  const entries = [];

  if (rows > 0) {
    const width = headers_(tabKey).length;
    sheet.getRange(2, 1, rows, width).getValues().forEach(row => {
      const key = String(row[columnIndex_(tabKey, 'name')]).trim();
      if (!key) return;
      const fields = columns
        .map(column => {
          const value = row[columnIndex_(tabKey, column[0])];
          if (value === '' || value === null) return null;
          if (column.length > 2 && String(value).trim() === column[2]) return null;
          return `${column[1]}: ${quote_(value)}`;
        })
        .filter(field => field !== null);
      if (fields.length) entries.push(`    ${quote_(key)}: { ${fields.join(', ')} },`);
    });
  }

  entries.sort();
  return entries.length
    ? `function ${name}() {\n  return {\n${entries.join('\n')}\n  };\n}`
    : `function ${name}() {\n  return {};   // nothing filled in yet\n}`;
}

/**
 * The events, as the sheet now holds them.
 *
 * This is what makes "the sheet is the authority" true rather than merely agreed. Once events are
 * edited in the sheet, the seed in the repo is the *old* truth, and a fresh build would quietly
 * reinstate it. Capture, paste, push, and the two agree again.
 *
 * Statuses are written as `status.confirmed` rather than as the literal string, so renaming a status
 * in the config does not silently orphan every seeded row.
 */
function eventsFunction_(ss) {
  const sheet = sheetFor_(ss, 'events');
  const rows = sheet.getLastRow() - 1;
  const open = 'function seedEvents_() {\n  const status = CONFIG.values.eventStatus;\n  return [';
  if (rows < 1) return open + '];   // the sheet has no rows\n}';

  const tz = ss.getSpreadsheetTimeZone();
  const width = firstComputed_('events') ? firstComputed_('events') - 1 : headers_('events').length;
  const statusNames = CONFIG.values.eventStatus;
  const lines = [];

  sheet.getRange(2, 1, rows, width).getValues().forEach(row => {
    const value = key => row[columnIndex_('events', key)];
    // Skip the trailing empties: a row with neither a date nor a title is not an event.
    if (!value('dateStart') && !value('title')) return;

    const status = String(value('status'));
    const named = Object.keys(statusNames).filter(key => statusNames[key] === status)[0];
    lines.push('    [' + [
      isoOrBlank_(value('dateStart'), tz),
      isoOrBlank_(value('dateEnd'), tz),
      quote_(value('title')),
      quote_(value('venue')),
      quote_(value('organiser')),
      named ? `status.${named}` : quote_(status),
      quote_(value('notePrivate')),
    ].join(', ') + '],');
  });

  return `${open}\n${lines.join('\n')}\n  ];\n}`;
}

/**
 * A JavaScript string literal for a cell value.
 *
 * Single-quoted unless the value contains one, in which case it comes back double-quoted rather than
 * escaped — so a name like `'t Voorbeeld` stays readable in the pasted code.
 *
 * Backslashes and line breaks are escaped under either quote, and the backslash first so the two
 * compose. A notes cell holds both — a line break is what Alt+Enter puts there — and either written
 * through verbatim ends the literal early: the pasted `SeedData.gs` then fails to parse, and a syntax
 * error in one Apps Script file takes every function in the project with it, including the ones that
 * would repair the sheet.
 */
function quote_(value) {
  const text = String(value === null || value === undefined ? '' : value)
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|[\r\n]/g, '\\n');
  return text.indexOf("'") === -1 ? `'${text}'` : `"${text.replace(/"/g, '\\"')}"`;
}

/** `'2026-01-16'` for a date cell, `''` for anything else — the format the seed reads back. */
function isoOrBlank_(value, tz) {
  return value instanceof Date ? `'${Utilities.formatDate(value, tz, 'yyyy-MM-dd')}'` : "''";
}
