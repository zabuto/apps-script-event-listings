/**
 * Step 1 — the sheet skeleton.
 *
 * What it produces: a spreadsheet in your Drive where an unknown venue is refused and the city fills
 * itself in. Tabs, headers, number formats, the picker lists, validation, conditional formatting and
 * the house font.
 *
 * Run `setupSkeleton`. Idempotent: it reuses an existing folder, spreadsheet and tabs, and it
 * *replaces* validation and conditional formatting rather than stacking a second copy of each.
 */

/**
 * Where each picker list lives on the `Lists` tab — two columns apart, so a spilled list has room to
 * grow.
 *
 * Columns A–N are pickers, written here; P–Z are the hygiene checks, written by `setupChecks` in
 * step 3. Keep them apart: a list that grows into a check overwrites it, and an overwritten formula
 * does not complain — it reports `#REF!` from then on.
 *
 * Everything that reads a list — the dropdowns, the dashboard controls, the read-backs — resolves
 * its range through `listRange_()`, so moving a block here moves every reference with it.
 */
function listColumns_() {
  return {
    cities: 'A',
    organisers: 'C',
    scope: 'E',
    eventStatus: 'G',
    venueStatus: 'I',
    activeVenues: 'K',
    allVenues: 'M',
  };
}

/**
 * The range a list occupies, derived rather than spelled out.
 *
 * A list of fixed values gets an exact range — a dropdown whose source runs to the bottom of the
 * sheet offers a trailing blank as if it were a choice. A formula-fed list is open-ended: its length
 * is whatever the data says today.
 */
function listRange_(key) {
  const column = listColumns_()[key];
  if (!column) throw new Error(`No list called "${key}" — check listColumns_.`);
  const block = listBlocks_().filter(entry => entry[0] === column)[0];
  return Array.isArray(block[2])
    ? `${column}2:${column}${block[2].length + 1}`
    : `${column}2:${column}`;
}

/** The lists themselves: column, label, and either a formula or a fixed set of values. */
function listBlocks_() {
  const at = listColumns_();
  const values = CONFIG.values;
  const closed = quoteLiteral_(values.venueStatus.closed);
  const all = quoteLiteral_(values.all);
  const activeVenues = `IFERROR(SORT(FILTER(${colRange_('venues', 'name')},` +
    `${colRange_('venues', 'name')}<>"",${colRange_('venues', 'status')}<>${closed})),"")`;

  return [
    // Cities and organisers feed the dashboard's two pickers, so they carry an `All` entry.
    [at.cities, 'Cities', `=VSTACK(${all},SORT(UNIQUE(FILTER(` +
      `${colRange_('venues', 'city')},${colRange_('venues', 'city')}<>""))))`],
    [at.organisers, CONFIG.tabs.organisers, `=VSTACK(${all},SORT(FILTER(` +
      `${colRange_('organisers', 'name')},${colRange_('organisers', 'name')}<>"")))`],

    [at.scope, 'Scope', [values.scope.upcoming, values.all, values.scope.past]],
    [at.eventStatus, 'Event status', [values.eventStatus.confirmed, values.eventStatus.concept,
                                      values.eventStatus.cancelled]],
    [at.venueStatus, 'Venue status', [values.venueStatus.active, values.venueStatus.closed]],

    // The venue dropdown reads *this*, not the venues tab, so a closed venue cannot be chosen for a
    // new event. Rows already naming it keep their value, because a rule is checked when a cell is
    // written and never retroactively. A script is not exempt: `setValues` over a strict range
    // throws, which is why the seed writers go through `setValuesPastValidation_`.
    [at.activeVenues, 'Venues (active)', '=' + activeVenues],

    // The full list a human reads: active first, then the closed ones, each saying so. Deliberately
    // **not** a validation source — the label would become a selectable value no lookup matches.
    [
      at.allVenues,
      'Venues (all, active first)',
      `=LET(act, ${activeVenues},` +
        `cls, IFERROR(SORT(FILTER(${colRange_('venues', 'name')}&` +
        `${quoteLiteral_(' — ' + values.venueStatus.closed + ', do not use for new events')},` +
        `${colRange_('venues', 'name')}<>"",${colRange_('venues', 'status')}=${closed})),""),` +
        'VSTACK(act,cls))',
    ],
  ];
}

/** Entry point. Creates or updates the folder, the spreadsheet and every skeleton setting. */
function setupSkeleton() {
  log_ = [];

  const folder = ensureFolder_(CONFIG.spreadsheet.folderName);
  const ss = ensureSpreadsheet_(folder, CONFIG.spreadsheet.fileName);

  setLocaleAndTimeZone_(ss);        // before any data is entered: it reinterprets what is there
  ensureTabs_(ss);
  const separator = argSeparator_(ss);   // after the locale, because the locale decides it
  report_(`Formula argument separator for this locale: "${separator}"`);
  writeHeaders_(ss);
  setNumberFormats_(ss);
  writeLists_(ss, separator);
  backfillVenueStatus_(ss);
  setValidation_(ss);
  setConditionalFormatting_(ss, separator);
  applyFont_(ss);

  report_('Spreadsheet: ' + ss.getUrl());
  report_('Next: setupFormulas (the computed columns), then setupDashboard.');
  notify_('Skeleton ready', log_.join('\n'));
  return ss.getUrl();
}

/* ─────────────────────────────────────────────────────────────────────────────────── Drive ── */

function ensureSpreadsheet_(folder, name) {
  const existing = live_(folder.getFilesByName(name));
  if (existing.length) {
    report_('Spreadsheet reused: ' + name);
    return rememberSpreadsheet_(SpreadsheetApp.openById(existing[0].getId()));
  }
  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  report_('Spreadsheet created: ' + name);
  return rememberSpreadsheet_(ss);
}

/* ────────────────────────────────────────────────────────────────────── locale and tabs ── */

function setLocaleAndTimeZone_(ss) {
  if (ss.getSpreadsheetLocale() !== CONFIG.spreadsheet.locale) {
    ss.setSpreadsheetLocale(CONFIG.spreadsheet.locale);
  }
  if (ss.getSpreadsheetTimeZone() !== CONFIG.timeZone) {
    ss.setSpreadsheetTimeZone(CONFIG.timeZone);
  }
  report_(`Locale ${ss.getSpreadsheetLocale()}, time zone ${ss.getSpreadsheetTimeZone()}`);
}

/**
 * Tabs, in the order `CONFIG.tabs` lists them — and the order is enforced on every run.
 *
 * My Maps imports the **first** sheet of a spreadsheet and offers no way to pick another, so the map
 * export tab has to sit in position 1. Reorder `CONFIG.tabs` and a rerun moves them for you — which
 * is also how to break the map: put the read-me first and the next refresh geocodes instructions.
 */
function ensureTabs_(ss) {
  const palette = CONFIG.style.palette;
  const colours = {
    mapExport: palette.secondary,
    events: palette.primary,            // the one place to type
    lists: palette.secondary,
  };
  const names = Object.keys(CONFIG.tabs).map(key => CONFIG.tabs[key]);

  Object.keys(CONFIG.tabs).forEach((key, i) => {
    const name = CONFIG.tabs[key];
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.setTabColor(colours[key] || palette.primaryDark);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });

  // Remove the sheet Google created with the file, whatever the locale called it — but only if it is
  // empty. A tab a maintainer added is their work, not litter, and a rerun must not eat it.
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (names.indexOf(name) !== -1) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      ss.deleteSheet(sheet);
      report_('Empty extra sheet removed: ' + name);
    } else {
      report_(`Extra sheet "${name}" left alone — it has content and is not this project's`);
    }
  });

  // The events tab, not the export: the order above is for the importer, the active sheet is for the
  // human who opens the file next.
  ss.setActiveSheet(ss.getSheetByName(CONFIG.tabs.events));
  report_('Tabs in place: ' + names.join(', '));
  const first = ss.getSheets()[0].getName();
  report_(`Tab 1 is "${first}" — My Maps imports the first sheet` +
    (first === CONFIG.tabs.mapExport ? ' ✓' : ' ⚠ the map would import this'));
}

/* ───────────────────────────────────────────────────────────────────────────── headers ── */

function writeHeaders_(ss) {
  ['events', 'venues', 'organisers'].forEach(tabKey => {
    const sheet = sheetFor_(ss, tabKey);
    headerRow_(sheet, headers_(tabKey));
    autoWidth_(sheet, headers_(tabKey).length);
  });

  // The computed columns are marked in the secondary colour so nobody mistakes them for something to
  // type in. Derived from the contract, so adding a computed column needs no edit here.
  const events = sheetFor_(ss, 'events');
  const from = firstComputed_('events');
  if (from) {
    const palette = CONFIG.style.palette;
    events.getRange(1, from, 1, computedCount_('events'))
      .setBackground(palette.secondary)
      .setFontColor(palette.surface);
  }
  report_('Headers written and row 1 frozen on ' +
    ['events', 'venues', 'organisers'].map(key => CONFIG.tabs[key]).join(', '));
}

/**
 * Writes row 1 and clears everything past the contract first.
 *
 * A contract that loses a column leaves the whole column behind, not just its header: an array
 * formula that used to live there goes on computing and spilling from columns that have since changed
 * meaning. Clear header *and* data past the current width before writing.
 */
function headerRow_(sheet, headers) {
  const palette = CONFIG.style.palette;
  const spare = sheet.getMaxColumns() - headers.length;
  if (spare > 0) {
    sheet.getRange(1, headers.length + 1, sheet.getMaxRows(), spare)
      .clearContent().clearFormat().clearDataValidations();
    report_(`${sheet.getName()}: cleared ${spare} column(s) past the contract`);
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(palette.primary)
    .setFontColor(palette.surface)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 28);
}

function autoWidth_(sheet, columns) {
  sheet.autoResizeColumns(1, columns);
  for (let c = 1; c <= columns; c++) {
    if (sheet.getColumnWidth(c) < 90) sheet.setColumnWidth(c, 90);
  }
}

/* ─────────────────────────────────────────────────────────────────────── number formats ── */

function setNumberFormats_(ss) {
  const events = sheetFor_(ss, 'events');
  const start = columnLetter_('events', 'dateStart');
  const end = columnLetter_('events', 'dateEnd');
  events.getRange(`${start}2:${end}`).setNumberFormat(CONFIG.spreadsheet.dateFormat);

  // The private note tends to carry date *wording* — "december 2026" — which the sheet would
  // otherwise parse as a date and store as a serial number.
  const note = columnLetter_('events', 'notePrivate');
  events.getRange(`${note}2:${note}`).setNumberFormat('@');

  // Postcodes are text: many formats have letters, and the numeric ones lose their leading zero.
  const postcode = columnLetter_('venues', 'postcode');
  sheetFor_(ss, 'venues').getRange(`${postcode}2:${postcode}`).setNumberFormat('@');

  report_(`Dates as ${CONFIG.spreadsheet.dateFormat}; private note and postcode as plain text`);
}

/* ───────────────────────────────────────────────────────────────────────── picker lists ── */

function writeLists_(ss, separator) {
  const lists = sheetFor_(ss, 'lists');
  listBlocks_().forEach(block => {
    const [column, title, content] = block;
    label_(lists, column + '1', title);
    if (Array.isArray(content)) {
      lists.getRange(`${column}2:${column}${content.length + 1}`)
        .setValues(content.map(value => [value]));
    } else {
      setFormula_(lists.getRange(column + '2'), content, separator);
    }
  });
  report_('Lists filled: ' + listBlocks_().map(block => block[1]).join(', '));
}

/**
 * Every venue with no status counts as active. Fills blanks only, so a `Closed` set by hand survives
 * every rerun — closing a venue is a human decision no generator can reproduce.
 */
function backfillVenueStatus_(ss) {
  const venues = sheetFor_(ss, 'venues');
  const rows = venues.getLastRow() - 1;
  const where = `${CONFIG.tabs.venues}!${columnLetter_('venues', 'status')}`;
  if (rows < 1) { report_(`${where}: no rows to default`); return; }

  const nameColumn = columnNumber_('venues', 'name');
  const statusColumn = columnNumber_('venues', 'status');
  const names = venues.getRange(2, nameColumn, rows, 1).getValues();
  const status = venues.getRange(2, statusColumn, rows, 1).getValues();
  let filled = 0;
  for (let i = 0; i < rows; i++) {
    if (String(names[i][0]) && status[i][0] === '') {
      status[i][0] = CONFIG.values.venueStatus.active;
      filled++;
    }
  }
  venues.getRange(2, statusColumn, rows, 1).setValues(status);
  report_(`${where}: ${filled} row(s) defaulted to ${CONFIG.values.venueStatus.active}`);
}

/* ─────────────────────────────────────────────────────────────────────────── validation ── */

function setValidation_(ss) {
  const events = sheetFor_(ss, 'events');
  const venues = sheetFor_(ss, 'venues');
  const lists = sheetFor_(ss, 'lists');
  const organisers = sheetFor_(ss, 'organisers');

  // Clear first. A rule left on a column that has since changed meaning does not sit there
  // harmlessly: strict validation makes `setValues` throw, so a stale rule blocks a script from
  // writing the column that took its place.
  events.getRange(2, 1, events.getMaxRows() - 1, events.getMaxColumns()).clearDataValidations();
  venues.getRange(2, 1, venues.getMaxRows() - 1, venues.getMaxColumns()).clearDataValidations();

  const column = (tabKey, key) => {
    const letter = columnLetter_(tabKey, key);
    return `${letter}2:${letter}`;
  };

  events.getRange(column('events', 'venue'))
    .setDataValidation(rejectInvalid_(lists.getRange(listRange_('activeVenues'))));
  events.getRange(column('events', 'organiser'))
    .setDataValidation(rejectInvalid_(organisers.getRange(column('organisers', 'name'))));
  events.getRange(column('events', 'status'))
    .setDataValidation(rejectInvalid_(lists.getRange(listRange_('eventStatus'))));
  venues.getRange(column('venues', 'status'))
    .setDataValidation(rejectInvalid_(lists.getRange(listRange_('venueStatus'))));

  report_('Validation set: venue (active only), organiser, event status, venue status — ' +
          'invalid input refused, not merely warned about');
}

/* ──────────────────────────────────────────────────────────────── conditional formatting ── */

/**
 * Five rules on the events tab. Order matters: the first rule wins where two set the same property.
 *
 * Four of them read the computed columns rather than looking anything up — see the note on the
 * fifth.
 */
function setConditionalFormatting_(ss, separator) {
  const events = sheetFor_(ss, 'events');
  const palette = CONFIG.style.palette;
  const values = CONFIG.values;
  const last = columnLetter_('events', columnSpec_('events')[columnSpec_('events').length - 1].key);
  const range = events.getRange(`A2:${last}`);
  const venueLetter = columnLetter_('events', 'venue');
  // Only the venue cell, not the row: the venue closed, the event still happened.
  const venueCell = events.getRange(`${venueLetter}2:${venueLetter}`);

  const city = columnLetter_('events', 'city');
  const upcoming = columnLetter_('events', 'upcoming');
  const status = columnLetter_('events', 'status');

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${city}2=${quoteLiteral_(values.unknownVenue)}`)
      .setBackground(palette.primary).setFontColor(palette.surface)
      .setRanges([range]).build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${upcoming}2=${quoteLiteral_(values.scope.past)}`)
      .setFontColor(palette.grey)
      .setRanges([range]).build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${status}2=${quoteLiteral_(values.eventStatus.cancelled)}`)
      .setStrikethrough(true)
      .setRanges([range]).build(),

    // The info fill marks what is not yet certain, not what is soon: a concept row is the one to
    // look at again.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${status}2=${quoteLiteral_(values.eventStatus.concept)}`)
      .setBackground(palette.infoFill).setFontColor(palette.ink)
      .setRanges([range]).build(),

    // A historical row may name a closed venue and must keep doing so. Striking the venue cell says
    // "this place is gone" without pretending the event never ran, and it is the only warning a row
    // predating the closure will ever show.
    //
    // INDIRECT, not a plain cross-sheet reference: a conditional format rule may not reference
    // another sheet ("Conditional format rule cannot reference another sheet"), and the sheet
    // rejects the rule when it is *set*, not when it is evaluated. INDIRECT resolves the name at
    // evaluation time, so the stored rule carries none. That is also why the four rules above read
    // the computed city column instead of looking the venue up themselves.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(localizeFormula_(
        `=AND($${venueLetter}2<>"",COUNTIFS(INDIRECT("${colFull_('venues', 'name')}"),` +
        `$${venueLetter}2,INDIRECT("${colFull_('venues', 'status')}"),` +
        `${quoteLiteral_(values.venueStatus.closed)})>0)`, separator))
      .setStrikethrough(true).setFontColor(palette.grey)
      .setRanges([venueCell]).build(),
  ];

  events.setConditionalFormatRules(rules);
  report_(`Conditional formatting on ${CONFIG.tabs.events}: unknown venue, past, cancelled, ` +
          `concept, closed venue (${venueLetter} only)`);
}

/* ────────────────────────────────────────────────────────────────────────────────── font ── */

function applyFont_(ss) {
  const font = CONFIG.style.font;
  ss.getSheets().forEach(sheet => {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns())
      .setFontFamily(font)
      .setFontSize(CONFIG.style.fontSize);
  });
  report_(`${font} ${CONFIG.style.fontSize} pt applied to every tab`);

  // The workbook *default* needs the Sheets API; without it the range formatting above is what
  // everyone sees, and Format → Theme is one manual click.
  //
  // The theme cannot be patched field by field: sending only `primaryFontFamily` is rejected with
  // "All theme color types must be set". So read the theme, change the one field, send it back whole.
  try {
    // The theme hangs off `properties`, not the root: a `spreadsheetTheme` field mask is rejected
    // outright with "Request contains an invalid argument".
    const meta = Sheets.Spreadsheets.get(ss.getId(), { fields: 'properties.spreadsheetTheme' });
    const theme = meta.properties.spreadsheetTheme;
    theme.primaryFontFamily = font;
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateSpreadsheetProperties: {
          properties: { spreadsheetTheme: theme },
          fields: 'spreadsheetTheme',
        },
      }],
    }, ss.getId());
    report_('Workbook default font set to ' + font);
  } catch (err) {
    report_(`Default font not set through the Sheets API (${err.message}). Set it by hand: ` +
            `Format → Theme → Customise → Font → ${font}.`);
  }
}
