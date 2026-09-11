/**
 * Step 3 — the hygiene checks that watch the rows.
 *
 * What it produces: a labelled block on the `Lists` tab for each thing that can quietly go wrong —
 * an unknown venue, an unknown organiser, a venue with no address, a handle carrying an `@`, and an
 * upcoming event booked into a venue that has closed.
 *
 * `setupAll` runs this as step 3, and `setupChecks` is also the one to run on its own after any
 * change to a column contract: it writes the formulas, reports what each one resolves to, and
 * touches no data, so it is safe on a sheet in use.
 *
 * It installs the checks; it does not judge the data. The formulas re-evaluate themselves on every
 * edit, so the sheet is always answering — running this only rewrites the question. The bound
 * project's `checkData` is the one that inspects the rows on demand and explains what it found.
 *
 * Seeding is **not** here. `seedSheet` rewrites the data tabs, so it is a tool rather than a step and
 * lives in `ToolSeed.gs`.
 */

/**
 * The hygiene checks, each in its own labelled block on the `Lists` tab.
 *
 * Columns P–Z, two apart, kept clear of the pickers in A–N. Every one of them prints the configured
 * "clean" marker when it finds nothing, so an *empty* cell always means the check did not run — the
 * one failure a check must never be able to hide.
 */
function checkBlocks_() {
  const values = CONFIG.values;
  const clean = quoteLiteral_(values.clean);

  return [
    [
      'P',
      'Unknown venues',
      `=IFERROR(FILTER(${colRange_('events', 'venue')}, ${colRange_('events', 'venue')}<>"", ` +
        `ISNA(MATCH(${colRange_('events', 'venue')},${colFull_('venues', 'name')},0))),${clean})`,
    ],

    [
      'R',
      'Unknown organisers',
      `=IFERROR(FILTER(${colRange_('events', 'organiser')}, ` +
        `${colRange_('events', 'organiser')}<>"", ` +
        `ISNA(MATCH(${colRange_('events', 'organiser')},${colFull_('organisers', 'name')},0))),${clean})`,
    ],

    // Closed venues and the deliberately addressless ones are excluded for the same reason: the
    // sheet has already decided about them, and a check that reports a settled decision on every run
    // teaches maintainers to skip the block.
    [
      'T',
      'Venue without an address',
      `=IFERROR(FILTER(${colRange_('venues', 'name')}, ${colRange_('venues', 'name')}<>"", ` +
        `${colRange_('venues', 'address')}="", ` +
        `${colRange_('venues', 'status')}<>${quoteLiteral_(values.venueStatus.closed)}` +
        // Both lists are typed by a person, so both go through `quoteLiteral_` — see the note on
        // `venueAddresslessByDesign_`, which spells the same two lists for the conditional formats.
        CONFIG.privacy.cityOnlyMarkers
          .map(marker =>
            `, ISERROR(SEARCH(${quoteLiteral_(marker)},${colRange_('venues', 'notesPrivate')}))`)
          .join('') +
        CONFIG.privacy.addresslessByDesign
          .map(venue => `, ${colRange_('venues', 'name')}<>${quoteLiteral_(venue)}`)
          .join('') +
        `),${clean})`,
    ],

    [
      'V',
      `Handle with an @`,
      `=IFERROR(FILTER(${colRange_('organisers', 'name')}, ` +
        `LEFT(${colRange_('organisers', 'social')},1)="@"),${clean})`,
    ],

    [
      'X',
      'Counts',
      `=COUNTA(${colRange_('events', 'status')})&" rows · "&` +
        `COUNTA(${colRange_('events', 'title')})&" titled · "&` +
        `COUNTA(${colRange_('venues', 'name')})&" venues · "&` +
        `COUNTA(${colRange_('organisers', 'name')})&" organisers"`,
    ],

    // The one thing closing a venue can actually break: an event still scheduled into it. Past rows
    // are left alone on purpose — history is allowed to name a venue that has since shut.
    //
    // The status comes from `XLOOKUP` inside `ARRAYFORMULA`, the shape the city column already proves
    // works. Not `COUNTIFS(Venues!A:A, Events!D2:D, …)`: `COUNTIFS` broadcasts an array criterion
    // reliably only under `ARRAYFORMULA`, and inside `FILTER` it can collapse to a single value and
    // report clean for every row — a false negative, and invisible while nothing is closed.
    [
      'Z',
      'Upcoming event at a closed venue',
      `=IFERROR(FILTER(${colRange_('events', 'title')}&" — "&${colRange_('events', 'venue')}, ` +
        `${colRange_('events', 'title')}<>"", ` +
        `${colRange_('events', 'upcoming')}=${quoteLiteral_(values.scope.upcoming)}, ` +
        `ARRAYFORMULA(IFERROR(XLOOKUP(${colRange_('events', 'venue')},${colFull_('venues', 'name')},` +
        `${colFull_('venues', 'status')},""),""))=${quoteLiteral_(values.venueStatus.closed)}),${clean})`,
    ],

    // The private note is not policed here. Nothing published reads it, so there is nothing to
    // protect against — and a heuristic that flags "december 2026" as a house number belongs in the
    // bound project's `checkData`, where it can explain itself to the person who pressed the button.
  ];
}

/* ─────────────────────────────────────────────────────────────────────────── the checks ── */

/**
 * Writes the check formulas and reports what each one resolves to. Touches no data, so it is the
 * safe entry point and the one to run after any change to a column contract.
 */
function setupChecks() {
  log_ = [];
  const ss = openSpreadsheet_();
  const lists = sheetFor_(ss, 'lists');
  writeChecks_(lists, argSeparator_(ss));
  SpreadsheetApp.flush();
  reportChecks_(lists);
  const summary = log_.join('\n');
  notify_('Checks ready', summary);
  return summary;
}

function writeChecks_(sheet, separator) {
  checkBlocks_().forEach(block => {
    label_(sheet, block[0] + '1', block[1]);
    setFormula_(sheet.getRange(block[0] + '2'), block[2], separator);
  });
  report_('Hygiene checks written in columns ' + checkBlocks_().map(block => block[0]).join(', '));
}

/**
 * What each check actually resolves to.
 *
 * Storing a check proves nothing: a formula that returns "clean" because it collapsed reads exactly
 * like one that returns "clean" because the sheet is, and `#ERROR!` reads like neither until somebody
 * looks.
 */
function reportChecks_(lists) {
  report_('--- checks, as they now evaluate ---');
  checkBlocks_().forEach(block => {
    const column = block[0];
    const found = lists.getRange(`${column}2:${column}`).getDisplayValues()
      .map(row => row[0])
      .filter(value => value !== '' && value !== null);
    if (!found.length) {
      report_(`  ${block[1]}: (empty) ⚠ the check did not run`);
    } else if (found.length === 1) {
      report_(`  ${block[1]}: ${found[0]}`);
    } else {
      // ' · ' rather than ', ': organiser names contain commas, and a comma-joined list of them reads
      // as more findings than there are.
      report_(`  ${block[1]}: ${found.length} — ${found.slice(0, 5).join(' · ')}` +
        (found.length > 5 ? ` · … +${found.length - 5} more` : ''));
    }
  });
}

