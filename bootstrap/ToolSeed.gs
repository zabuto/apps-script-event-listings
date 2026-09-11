/**
 * Tool — write the sample rows into a fresh sheet.
 *
 * Not a step, which is why it is not in `setupAll` and not numbered: `seedSheet` **rewrites all three
 * data tabs** from `SeedData.gs`. That is right on a sheet nobody has typed into yet and destructive
 * on one in use, so it stays a deliberate act. `SeedData.gs` holds the rows themselves and has no
 * entry point of its own.
 *
 * Two things enforce that rather than trusting anyone to remember. `refuseIfHandAdded_` throws the
 * moment the sheet holds a venue, organiser or event the seed does not — on an empty sheet it finds
 * nothing and returns. And every helper that reads existing rows guards the empty case, so building
 * from nothing is a supported path rather than an accident.
 *
 * Organisers, then venues, then events: the order the dropdowns need, since each validates against
 * the one before it.
 */

/**
 * Set to true only for a deliberate reset that discards rows added since the last seed.
 *
 * `seedSheet` regenerates all three tabs from `SeedData.gs`, so a row a maintainer typed in is not
 * in those functions and would simply vanish.
 */
const DISCARD_HAND_ADDED_ROWS = false;

/* ────────────────────────────────────────────────────────────────────────── the seeding ── */

/** Entry point for a fresh or rebuilt spreadsheet. Rewrites all three data tabs. */
function seedSheet() {
  log_ = [];
  const ss = openSpreadsheet_();
  ['events', 'venues', 'organisers'].forEach(tabKey => requireCurrentHeaders_(sheetFor_(ss, tabKey), tabKey));
  refuseIfHandAdded_(ss);

  writeOrganisers_(sheetFor_(ss, 'organisers'));
  writeVenues_(sheetFor_(ss, 'venues'));
  writeEvents_(sheetFor_(ss, 'events'));
  writeChecks_(sheetFor_(ss, 'lists'), argSeparator_(ss));
  SpreadsheetApp.flush();

  reportSeed_(ss);

  const summary = log_.join('\n');
  notify_('Seed written', summary);
  return summary;
}

function writeOrganisers_(sheet) {
  const held = keyedRows_(sheet, headers_('organisers').length);
  clearData_(sheet, headers_('organisers').length);
  const details = seedOrganiserDetails_();
  const kept = {};
  let seeded = 0;

  const rows = seedOrganisers_().map(name => {
    const existing = held[name] || [];
    const seed = details[name] || {};
    // The sheet wins, the seed fills the gaps, and only what came from the sheet counts as carried
    // over — a log that counts seeded values as preserved work lies about the one thing this
    // function exists to prove.
    const value = (key, seedValue) => {
      const carried = existing[columnIndex_('organisers', key)];
      if (carried) {
        const header = headerOf_('organisers', key);
        kept[header] = (kept[header] || 0) + 1;
      }
      return carried || seedValue || '';
    };
    if (!held[name] && (seed.social || seed.website)) seeded++;
    const row = [];
    row[columnIndex_('organisers', 'name')] = literal_(name);
    row[columnIndex_('organisers', 'social')] = literal_(value('social', seed.social));
    row[columnIndex_('organisers', 'website')] = literal_(value('website', seed.website));
    row[columnIndex_('organisers', 'notesPrivate')] = literal_(value('notesPrivate', seed.notes));
    return row;
  });

  setValuesPastValidation_(sheet.getRange(2, 1, rows.length, headers_('organisers').length), rows);
  report_(`${rows.length} organisers written; values carried over from the sheet: ` +
    (Object.keys(kept).length
      ? Object.keys(kept).map(column => `${kept[column]} ${column}`).join(', ')
      : 'none to carry') + (seeded ? ` · ${seeded} restored from the seed` : ''));
}

function writeVenues_(sheet) {
  const width = headers_('venues').length;
  const held = keyedRows_(sheet, width);
  clearData_(sheet, width);
  const details = seedVenueDetails_();
  const active = CONFIG.values.venueStatus.active;
  const kept = {};
  let seeded = 0;

  // The sheet wins; the seed only fills what the sheet does not have; the default is last.
  const rows = seedVenues_().map(venue => {
    const [name, city, notes] = venue;
    const existing = held[name] || [];
    const seed = details[name] || {};
    if (!held[name] && (seed.address || seed.postcode || seed.url)) seeded++;

    const carried = key => existing[columnIndex_('venues', key)];
    // Counted only where the value came from the sheet — see the note in `writeOrganisers_`.
    const pick = (key, seedValue, fallback) => {
      const held = carried(key);
      if (held) {
        const header = headerOf_('venues', key);
        kept[header] = (kept[header] || 0) + 1;
      }
      return held || seedValue || fallback || '';
    };

    const row = [];
    row[columnIndex_('venues', 'name')] = literal_(name);
    row[columnIndex_('venues', 'address')] = pick('address', seed.address);
    row[columnIndex_('venues', 'postcode')] = literal_(pick('postcode', seed.postcode));
    row[columnIndex_('venues', 'city')] = literal_(city);
    row[columnIndex_('venues', 'url')] = pick('url', seed.url);
    row[columnIndex_('venues', 'notesPrivate')] = literal_(pick('notesPrivate', seed.notes, notes));
    row[columnIndex_('venues', 'status')] = carried('status') || seed.status || active;
    return row;
  });

  setValuesPastValidation_(sheet.getRange(2, 1, rows.length, width), rows);
  report_(`${rows.length} venues written; values carried over from the sheet: ` +
    (Object.keys(kept).length
      ? Object.keys(kept).map(column => `${kept[column]} ${column}`).join(', ')
      : 'none to carry') + (seeded ? ` · ${seeded} restored from the seed` : ''));
}

function writeEvents_(sheet) {
  const typed = firstComputed_('events') ? firstComputed_('events') - 1 : headers_('events').length;
  // Harvested before the clear: a blanked tab hands back no notes, and the run still reports a
  // plausible count, because the seed carries notes of its own.
  const held = heldNotes_(sheet, typed);
  clearData_(sheet, typed);            // the typed columns only — the computed block is not ours

  const rows = seedEvents_().map(event => {
    const [start, end, title, venue, organiser, status, note] = event;
    const carried = held[eventKey_(start, title)];
    const row = [];
    row[columnIndex_('events', 'dateStart')] = dateOf_(start);
    row[columnIndex_('events', 'dateEnd')] = dateOf_(end);
    row[columnIndex_('events', 'title')] = literal_(title);
    row[columnIndex_('events', 'venue')] = literal_(venue);
    row[columnIndex_('events', 'organiser')] = literal_(organiser);
    row[columnIndex_('events', 'status')] = status;
    row[columnIndex_('events', 'notePrivate')] = literal_((carried && carried.note) || note);
    return row;
  });

  setValuesPastValidation_(sheet.getRange(2, 1, rows.length, typed), rows);
  report_(`${rows.length} events written into the typed columns; ` +
    `${rows.filter(row => row[columnIndex_('events', 'notePrivate')]).length} carry a private note`);
}

/**
 * Writes a block past the dropdowns guarding it, and puts them back.
 *
 * A strict rule does **not** let a script through: `setValues` over a validated range throws
 * `The data entered in cell D4 does not meet the data validation rules set for this cell`, naming one
 * cell and writing none of them. The venue dropdown lists only *active* venues, and the seed carries
 * a past event at a venue that has since closed on purpose — so the one row proving history may name
 * a closed venue is the row that cannot be written while the rule is on.
 *
 * The rule is right and the write is right: validation exists to constrain a person typing a *new*
 * row, not the generator reproducing a known dataset. Suspending it for the width of the write is
 * how both stay true.
 *
 * Read back and re-applied rather than rebuilt, so a rule `setupSkeleton` set cannot be quietly
 * dropped here, and restored in a `finally` because a half-written block with its dropdowns off is
 * the one state worse than the failure.
 */
function setValuesPastValidation_(range, values) {
  const rules = range.getDataValidations();
  range.clearDataValidations();
  try {
    range.setValues(values);
  } finally {
    range.setDataValidations(rules);
  }
}


/* ─────────────────────────────────────────────────────────────────────── carry-over ── */

/** Existing rows keyed by their first column, so hand-entered columns can be carried over. */
function keyedRows_(sheet, width) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return {};
  const byKey = {};
  sheet.getRange(2, 1, rows, width).getValues().forEach(row => {
    if (row[0] !== '' && row[0] !== null) byKey[String(row[0])] = row;
  });
  return byKey;
}

/** An event has no single key, so a row is identified by its start date plus its title. */
function eventKey_(iso, title) {
  return (iso || 'nodate') + '|' + title;
}

/**
 * Private notes are typed by hand and keyed back onto the regenerated rows.
 *
 * Guarded by the header: on a sheet whose columns have moved, harvesting would key rows on the wrong
 * field. On a mismatch it carries nothing over, which is the safe direction.
 */
function heldNotes_(sheet, width) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return {};
  const titleColumn = columnNumber_('events', 'title');
  if (sheet.getRange(1, titleColumn).getValue() !== headerOf_('events', 'title')) {
    report_('The events tab is not in the current column layout — nothing carried over from it');
    return {};
  }
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const held = {};
  sheet.getRange(2, 1, rows, width).getValues().forEach(row => {
    const title = row[columnIndex_('events', 'title')];
    if (!title) return;
    const start = row[columnIndex_('events', 'dateStart')];
    const iso = start instanceof Date ? Utilities.formatDate(start, tz, 'yyyy-MM-dd') : '';
    held[eventKey_(iso, String(title))] = { note: row[columnIndex_('events', 'notePrivate')] };
  });
  return held;
}

/** Everything below row 1, so headers, formats and validation survive. */
function clearData_(sheet, width) {
  const rows = sheet.getMaxRows() - 1;
  if (rows > 0) sheet.getRange(2, 1, rows, width).clearContent();
}

/* ──────────────────────────────────────────────────────────────────────── the guards ── */

/**
 * Refuses to write rows into a tab whose header row is from an older contract.
 *
 * Step 1 owns the headers, the validation and the formats. Writing today's row shape under stale
 * headers would put every value one column out — and look plausible while doing it.
 */
function requireCurrentHeaders_(sheet, tabKey) {
  const expected = headers_(tabKey);
  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  const mismatch = expected.filter((header, i) => actual[i] !== header);
  if (mismatch.length) {
    throw new Error(`${sheet.getName()} headers are not the current contract (expected ` +
      `${expected.join(' | ')}; found ${actual.join(' | ')}). Run setupSkeleton first.`);
  }
}

/**
 * Stops the run when the sheet holds rows the seed cannot regenerate.
 *
 * Seeding is a migration, not a sync: safe while the sheet is still being built, destructive the
 * moment maintainers add events. This check is what makes the difference visible instead of silent.
 */
function refuseIfHandAdded_(ss) {
  const known = {
    venues: seedVenues_().map(venue => venue[0]),
    organisers: seedOrganisers_().slice(),
  };
  const extra = [];

  ['venues', 'organisers'].forEach(tabKey => {
    const sheet = sheetFor_(ss, tabKey);
    const rows = sheet.getLastRow() - 1;
    if (rows < 1) return;
    sheet.getRange(2, 1, rows, 1).getValues().forEach((row, i) => {
      const name = String(row[0]);
      if (name && known[tabKey].indexOf(name) === -1) {
        extra.push(`${CONFIG.tabs[tabKey]} row ${i + 2}: "${name}"`);
      }
    });
  });

  const events = sheetFor_(ss, 'events');
  const eventRows = events.getLastRow() - 1;
  if (eventRows > 0) {
    const tz = ss.getSpreadsheetTimeZone();
    const keys = {};
    seedEvents_().forEach(event => { keys[eventKey_(event[0], event[2])] = true; });
    const width = Math.max(columnNumber_('events', 'title'), columnNumber_('events', 'dateStart'));
    events.getRange(2, 1, eventRows, width).getValues().forEach((row, i) => {
      const title = row[columnIndex_('events', 'title')];
      if (!title) return;                                 // untitled rows cannot be keyed
      const start = row[columnIndex_('events', 'dateStart')];
      const iso = start instanceof Date ? Utilities.formatDate(start, tz, 'yyyy-MM-dd') : '';
      if (!keys[eventKey_(iso, String(title))]) {
        extra.push(`${CONFIG.tabs.events} row ${i + 2}: "${title}"`);
      }
    });
  }

  if (!extra.length) return;
  if (DISCARD_HAND_ADDED_ROWS) {
    report_(`⚠ discarding ${extra.length} hand-added row(s) because DISCARD_HAND_ADDED_ROWS is ` +
      'on: ' + extra.slice(0, 10).join(' · '));
    return;
  }
  throw new Error(`${extra.length} row(s) in the sheet are not in the seed and would be deleted:\n` +
    extra.slice(0, 15).join('\n') +
    (extra.length > 15 ? `\n…and ${extra.length - 15} more` : '') +
    '\n\nSeeding regenerates these tabs from SeedData.gs, so it is a migration, not a sync. Run ' +
    'captureSheetData and paste its output into SeedData.gs, or set DISCARD_HAND_ADDED_ROWS = true ' +
    'to overwrite them.');
}

/* ───────────────────────────────────────────────────────────────────────── the report ── */

/** Reads the checks back and names every row the seed left incomplete. */
function reportSeed_(ss) {
  reportChecks_(sheetFor_(ss, 'lists'));

  // The computed columns were set against an empty sheet; this is the first time they see rows, so
  // the run that fills the data is the right place to prove they resolve.
  const events = sheetFor_(ss, 'events');
  report_('--- the computed columns against real rows (row 2) ---');
  const display = key => events.getRange(2, columnNumber_('events', key)).getDisplayValue();
  report_(`  ${display('title')} · ${display('venue')} → ` +
    columnSpec_('events').filter(column => column.computed)
      .map(column => `${column.header} "${display(column.key)}"`).join(' · '));
  const broken = columnSpec_('events').filter(column => column.computed)
    .filter(column => display(column.key).indexOf('#') === 0);
  if (broken.length) report_(`  ⚠ ${broken.length} computed column(s) are in error`);

  report_('--- rows the seed left incomplete (kept, not invented) ---');
  seedEvents_().forEach((event, i) => {
    const missing = [];
    if (!event[0]) missing.push('no date');
    if (!event[2]) missing.push('no title');
    if (!event[3]) missing.push('no venue');
    if (!event[4]) missing.push('no organiser');
    if (missing.length) {
      report_(`  row ${i + 2} "${event[2] || '(untitled)'}" — ${missing.join(', ')} · ` + `status ${event[5]}`);
    }
  });
  report_('An undated row reads as past, so it stays off the map and out of the document until a ' +
    'date is filled in.');
}
