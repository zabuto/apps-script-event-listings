/**
 * Tool — is the sheet sound?
 *
 * Not a step. Run `reportState` to read the whole sheet back and check it. It changes nothing: the
 * only thing it writes is a throwaway `_state_probe` tab, because some of these answers exist only
 * once a formula has been evaluated, and `probeValues_` deletes it again in a `finally`.
 *
 * It exists because "the sheet looks fine" is not evidence, and because a build step's log reports
 * only on what that step touched. Every line below is read from the live file as it runs.
 *
 * What it cannot check, because no script can see it:
 *   · that a typed unknown venue is actually refused — that dialog is UI; screenshot it instead
 *   · that a second account with Editor rights cannot overwrite a generated tab
 *   · the daily-digest notification setting
 */
function reportState() {
  log_ = [];
  const ss = openSpreadsheet_();
  const events = sheetFor_(ss, 'events');
  const venues = sheetFor_(ss, 'venues');
  const organisers = sheetFor_(ss, 'organisers');
  const lists = sheetFor_(ss, 'lists');
  const dash = sheetFor_(ss, 'dashboard');
  const separator = argSeparator_(ss);
  const values = CONFIG.values;

  report_(`=== ${ss.getName()} — state as of this run ===`);
  report_(`Locale ${ss.getSpreadsheetLocale()}, time zone ${ss.getSpreadsheetTimeZone()}, ` +
    `separator "${separator}"`);
  report_('Tab order: ' + ss.getSheets().map(sheet => sheet.getName()).join(' → '));
  const first = ss.getSheets()[0].getName();
  report_(`  the map imports the first tab, which is "${first}"` +
    (first === CONFIG.tabs.mapExport ? ' ✓' : ' ⚠'));

  // ---- contracts
  report_('--- column contracts ---');
  ['events', 'venues', 'organisers'].forEach(tabKey => {
    const expected = headers_(tabKey);
    const actual = sheetFor_(ss, tabKey).getRange(1, 1, 1, expected.length).getValues()[0];
    const matches = expected.every((header, i) => actual[i] === header);
    report_(`  ${CONFIG.tabs[tabKey]}: ` +
      (matches ? 'matches ✓' : '⚠ DIFFERS — ' + actual.join(' | ')));
  });

  // ---- volumes
  report_('--- volumes ---');
  const column = (tabKey, key) => sheetFor_(ss, tabKey).getRange(local_(tabKey, key));
  report_(`  ${CONFIG.tabs.events} rows with a title: ` + countFilled_(column('events', 'title')));
  const closed = column('venues', 'status').getDisplayValues()
    .filter(row => row[0] === values.venueStatus.closed).length;
  report_(`  ${CONFIG.tabs.venues}: ${countFilled_(column('venues', 'name'))}` +
    ` · with an address: ${countFilled_(column('venues', 'address'))}` +
    ` · with a postcode: ${countFilled_(column('venues', 'postcode'))}` +
    ` · with a city: ${countFilled_(column('venues', 'city'))}` +
    ` · closed: ${closed}`);
  report_(`  ${CONFIG.tabs.organisers}: ${countFilled_(column('organisers', 'name'))}` +
    ` · with a handle: ${countFilled_(column('organisers', 'social'))}` +
    ` · with a website: ${countFilled_(column('organisers', 'website'))}`);

  // ---- what publishes
  report_('--- what publishes (one column drives the map, the document and the dashboard) ---');
  const upcomingRange = colRange_('events', 'upcoming');
  const titleRange = colRange_('events', 'title');
  const startRange = colRange_('events', 'dateStart');
  probeValues_(ss, separator, [
    [values.scope.upcoming, `=COUNTIF(${upcomingRange},${quoteLiteral_(values.scope.upcoming)})`],
    [values.scope.past, `=COUNTIF(${upcomingRange},${quoteLiteral_(values.scope.past)})`],
    [values.scope.cancelled, `=COUNTIF(${upcomingRange},${quoteLiteral_(values.scope.cancelled)})`],
    ['real dates', `=COUNT(${startRange})`],
    // Counted per row, not as titled-minus-dated: that subtraction holds only while every untitled
    // row is also dateless, and a dated row with no title cancels a genuinely dateless one out of
    // the total. `ISNUMBER` rather than `<>""`, so "dateless" keeps meaning what it does in the line
    // above: text typed into a date column is not a date. Negated by subtraction rather than `NOT`,
    // because arithmetic broadcasts over an array where `NOT` can collapse it — and it keeps a
    // locale-dependent boolean literal out of a formula that only has its separators translated.
    ['dateless but titled', `=SUMPRODUCT((${titleRange}<>"")*(1-ISNUMBER(${startRange})))`],
  ], '_state_probe').forEach(line => report_('  ' + line));

  // ---- the computed columns
  report_('--- computed columns, on row 2 ---');
  report_('  ' + columnSpec_('events').filter(spec => spec.computed).map(spec =>
    `${spec.header} "${events.getRange(2, columnNumber_('events', spec.key)).getDisplayValue()}"`)
    .join(' · '));
  const from = firstComputed_('events');
  const broken = events.getRange(2, from, Math.max(events.getLastRow() - 1, 1),
    computedCount_('events')).getDisplayValues()
    .reduce((total, row) => total + row.filter(value => String(value).indexOf('#') === 0).length, 0);
  report_(`  cells showing an error: ${broken}${broken ? ' ⚠' : ' ✓'}`);

  // ---- the checks, read live
  report_('--- hygiene checks ---');
  reportChecks_(lists);

  // ---- the dashboard as it stands
  report_('--- dashboard ---');
  report_('  A6 filter formula: ' + (dash.getRange('A6').getFormula()
    ? 'present ✓' : '⚠ MISSING — run repairDashboard'));
  report_('  controls: ' + dashboardControls_()
    .map(control => dash.getRange(control[2]).getDisplayValue()).join(' / ') +
    ' → ' + dash.getRange('D1').getDisplayValue());

  // ---- protection
  report_('--- protection ---');
  protectedRanges_().concat(warnedRanges_()).forEach(entry => {
    const sheet = sheetFor_(ss, entry[0]);
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(protection => protection.getDescription() === entry[2])
      .forEach(protection => {
        // A warning-only protection carries no editor list, so counting editors would report it as
        // "0 editor(s)" — indistinguishable from a protection that has failed. Name it instead.
        report_(`  ${sheet.getName()}!${protection.getRange().getA1Notation()} — ` +
          (protection.isWarningOnly()
            ? 'warn on edit (the owner too)'
            : protection.getEditors().length + ' editor(s)'));
      });
  });
  protectedSheets_().forEach(tabKey => {
    const sheet = sheetFor_(ss, tabKey);
    report_(`  ${sheet.getName()}: ` +
      (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length
        ? 'whole tab protected ✓' : '⚠ NOT PROTECTED'));
  });

  // ---- the bound project
  report_('--- the bound project (checked from the outside) ---');
  report_('  Nothing here can read another project\'s properties, so confirm by hand that the');
  report_('  spreadsheet has an Apps Script project with ' +
    Object.keys(CONFIG.properties).filter(key => key !== 'spreadsheetId')
      .map(key => CONFIG.properties[key]).join(', ') + ' set.');

  // ---- what is left for a human
  report_('--- not checkable from a script ---');
  report_('  an unknown venue typed into the venue column must be refused (screenshot it)');
  report_('  a second Editor account must not be able to overwrite a generated tab');
  report_('  Tools → Notification settings → daily digest');

  const summary = log_.join('\n');
  notify_('Sheet state', summary);
  return summary;
}
