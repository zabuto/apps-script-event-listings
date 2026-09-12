/**
 * Step 4 — the dashboard, the read-me, and the protections.
 *
 * What it produces: a `Dashboard` tab anyone can filter and nobody can break by accident, three
 * per-user filter views on the events tab, a written read-me, and edit protection on everything that
 * is generated.
 *
 * Run `setupDashboard`. Idempotent: it replaces its own protections and filter views instead of
 * adding a second copy, and it does not reset a filter control that already holds a choice.
 *
 * `repairDashboard` is the same work for the dashboard tab alone — the one to run after an edit
 * lands on the results block.
 *
 * One thing here is not scriptable and is reported at the end for a human to finish: the daily digest
 * under Tools → Notification settings, which is how a maintainer's edit reaches you at all.
 */

/** The columns the dashboard shows, by event column key. Labels come from the contract. */
function dashboardColumns_() {
  return ['dateStart', 'when', 'title', 'venue', 'city', 'organiser', 'status'];
}

/**
 * The letter a dashboard column sits under, by the event column key it shows.
 *
 * Rule 4 applies here as much as on a contract tab, and the list above is the contract: the
 * dashboard holds a *subset* of the events tab in its own order, so `columnLetter_('events', …)`
 * answers about the wrong sheet. Reordering `dashboardColumns_` has to carry the count cell, the
 * date format and the protected range with it — spelling a letter is how those quietly part company.
 *
 * Throws rather than returning `-1`, which would address column `@`.
 */
function dashboardLetter_(key) {
  const at = dashboardColumns_().indexOf(key);
  if (at < 0) throw new Error(`No "${key}" column on the dashboard — check dashboardColumns_.`);
  return letterOf_(at + 1);
}

/** The last column the dashboard occupies, for the header row and the protections over it. */
function dashboardLastLetter_() {
  return letterOf_(dashboardColumns_().length);
}

/**
 * The three filter controls: label, label cell, value cell, the list they validate against, default.
 *
 * The source is named rather than spelled as a range, so moving a list on the `Lists` tab cannot
 * leave a control validating against whatever moved into its place.
 */
function dashboardControls_() {
  return [
    ['Scope', 'A1', 'B1', listRange_('scope'), CONFIG.values.scope.upcoming],
    ['City', 'A2', 'B2', listRange_('cities'), CONFIG.values.all],
    [CONFIG.tabs.organisers, 'A3', 'B3', listRange_('organisers'), CONFIG.values.all],
  ];
}

/**
 * The filter — every control in one formula.
 *
 * Written flat, with direct range references and no intermediate `LET` names. The `LET` version
 * reads far better and returns nothing: on a live sheet the same condition matched every row with
 * direct references, and `#N/A` — nothing matched — once it went through `LET` names holding arrays.
 * One term collapsing to its first element zeroes the whole product, and `IFERROR` presents that as
 * a tidy "no matches".
 *
 * Scalar × array in every term, so nothing branches and nothing can collapse. The scope term reads
 * the `Upcoming?` column rather than re-deriving the dates: that column already answers "does this
 * publish?", so the dashboard and the map cannot disagree — and a cancelled event, neither upcoming
 * nor past there, appears only under `All`, where its status explains why.
 *
 * `wrapErrors` false emits the same formula without the `IFERROR`: the only way to tell a filter that
 * matched nothing from one that failed.
 *
 * No private column is in here, and none ever may be.
 */
function dashboardFilter_(wrapErrors) {
  const values = CONFIG.values;
  // The control values a maintainer picks are the ones the sheet stores, so the formula compares
  // against the configured words themselves — quoted, like every other Config.gs value in a formula.
  const all = quoteLiteral_(values.all);
  const upcoming = quoteLiteral_(values.scope.upcoming);
  const past = quoteLiteral_(values.scope.past);
  const columns = 'HSTACK(' + dashboardColumns_()
    .map(key => colRange_('events', key)).join(',') + ')';

  const condition =
    `(${colRange_('events', 'title')}<>"")` +
    ` * (($B$1=${all}) + ($B$1=${upcoming})*` +
    `(${colRange_('events', 'upcoming')}=${upcoming})` +
    ` + ($B$1=${past})*(${colRange_('events', 'upcoming')}=${past}))` +
    ` * (($B$2=${all}) + ($B$2<>${all})*(${colRange_('events', 'city')}=$B$2))` +
    ` * (($B$3=${all}) + ($B$3<>${all})*(${colRange_('events', 'organiser')}=$B$3))`;

  // Oldest first, except under Past, where the most recent is the one you want at the top.
  const sorted = `SORT(FILTER(${columns}, ${condition}), 1, $B$1<>${past})`;
  return wrapErrors ? `=IFERROR(${sorted}, "no matches")` : '=' + sorted;
}

/** The `LET` spelling, kept only so the probe can show that it returns nothing here. */
function dashboardFilterLet_() {
  const values = CONFIG.values;
  const all = quoteLiteral_(values.all);
  const upcoming = quoteLiteral_(values.scope.upcoming);
  const past = quoteLiteral_(values.scope.past);
  return '=LET(' +
    `  s, ${colRange_('events', 'dateStart')}, e, ${colRange_('events', 'dateEnd')},` +
    ` t, ${colRange_('events', 'title')}, v, ${colRange_('events', 'venue')},` +
    ` p, ${colRange_('events', 'organiser')}, st, ${colRange_('events', 'status')},` +
    ` c, ${colRange_('events', 'city')}, w, ${colRange_('events', 'when')},` +
    '  eff, IF(e<>"", e, s),' +
    `  scope, ($B$1=${all}) + ($B$1=${upcoming})*(eff>=TODAY())` +
    ` + ($B$1=${past})*(eff<TODAY()),` +
    `  city, ($B$2=${all}) + ($B$2<>${all})*(c=$B$2),` +
    `  org, ($B$3=${all}) + ($B$3<>${all})*(p=$B$3),` +
    '  out, FILTER(HSTACK(s,w,t,v,c,p,st), (t<>"")*scope*city*org),' + `  SORT(out, 1, $B$1<>${past})` + ')';
}

/**
 * The row count in `D1`.
 *
 * Not a bare `COUNTA(A6:A)`, for two reasons. When nothing matches, `A6` holds the string "no
 * matches", which `COUNTA` counts as one — hence the explicit zero. And it counts the title column,
 * not the date column: a dateless event is still a row, and every returned row has a title because
 * the filter requires one.
 */
function dashboardCount_() {
  const title = dashboardLetter_('title');
  return `=IF($A$6="no matches","0 events",COUNTA($${title}$6:$${title})&" events")`;
}

/** Filter views on the events tab. An empty match means no criteria — every row. */
function filterViews_() {
  const scope = CONFIG.values.scope;
  return [ ['All events', ''], [scope.upcoming + ' only', scope.upcoming], [scope.past + ' only', scope.past], ];
}

/* ────────────────────────────────────────────────────────────────────────── entry points ── */

function setupDashboard() {
  log_ = [];
  const ss = openSpreadsheet_();
  const separator = argSeparator_(ss);

  writeDashboard_(ss, separator);
  writeReadMe_(ss);
  installFilterViews_(ss);
  applyProtection_(ss);
  SpreadsheetApp.flush();

  reportDashboard_(ss);

  const summary = log_.join('\n');
  notify_('Dashboard ready', summary);
  return summary;
}

/**
 * Puts the dashboard back after an edit deletes the results.
 *
 * Rewrites the count, the header row and the filter; leaves the controls alone, since a control is
 * only filled when it is empty. Nothing outside the dashboard tab is touched, so it is safe to run
 * at any point.
 */
function repairDashboard() {
  log_ = [];
  const ss = openSpreadsheet_();
  writeDashboard_(ss, argSeparator_(ss));
  SpreadsheetApp.flush();
  reportDashboard_(ss);
  const summary = log_.join('\n');
  notify_('Dashboard repaired', summary);
  return summary;
}

/* ──────────────────────────────────────────────────────────────────────── the dashboard ── */

function writeDashboard_(ss, separator) {
  const dash = sheetFor_(ss, 'dashboard');
  const lists = sheetFor_(ss, 'lists');
  const palette = CONFIG.style.palette;
  const width = dashboardColumns_().length;

  dashboardControls_().forEach(control => {
    const [label, labelCell, valueCell, source, fallback] = control;
    dash.getRange(labelCell)
      .setValue(label)
      .setFontWeight('bold')
      .setFontColor(palette.surface)
      .setBackground(palette.primaryDark);

    const cell = dash.getRange(valueCell);
    cell.setDataValidation(rejectInvalid_(lists.getRange(source)));
    if (cell.getValue() === '') cell.setValue(fallback);      // keep whatever the user picked
    cell.setBackground(palette.surface).setFontColor(palette.ink).setFontWeight('bold');
  });

  setFormula_(dash.getRange('D1'), dashboardCount_(), separator);
  dash.getRange('D1').setBackground(palette.infoFill).setFontColor(palette.ink)
    .setFontWeight('bold').setHorizontalAlignment('center');

  dash.getRange(5, 1, 1, width)
    .setValues([dashboardColumns_().map(key => headerOf_('events', key))])
    .setBackground(palette.primary)
    .setFontColor(palette.surface)
    .setFontWeight('bold');
  dash.setFrozenRows(5);

  // A FILTER refuses to spill over anything already sitting under it and reports `#REF!` instead.
  // Clearing first is what makes repair *repair*: after a stray paste into the results, re-setting the
  // formula alone would only yield `#REF!` again.
  dash.getRange(6, 1, Math.max(dash.getMaxRows() - 5, 1), width).clearContent();
  setFormula_(dash.getRange('A6'), dashboardFilter_(true), separator);

  // The filter returns date *values*; without a format on the column they render as serial numbers.
  // The `When` column beside it is text and needs none.
  const dateColumn = dashboardLetter_('dateStart');
  dash.getRange(`${dateColumn}6:${dateColumn}`).setNumberFormat(CONFIG.spreadsheet.dateFormat);

  dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns())
    .setFontFamily(CONFIG.style.font).setFontSize(CONFIG.style.fontSize);
  dash.autoResizeColumns(1, width);
  for (let c = 1; c <= width; c++) {
    if (dash.getColumnWidth(c) < 90) dash.setColumnWidth(c, 90);
  }
  report_(`Dashboard written: ${dashboardControls_().length} controls, count in D1, ` +
    'headers in row 5, filter in A6');
}

/* ─────────────────────────────────────────────────────────────────────────── the read-me ── */

/**
 * The read-me, written from the configured names so it cannot describe a tab that is not there.
 *
 * It is deliberately about the *rules*, not the clicks: what to type where, what is public, what is a
 * formula, and what the map does not do by itself.
 */
function writeReadMe_(ss) {
  const sheet = sheetFor_(ss, 'readMe');
  const tabs = CONFIG.tabs;
  const computed = columnSpec_('events').filter(column => column.computed)
    .map(column => `${columnLetter_('events', column.key)} (${column.header})`).join(', ');
  sheet.clear();

  const lines = [
    [`${CONFIG.spreadsheet.fileName} — how to use this sheet`, 'title'],
    [
      'For everyone with edit access. You never need the script, the code or anything outside this ' +
        'file: adding events and using the menu is the whole job.',
      '',
    ],
    ['', ''],
    ['Adding an event', 'heading'],
    [`One row in ${tabs.events}. That is the only tab you type in.`, ''],
    [
      `New venue or organiser? Add it in ${tabs.venues} or ${tabs.organisers} first, then pick it ` +
        'from the dropdown. A name that is not in the lookup is refused — that is deliberate, not a bug.',
      '',
    ],
    ['Never type a city: it fills itself in from the venue.', ''],
    [
      `${headerOf_('events', 'dateStart')} is always filled. For a multi-day run, add ` +
        `${headerOf_('events', 'dateEnd')} as well — one row, not two.`,
      '',
    ],
    ['', ''],
    ['What is public and what is not', 'heading'],
    [
      `${headerOf_('events', 'notePrivate')} stays in this sheet — no output reads it. Put anything ` +
        'internal there, including the wording for a vague date.',
      '',
    ],
    [`${tabs.venues} and ${tabs.organisers} each have a private notes column, same rule: sheet only.`, ''],
    [
      'A private column is private to the outputs, not to the sheet: everyone who can open this file ' +
        'can read every column in it. Whether that is the right set of people is a sharing decision, ' +
        'made in Drive.',
      '',
    ],
    [
      `A venue can carry a city and no street address on purpose — tick ` +
        `${headerOf_('venues', 'cityOnly')} in ${tabs.venues} and the checks leave it alone. The ` +
        'map then puts its pin on the city. Type a street number into a row with that box ticked ' +
        'and the check says so: it would go public at the next map refresh.',
      '',
    ],
    ['', ''],
    ['Columns you should not type in', 'heading'],
    [
      `${tabs.events} ${computed} are formulas, and so are ${tabs.dashboard}, ${tabs.mapExport} and ` +
        `${tabs.lists}. They are protected: if a cell refuses your edit, it is meant to.`,
      '',
    ],
    ['', ''],
    ['Finding things', 'heading'],
    [`${tabs.dashboard}: pick from the three dropdowns. Nothing else to touch.`, ''],
    [`${tabs.events}: the filter views are per-user, so using one does not change what anyone else ` + 'sees.', ''],
    [
      `${tabs.lists}: the hygiene checks. All of them should read "${CONFIG.values.clean}" except ` +
        'the address worklist.',
      '',
    ],
    ['', ''],
    ['Refreshing the map', 'heading'],
    [
      `The map does not update itself. After adding or changing events, use the ` +
        `${CONFIG.brand.menu} menu → Refresh map export, then re-import ${tabs.mapExport} into the map ` +
        '(delete the layer first — a re-import alone keeps the old fields). The agenda document does ' +
        'refresh itself, once a week.',
      '',
    ],
    ['', ''],
    ['Who owns what', 'heading'],
    [
      'To be filled in: who owns the spreadsheet, the agenda document, the logo file, the map, and ' +
        'any short links.',
      '',
    ],
  ];

  sheet.getRange(1, 1, lines.length, 1).setValues(lines.map(line => [line[0]]));
  sheet.setColumnWidth(1, 760);

  const palette = CONFIG.style.palette;
  lines.forEach((line, i) => {
    const cell = sheet.getRange(i + 1, 1);
    cell.setFontFamily(CONFIG.style.font).setVerticalAlignment('top').setWrap(true);
    if (line[1] === 'title') {
      cell.setFontSize(16).setFontWeight('bold').setFontColor(palette.primary);
    } else if (line[1] === 'heading') {
      cell.setFontSize(11).setFontWeight('bold').setFontColor(palette.primaryDark);
    } else {
      cell.setFontSize(CONFIG.style.fontSize).setFontColor(palette.ink);
    }
  });
  report_(`Read me written (${lines.length} lines)`);
}

/* ───────────────────────────────────────────────────────────────────────── filter views ── */

/**
 * Per-user filter views on the events tab.
 *
 * These need the Sheets API: `SpreadsheetApp` only exposes the single *shared* basic filter, the
 * opposite of what is wanted here — one person filtering should not change what everyone else sees.
 * If the advanced service is off, the run says so and carries on.
 */
function installFilterViews_(ss) {
  try {
    const sheetId = sheetFor_(ss, 'events').getSheetId();
    const existing = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(filterViews(filterViewId,title))' });
    const titles = filterViews_().map(view => view[0]);
    const requests = [];

    (existing.sheets || []).forEach(sheet => {
      (sheet.filterViews || []).forEach(view => {
        if (titles.indexOf(view.title) !== -1) {
          requests.push({ deleteFilterView: { filterId: view.filterViewId } });
        }
      });
    });

    const width = headers_('events').length;
    const upcomingIndex = columnIndex_('events', 'upcoming');
    filterViews_().forEach(view => {
      const filter = {
        title: view[0],
        range: { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: width },
      };
      if (view[1]) {
        filter.criteria = {};
        filter.criteria[upcomingIndex] = {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: view[1] }] },
        };
      }
      requests.push({ addFilterView: { filter: filter } });
    });

    Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
    report_('Filter views on ' + CONFIG.tabs.events + ': ' + titles.join(', '));
  } catch (err) {
    report_(`Filter views not installed (${err.message}). Either the Sheets advanced service is ` +
      'off in this project, or create them by hand: Data → Create a filter view, one per scope.');
  }
}

/* ─────────────────────────────────────────────────────────────────────────── protection ── */

/** Ranges nobody but the owner may edit. The dashboard's controls stay open on purpose. */
function protectedRanges_() {
  const lastDashColumn = dashboardLastLetter_();
  const computedFrom = firstComputed_('events');
  const ranges = [ ['dashboard', `A5:${lastDashColumn}`, 'Dashboard results — formula, do not edit'], ];
  if (computedFrom) {
    const first = columnLetter_('events', columnSpec_('events')[computedFrom - 1].key);
    const spec = columnSpec_('events');
    const last = columnLetter_('events', spec[spec.length - 1].key);
    ranges.push(['events', `${first}:${last}`, `${CONFIG.tabs.events} ${first}:${last} — computed columns`]);
  }
  return ranges;
}

/** Whole tabs nobody but the owner may edit. */
function protectedSheets_() {
  return ['mapExport', 'lists'];
}

/**
 * A second, warning-only protection over the results block.
 *
 * An editor list cannot lock out the owner, so for whoever owns the file the range protection above
 * is decoration: a stray Delete over the results takes the filter formula out and the dashboard goes
 * blank. A warning-only protection is the one kind the sheet applies to the owner too — editing the
 * range asks for confirmation. It stacks with the editor restriction rather than replacing it, hence
 * a separate protection with its own description.
 */
function warnedRanges_() {
  return [['dashboard', `A5:${dashboardLastLetter_()}`, 'Dashboard results — confirm before editing']];
}

function applyProtection_(ss) {
  const me = Session.getEffectiveUser();
  const applied = [];

  protectedRanges_().forEach(entry => {
    const sheet = sheetFor_(ss, entry[0]);
    dropProtection_(sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE), entry[2]);
    ownerOnly_(sheet.getRange(entry[1]).protect().setDescription(entry[2]), me);
    applied.push(`${sheet.getName()}!${entry[1]}`);
  });

  protectedSheets_().forEach(tabKey => {
    const sheet = sheetFor_(ss, tabKey);
    const description = `${sheet.getName()} — generated, do not edit`;
    dropProtection_(sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET), description);
    ownerOnly_(sheet.protect().setDescription(description), me);
    applied.push(`${sheet.getName()} (whole tab)`);
  });

  const warned = [];
  warnedRanges_().forEach(entry => {
    const sheet = sheetFor_(ss, entry[0]);
    dropProtection_(sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE), entry[2]);
    sheet.getRange(entry[1]).protect().setDescription(entry[2]).setWarningOnly(true);
    warned.push(`${sheet.getName()}!${entry[1]}`);
  });

  report_('Protected: ' + applied.join(', ') + ' — the dashboard controls left open');
  report_('Warn before editing (applies to the owner too): ' + warned.join(', '));
}

/** Removes an earlier protection with the same description, so a rerun does not stack them. */
function dropProtection_(protections, description) {
  protections.forEach(protection => {
    if (protection.getDescription() === description) protection.remove();
  });
}

/** Everyone except the owner loses edit rights. The owner cannot be removed, and is re-added anyway. */
function ownerOnly_(protection, me) {
  protection.addEditor(me);
  const others = protection.getEditors()
    .map(user => user.getEmail())
    .filter(email => email && email !== me.getEmail());
  if (others.length) protection.removeEditors(others);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

/* ─────────────────────────────────────────────────────────────────────────── the report ── */

function reportDashboard_(ss) {
  const dash = sheetFor_(ss, 'dashboard');
  const width = dashboardColumns_().length;
  report_('--- dashboard read-back ---');
  report_('Controls: ' + dashboardControls_()
    .map(control => `${control[0]} "${dash.getRange(control[2]).getDisplayValue()}"`).join(' · '));
  report_('Count cell D1: ' + dash.getRange('D1').getDisplayValue());
  report_('Row 5: ' + dash.getRange(5, 1, 1, width).getValues()[0].join(' | '));

  // "no matches" is one cell holding a string, not a row of results — the same trap the count avoids.
  const empty = dash.getRange('A6').getDisplayValue() === 'no matches';
  report_('First result row: ' + (empty
    ? '(none — the filter matched nothing)'
    : dash.getRange(6, 1, 1, width).getDisplayValues()[0].join(' | ')));
  const titleColumn = dashboardLetter_('title');
  report_('Rows returned: ' + (empty ? 0 : countFilled_(dash.getRange(`${titleColumn}6:${titleColumn}`))));

  // The formula *is* the dashboard. If it is gone, the read-back above still prints headers and a
  // count, so say plainly whether the cell holds a formula or a leftover value.
  report_('A6 holds: ' + (dash.getRange('A6').getFormula()
    ? 'the filter formula ✓' : '⚠ NO FORMULA — run repairDashboard'));

  const protections = protectedRanges_()
    .reduce((all, entry) => all.concat(
      sheetFor_(ss, entry[0]).getProtections(SpreadsheetApp.ProtectionType.RANGE)), []);
  report_('Range protections: ' + protections.map(protection =>
    protection.getRange().getA1Notation() + ' (' + (protection.isWarningOnly()
      ? 'warn on edit' : protection.getEditors().length + ' editor(s)') + ')').join(', '));
  report_('Sheet protections: ' + protectedSheets_().map(tabKey => {
    const sheet = sheetFor_(ss, tabKey);
    return sheet.getName() + ' ' +
      (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length ? 'protected' : '⚠ NOT PROTECTED');
  }).join(', '));

  probeFilterTerms_(ss);
  report_('Still manual: Tools → Notification settings → daily digest');
}

/**
 * Takes the filter apart on a throwaway tab, one term at a time, and prints the raw result of each —
 * including errors, because the live formula wraps `FILTER` in `IFERROR` and so shows a tidy "no
 * matches" whether the filter matched nothing or blew up.
 *
 * `SUMPRODUCT`, not bare arithmetic: multiplying two ranges outside `ARRAYFORMULA` gives `#VALUE!`,
 * which is a fact about the probe rather than about the data.
 */
function probeFilterTerms_(ss) {
  const name = '_filter_probe';
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  const probe = ss.insertSheet(name);

  try {
    const separator = argSeparator_(ss);
    const titled = `(${colRange_('events', 'title')}<>"")`;
    const effective = `IF(${colRange_('events', 'dateEnd')}<>"",` +
      `${colRange_('events', 'dateEnd')},${colRange_('events', 'dateStart')})`;
    const upcoming = `(${effective}>=TODAY())`;
    const stack = 'HSTACK(' + dashboardColumns_().map(key => colRange_('events', key)).join(',') + ')';

    const terms = [
      ['titles present (COUNTA)', `=COUNTA(${colRange_('events', 'title')})`],
      ['titles present (SUMPRODUCT)', `=SUMPRODUCT(--${titled})`],
      // COUNT, not ISDATE: ISDATE does not vectorise inside SUMPRODUCT and answers 0 for whole months
      ['dates that are real dates', `=COUNT(${colRange_('events', 'dateStart')})`],
      ['upcoming, any title', `=SUMPRODUCT(--${upcoming})`],
      ['titled AND upcoming', `=SUMPRODUCT(${titled}*${upcoming})`],
      ['HSTACK width', `=COLUMNS(${stack})`],
      ['FILTER on one column, raw', `=ROWS(FILTER(${colRange_('events', 'title')},${titled}*${upcoming}))`],
      ['FILTER on the HSTACK, raw', `=ROWS(FILTER(${stack},${titled}*${upcoming}))`],
      ['first title it returns', `=INDEX(FILTER(${colRange_('events', 'title')},${titled}*${upcoming}),1)`],
    ];

    terms.forEach((term, i) => setFormula_(probe.getRange(i + 1, 1), term[1], separator));
    SpreadsheetApp.flush();

    report_('--- the filter, term by term ---');
    terms.forEach((term, i) => {
      report_(`  ${term[0]}: ${probe.getRange(i + 1, 1).getDisplayValue()}`);
    });

    // The two spellings have to be evaluated *on* the dashboard: `$B$1:$B$3` are relative to the
    // sheet holding the formula, so the same text means something different anywhere else. Which is
    // why these go through `probeInPlace_`, and why it clears after itself in a `finally`.
    const dash = sheetFor_(ss, 'dashboard');
    report_('--- the two spellings, where the controls resolve ---');
    probeInPlace_(dash, separator, [
      ['controls as the formula sees them  ', 'J1', '="["&$B$1&"] ["&$B$2&"] ["&$B$3&"]"'],
      ['rows from the flat formula (shipped)', 'K1', `=ROWS(${dashboardFilter_(false).substring(1)})`],
      ['rows from the LET spelling          ', 'L1', `=ROWS(${dashboardFilterLet_().substring(1)})`],
    ]).forEach(line => report_('  ' + line));
    report_('  #N/A from the LET is FILTER saying nothing matched — that is the collapse');

    const scope = CONFIG.values.scope;
    const is = value => `(${colRange_('events', 'upcoming')}=${quoteLiteral_(value)})`;
    const scopes = [
      [CONFIG.values.all, '1'],
      [scope.upcoming, is(scope.upcoming)],
      [scope.past, is(scope.past)],
      [`${scope.cancelled} (visible under ${CONFIG.values.all} only)`, is(scope.cancelled)],
    ];
    report_('--- rows each Scope value should return (controls untouched) ---');
    scopes.forEach((entry, i) => {
      setFormula_(probe.getRange(i + 1, 3),
        `=SUMPRODUCT((${colRange_('events', 'title')}<>"")*${entry[1]})`, separator);
    });
    SpreadsheetApp.flush();
    scopes.forEach((entry, i) => {
      report_(`  ${entry[0]}: ${probe.getRange(i + 1, 3).getDisplayValue()}`);
    });
  } finally {
    const leftover = ss.getSheetByName(name);
    if (leftover) ss.deleteSheet(leftover);
  }
}
