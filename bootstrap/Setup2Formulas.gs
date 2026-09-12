/**
 * Step 2 — the computed columns.
 *
 * What it produces: one source for the human-readable date, the city looked up from the venue, and
 * the single column that answers *does this publish?* — reused by the dashboard, the map export and
 * the document, so the three cannot quietly disagree.
 *
 * Run `setupFormulas`. It writes one array formula per computed column, paints the two completeness
 * rules on the venues tab, then reads the whole skeleton back out of the sheet and renders the date
 * scenarios on a throwaway tab. Idempotent, and on an empty events tab the formulas correctly compute
 * to nothing.
 */

/**
 * The city, looked up from the venue.
 *
 * Never typed: a city typed beside a venue is a second copy of a fact the venues tab already holds,
 * and the two drift within a week. An unknown venue is *named* rather than left blank, because blank
 * reads like "no city yet" and this means "this venue does not exist".
 */
function cityFormula_() {
  return `=ARRAYFORMULA(IF(${local_('events', 'venue')}="","",` +
    `IFERROR(XLOOKUP(${local_('events', 'venue')},${colFull_('venues', 'name')},` +
    `${colFull_('venues', 'city')},${quoteLiteral_(CONFIG.values.unknownVenue)}),"")))`;
}

/**
 * Does this publish? — the one column the map, the document and the dashboard all read.
 *
 * Cancelled outranks the dates, so a cancelled event is neither upcoming nor past: it appears only
 * where everything appears, and its status column explains why. The *last* day decides, so a run that
 * started yesterday and ends tomorrow is still upcoming.
 */
function upcomingFormula_() {
  const scope = CONFIG.values.scope;
  const start = local_('events', 'dateStart');
  const end = local_('events', 'dateEnd');
  return `=ARRAYFORMULA(IF(${local_('events', 'title')}="","",` +
    `IF(${local_('events', 'status')}=${quoteLiteral_(CONFIG.values.eventStatus.cancelled)},` +
    `${quoteLiteral_(scope.cancelled)},` +
    `IF(IF(${end}<>"",${end},${start})>=TODAY(),${quoteLiteral_(scope.upcoming)},` +
    `${quoteLiteral_(scope.past)}))))`;
}

/**
 * `Sat 13 Feb 2027` for one day, `13 Feb – 14 Feb 2027` for a run, and the configured
 * to-be-announced wording for a titled row with no date — rather than the 1899 epoch an unguarded
 * `WEEKDAY(blank)` would give.
 *
 * The names come from `CHOOSE`, not from `TEXT`: `TEXT` follows the sheet's locale, and this column is
 * the one source three outputs reuse. `CHOOSE` does expand inside `ARRAYFORMULA` — measured on every
 * run by `probeWhen_`, not assumed.
 *
 * The private note column is deliberately not an input. Nothing published may depend on it.
 */
function whenFormula_(startRef, endRef, titleRef) {
  const quoted = list => list.map(name => quoteLiteral_(name)).join(',');
  const day = `CHOOSE(WEEKDAY(${startRef}),${quoted(CONFIG.values.dayNames)})`;
  const month = ref => `CHOOSE(MONTH(${ref}),${quoted(CONFIG.values.monthNames)})`;
  const single = `${day}&" "&DAY(${startRef})&" "&${month(startRef)}&" "&YEAR(${startRef})`;
  const range = `DAY(${startRef})&" "&${month(startRef)}&" – "&` +
                `DAY(${endRef})&" "&${month(endRef)}&" "&YEAR(${endRef})`;
  return `=ARRAYFORMULA(IF(${titleRef}="","",` +
    `IF(${startRef}="", ${quoteLiteral_(CONFIG.values.dateTba)},` +
    `IF(${endRef}<>"", ${range}, ${single}))))`;
}

/**
 * The same thing spelled with `MID` over a packed string. Not shipped — the probe renders it beside
 * the `CHOOSE` version on every run, so a change that stops either one expanding down the column
 * shows up as a difference rather than as a quiet blank.
 */
function midWhenFormula_(startRef, endRef, titleRef) {
  const packed = list => list.map(name => name.slice(0, 3)).join('');
  const days = packed(CONFIG.values.dayNames);
  const months = packed(CONFIG.values.monthNames);
  const day = `MID(${quoteLiteral_(days)},(WEEKDAY(${startRef})-1)*3+1,3)`;
  const month = ref => `MID(${quoteLiteral_(months)},(MONTH(${ref})-1)*3+1,3)`;
  const single = `${day}&" "&DAY(${startRef})&" "&${month(startRef)}&" "&YEAR(${startRef})`;
  const range = `DAY(${startRef})&" "&${month(startRef)}&" – "&` +
                `DAY(${endRef})&" "&${month(endRef)}&" "&YEAR(${endRef})`;
  return `=ARRAYFORMULA(IF(${titleRef}="","",` +
    `IF(${startRef}="", ${quoteLiteral_(CONFIG.values.dateTba)},` +
    `IF(${endRef}<>"", ${range}, ${single}))))`;
}

/** Entry point. Writes the computed columns, paints the venues tab, and proves both. */
function setupFormulas() {
  log_ = [];
  const ss = openSpreadsheet_();
  const events = sheetFor_(ss, 'events');
  const separator = argSeparator_(ss);

  // Clear the whole computed block first. An array formula refuses to expand over existing data and
  // reports `#REF!` instead — and these columns may have held typed values under an older contract.
  const from = firstComputed_('events');
  if (!from) throw new Error('No column on the events tab is marked `computed: true` — ' +
    'check CONFIG.columns.events.');
  events.getRange(2, from, events.getMaxRows() - 1, computedCount_('events')).clearContent();

  const cell = key => events.getRange(2, columnNumber_('events', key));
  setFormula_(cell('city'), cityFormula_(), separator);
  setFormula_(cell('when'), whenFormula_(
    local_('events', 'dateStart'), local_('events', 'dateEnd'), local_('events', 'title')), separator);
  setFormula_(cell('upcoming'), upcomingFormula_(), separator);
  SpreadsheetApp.flush();
  report_(`Computed columns set in row 2: ` +
    columnSpec_('events').filter(column => column.computed)
      .map(column => columnLetter_('events', column.key) + ' ' + column.header).join(', ') +
    ` (separator "${separator}")`);

  setVenuesFormatting_(ss, separator);
  reportSheetState_(ss);
  probeWhen_(ss, separator);

  const summary = log_.join('\n');
  notify_('Formulas ready', summary);
  return summary;
}

/* ────────────────────────────────────────────────────────── the venues completeness rules ── */

/**
 * A full address is address + postcode + city. Anything short of all three is incomplete — unless the
 * venue is closed, in which case nobody is ever going to geocode it and the nag is noise.
 */
function venueIncomplete_() {
  const closed = CONFIG.values.venueStatus.closed;
  const at = key => '$' + columnLetter_('venues', key) + '2';
  return `AND(${at('status')}<>${quoteLiteral_(closed)},OR(${at('address')}="",${at('postcode')}="",` +
    `${at('city')}=""))`;
}

/**
 * True where the venue is addressless *on purpose*: its `City only?` box is ticked.
 *
 * `=TRUE`, not the bare cell: a blank cell is what an untouched row holds, and a bare reference
 * inside `AND` would have to coerce it. Text that spells the word is not the boolean either, which
 * is the comparison `cityOnlyVenue_` makes on the script side.
 */
function venueCityOnly_() {
  return '$' + columnLetter_('venues', 'cityOnly') + '2=TRUE';
}

/**
 * Two rules that make an incomplete address visible where it is typed, rather than only in a hygiene
 * check nobody scrolls to.
 *
 * Completeness is not cosmetic: the map export builds `Address, Postcode City, Country` for the
 * geocoder, and a missing part drops the pin back to the venue name — approximately right, or in the
 * wrong town. `infoFill` says "incomplete, and that is the decision"; `warnFill` says "incomplete,
 * and it needs an address".
 *
 * Neither may be the solid primary fill: that is the header row and the unknown-venue error, and a
 * missing postcode is neither a heading nor a broken reference.
 *
 * It ends by having the sheet count the ticked `City only?` boxes itself, because the exception rule
 * turns on a boolean literal and a rule that matches nothing looks exactly like a sheet with nothing
 * to except.
 */
function setVenuesFormatting_(ss, separator) {
  const venues = sheetFor_(ss, 'venues');
  const palette = CONFIG.style.palette;
  const spec = columnSpec_('venues');
  const last = columnLetter_('venues', spec[spec.length - 1].key);
  const range = venues.getRange(`A2:${last}`);
  const name = '$' + columnLetter_('venues', 'name') + '2';
  const status = '$' + columnLetter_('venues', 'status') + '2';
  const rules = [];

  // Closed first, and it sets no background: a closed venue is struck through and greyed, the same
  // vocabulary the events tab uses for cancelled and past, so the sheet reads one way throughout.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(localizeFormula_(
      `=AND(${name}<>"",${status}=${quoteLiteral_(CONFIG.values.venueStatus.closed)})`, separator))
    .setStrikethrough(true).setFontColor(palette.grey)
    .setRanges([range]).build());

  // Order matters: the first rule wins where two set the same property, so the deliberate exception
  // is listed ahead of the accusation it would otherwise trigger. Both rules test incompleteness, so
  // a city-only venue that does get a full address goes uncoloured like any other complete row.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(localizeFormula_(
      `=AND(${name}<>"",${venueIncomplete_()},${venueCityOnly_()})`, separator))
    .setBackground(palette.infoFill).setFontColor(palette.ink)
    .setRanges([range]).build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(localizeFormula_(`=AND(${name}<>"",${venueIncomplete_()})`, separator))
    .setBackground(palette.warnFill).setFontColor(palette.ink)
    .setRanges([range]).build());

  venues.setConditionalFormatRules(rules);
  report_(`Conditional formatting on ${CONFIG.tabs.venues}: closed (struck through), city only ` +
          `(info fill), incomplete address (warn fill) — separator "${separator}"`);

  // A conditional format rule is invisible to a log, and the exception turns on a boolean literal.
  reportCityOnlyFlag_(ss, separator);
}

/**
 * Names the rows the two rules will actually paint.
 *
 * The rules themselves are invisible to a log, so this evaluates the same test in JavaScript and
 * prints the venues it hits: a longer city-only list means a maintainer ticked another box, a longer
 * incomplete list means one added a venue and stopped halfway.
 */
function reportVenuesFormatting_(ss) {
  const venues = sheetFor_(ss, 'venues');
  const rows = Math.max(venues.getLastRow() - 1, 0);
  const cityOnly = [];
  const incomplete = [];
  const closed = [];

  if (rows) {
    const width = headers_('venues').length;
    venues.getRange(2, 1, rows, width).getValues().forEach(row => {
      const value = key => row[columnIndex_('venues', key)];
      const name = String(value('name'));
      if (!name) return;
      if (value('status') === CONFIG.values.venueStatus.closed) { closed.push(name); return; }
      if (value('address') !== '' && value('postcode') !== '' && value('city') !== '') return;
      // Through the shared helper, not a comparison of its own: this reports on the rule written
      // above, so it has to answer the way the sheet's `=TRUE` does.
      (cityOnlyVenue_(value('cityOnly')) ? cityOnly : incomplete).push(name);
    });
  }

  report_(`Conditional format rules on ${CONFIG.tabs.venues}: ` +
    venues.getConditionalFormatRules().length);
  report_('  city only, so no address expected: ' +
    (cityOnly.length ? cityOnly.join(' · ') : 'none'));
  report_('  incomplete address: ' +
    (incomplete.length ? incomplete.length + ' — ' + incomplete.join(' · ') : CONFIG.values.clean));
  report_('  closed: ' + (closed.length ? closed.length + ' — ' + closed.join(' · ') : 'none'));
}

/* ─────────────────────────────────────────────────────────────────────────── the read-back ── */

/** Reads step 1 back out of the sheet instead of trusting that it ran. */
function reportSheetState_(ss) {
  report_('--- skeleton read-back ---');
  report_(`Locale ${ss.getSpreadsheetLocale()}, time zone ${ss.getSpreadsheetTimeZone()}`);
  report_('Tabs: ' + ss.getSheets().map(sheet => sheet.getName()).join(', '));

  ['events', 'venues', 'organisers'].forEach(tabKey => {
    const expected = headers_(tabKey);
    const actual = sheetFor_(ss, tabKey).getRange(1, 1, 1, expected.length).getValues()[0];
    const matches = expected.every((header, i) => actual[i] === header);
    report_(`${CONFIG.tabs[tabKey]} headers: ` +
      (matches ? 'match the contract ✓' : '⚠ DIFFER — ' + actual.join(' | ')));
  });

  const events = sheetFor_(ss, 'events');
  report_('Frozen rows on ' + CONFIG.tabs.events + ': ' + events.getFrozenRows());
  const startCell = events.getRange(2, columnNumber_('events', 'dateStart'));
  report_(`Number format of ${headerOf_('events', 'dateStart')}: ` + startCell.getNumberFormat());
  report_(`Font: ${startCell.getFontFamily()} ${startCell.getFontSize()}pt`);

  ['venue', 'organiser', 'status'].forEach(key => {
    const rule = events.getRange(2, columnNumber_('events', key)).getDataValidation();
    report_(`Validation on ${headerOf_('events', key)}: ` + (rule
      ? rule.getCriteriaType() + ', invalid ' + (rule.getAllowInvalid() ? 'ALLOWED ⚠' : 'refused ✓')
      : '⚠ MISSING'));
  });

  report_(`Conditional format rules on ${CONFIG.tabs.events}: ` +
    events.getConditionalFormatRules().length);
  reportVenuesFormatting_(ss);

  // `getFormula` only proves a string was stored; the display value is what proves it parses.
  report_('Computed on row 2: ' + columnSpec_('events').filter(column => column.computed)
    .map(column => `${column.header} "` +
      events.getRange(2, columnNumber_('events', column.key)).getDisplayValue() + '"').join(' · '));

  // One formula per column, in row 2 only: anything below means the block was not cleared.
  const from = firstComputed_('events');
  const strays = events.getRange(3, from, events.getMaxRows() - 2, computedCount_('events'))
    .getFormulas()
    .reduce((total, row) => total + row.filter(formula => formula !== '').length, 0);
  report_('Formulas below row 2 in the computed block: ' + strays + (strays ? ' ⚠ should be 0' : ''));

  // The venue dropdown validates against the active-venue list, so a broken list empties the
  // dropdown and no venue can be entered at all — a silent, total failure. Count what it *resolves*
  // to, not what it stores.
  const lists = sheetFor_(ss, 'lists');
  const picker = listRange_('activeVenues');
  const active = countFilled_(lists.getRange(picker));
  const first = lists.getRange(picker.split(':')[0]).getDisplayValue();
  report_(`Venue picker: ${active} active venue(s), first "${first}"` +
    (active && String(first).indexOf('#') !== 0 ? ' ✓' : ' ⚠ the venue dropdown is empty'));

  report_('Typed rows — ' +
    `${CONFIG.tabs.events} titles ${countFilled_(events.getRange(local_('events', 'title')))}, ` +
    `${CONFIG.tabs.venues} ` +
    countFilled_(sheetFor_(ss, 'venues').getRange(local_('venues', 'name'))) + ', ' +
    `${CONFIG.tabs.organisers} ` +
    countFilled_(sheetFor_(ss, 'organisers').getRange(local_('organisers', 'name'))));
}

/* ───────────────────────────────────────────────────────────────────────────── the probe ── */

/**
 * The date scenarios, on a temporary tab so no test rows are left in the events tab.
 *
 * Seven of them cover every branch of `When` plus both `Upcoming?` edges, and the block is rendered
 * twice — once through `CHOOSE` (what ships), once through `MID` — so a spelling that stops expanding
 * shows up as a mismatch instead of as a plausible blank.
 *
 * One row carries a private note, which every output must ignore. That is the regression test for the
 * rule that nothing published reads a private column.
 */
function probeWhen_(ss, separator) {
  const name = '_when_probe';
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  const probe = ss.insertSheet(name);

  try {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date();
    const at = offset => {
      const then = new Date(now.getTime() + offset * day);
      return new Date(then.getFullYear(), then.getMonth(), then.getDate());
    };
    const status = CONFIG.values.eventStatus;

    // A: start · B: end · C: private note (must be ignored) · D: title · E: status · F: expected
    const rows = [
      [at(7), '', '', 'start only', status.confirmed, 'single date, upcoming'],
      [at(7), at(8), '', 'start and end', status.confirmed, 'range, upcoming'],
      [at(-2), at(1), 'late December', 'note ignored', status.confirmed, 'the dates, not the note'],
      [at(-10), at(-9), '', 'finished', status.confirmed, 'past'],
      ['', '', '', 'no date at all', status.concept, CONFIG.values.dateTba],
      [at(7), '', '', 'cancelled', status.cancelled, 'cancelled, not upcoming'],
      [new Date(2027, 1, 13), '', '', 'a fixed date', status.confirmed, 'Sat 13 Feb 2027'],
    ];
    const last = rows.length;
    probe.getRange(1, 1, last, 6).setValues(rows);
    probe.getRange(`A1:B${last}`).setNumberFormat(CONFIG.spreadsheet.dateFormat);

    // G: the same rule as the Upcoming? column, per row — cancelled outranks the dates.
    const scope = CONFIG.values.scope;
    for (let r = 1; r <= last; r++) {
      setFormula_(probe.getRange(r, 7),
        `=IF(D${r}="","",IF(E${r}=${quoteLiteral_(status.cancelled)},` +
        `${quoteLiteral_(scope.cancelled)},IF(IF(B${r}<>"",B${r},A${r})>=TODAY(),` +
        `${quoteLiteral_(scope.upcoming)},${quoteLiteral_(scope.past)})))`, separator);
    }

    // H and I: the whole block at once, the way the real column has to work. They must agree row for
    // row — H is what ships.
    setFormula_(probe.getRange('H1'),
      whenFormula_(`A1:A${last}`, `B1:B${last}`, `D1:D${last}`), separator);
    setFormula_(probe.getRange('I1'),
      midWhenFormula_(`A1:A${last}`, `B1:B${last}`, `D1:D${last}`), separator);

    // Why the names are not left to TEXT: the same date, both renderings, side by side.
    setFormula_(probe.getRange('J1'), '=TEXT(DATE(2027,2,13),"ddd d mmm yyyy")', separator);
    setFormula_(probe.getRange('J2'),
      `=CHOOSE(WEEKDAY(DATE(2027,2,13)),${CONFIG.values.dayNames.map(d => quoteLiteral_(d)).join(',')})` +
      '&" 13 Feb 2027"', separator);
    SpreadsheetApp.flush();

    report_(`--- 13-02-2027 rendered, locale ${ss.getSpreadsheetLocale()} ---`);
    report_('  TEXT(...,"ddd d mmm yyyy"): ' + probe.getRange('J1').getDisplayValue());
    report_('  CHOOSE over WEEKDAY:        ' + probe.getRange('J2').getDisplayValue());

    const out = probe.getRange(1, 4, last, 6).getDisplayValues();   // D..I
    report_('--- date scenarios: When (CHOOSE, shipped) / When (MID) / Upcoming? ---');
    let mismatched = 0;
    out.forEach(row => {
      // D title · E status · F expected · G Upcoming? · H When (CHOOSE) · I When (MID)
      if (row[4] !== row[5]) mismatched++;
      report_(`  ${row[0]}: "${row[4]}" / "${row[5]}" · ${row[3]}  [expected: ${row[2]}]`);
    });
    report_(mismatched
      ? `  ⚠ ${mismatched} row(s) differ between the two spellings — one stopped expanding`
      : '  both spellings agree on every row ✓');
  } finally {
    const leftover = ss.getSheetByName(name);
    if (leftover) ss.deleteSheet(leftover);
  }
}
