/**
 * The container-bound project script — the code that ships.
 *
 * **Bound to the spreadsheet**, not standalone, so it travels with the file. The scaffolding in
 * `bootstrap/` never leaves the repo, so anything maintainers must be able to repair lives here.
 *
 * Five menu items: a data check, a rebuild of the `Map Export` tab, a rebuild of the agenda
 * document, a dated PDF of it, and the weekly trigger that keeps that document current. No API key,
 * no advanced services, no Cloud project; the scopes — the container, Drive, Documents and script
 * triggers — are granted by each maintainer on their first menu item.
 *
 * Everything nameable is in `Config.gs`.
 */


/* ══════════════════════════════════════════════════════════════════════════════════ the menu ═══ */

/**
 * Everything the menu can offer, in order. `null` is a separator.
 *
 * An item is offered only if its function exists, and a separator waits for something to follow it:
 * this menu is the only interface a maintainer ever sees, and an item that answers `Script function
 * not found` is worse than a missing one. Delete a function below and the menu shrinks; add one and
 * it appears.
 */
function menuItems_() {
  return [
    ['Check data', 'checkData'],
    ['Refresh map export', 'refreshMapExport'],
    null,
    ['Generate events document', 'generateEventsDoc'],
    ['Save events PDF', 'saveEventsPdf'],
    null,
    ['Install weekly refresh', 'installWeeklyRefresh'],
  ];
}

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(CONFIG.brand.menu);
  let separatorPending = false;
  let added = 0;

  menuItems_().forEach(item => {
    if (!item) { separatorPending = added > 0; return; }
    if (typeof globalThis[item[1]] !== 'function') return;
    if (separatorPending) { menu.addSeparator(); separatorPending = false; }
    menu.addItem(item[0], item[1]);
    added++;
  });

  menu.addToUi();
}


/* ════════════════════════════════════════════════════════════════════ columns and contracts ═══ */

/**
 * The configured columns of a tab, by its `CONFIG.tabs` key.
 *
 * Read through a function rather than a top-level constant on purpose: Apps Script concatenates a
 * project's files in an order you do not control and `const` does not hoist, so a load-time read of
 * `CONFIG` works or throws depending on which file was evaluated first.
 */
function columnSpec_(tabKey) {
  const spec = CONFIG.columns[tabKey];
  if (!spec) throw new Error(`No columns configured for "${tabKey}" — check CONFIG.columns.`);
  return spec;
}

/** The header row a tab must have, in order. */
function headers_(tabKey) {
  return columnSpec_(tabKey).map(column => column.header);
}

/** 0-based position of a column, by its `key`. Throws rather than returning -1. */
function columnIndex_(tabKey, key) {
  const at = columnSpec_(tabKey).findIndex(column => column.key === key);
  if (at < 0) throw new Error(`No "${key}" column on ${tabKey} — check CONFIG.columns.`);
  return at;
}

/** `A`, `B`, … `AA`. Spreadsheet columns are base-26 with no zero, which is why this is a loop. */
function columnLetter_(tabKey, key) {
  let n = columnIndex_(tabKey, key) + 1;
  let letter = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - remainder) / 26);
  }
  return letter;
}

/** A tab name as a formula may refer to it: quoted when it contains anything but word characters. */
function tabRef_(tabKey) {
  const name = CONFIG.tabs[tabKey];
  if (!name) throw new Error(`No tab configured for "${tabKey}" — check CONFIG.tabs.`);
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** `Events!C2:C` — one column, from row 2 down. */
function colRange_(tabKey, key, firstRow) {
  const letter = columnLetter_(tabKey, key);
  return `${tabRef_(tabKey)}!${letter}${firstRow || 2}:${letter}`;
}

/** `Venues!$A:$A` — the whole column, absolute, for a lookup. */
function colLookup_(tabKey, key) {
  const letter = columnLetter_(tabKey, key);
  return `${tabRef_(tabKey)}!$${letter}:$${letter}`;
}

/**
 * A tab's data rows plus a by-key column lookup, with row 1 checked against the contract first.
 *
 * Refusing to read a tab whose headers have moved is the point: a read by position against a shifted
 * sheet does not fail, it answers wrongly, and a check that reports *clean* off the wrong column is
 * worse than no check at all.
 */
function table_(tabKey) {
  const name = CONFIG.tabs[tabKey];
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error(`No "${name}" tab in this spreadsheet.`);

  const expected = headers_(tabKey);
  const header = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  const wrong = expected.filter((title, i) => header[i] !== title);
  if (wrong.length) {
    throw new Error(`"${name}" does not match the column contract.\n\n` +
      `expected: ${expected.join(' | ')}\nfound:    ${header.join(' | ')}\n\n` +
      'Fix the headers, or fix CONFIG.columns and push both projects — do not let the checks read on.');
  }

  const last = sheet.getLastRow();
  const rows = last > 1
    ? sheet.getRange(2, 1, last - 1, expected.length).getValues()
    : [];
  return {
    sheet: sheet,
    rows: rows,
    /** 0-based index of a column, by key — so callers never spell a position. */
    at: key => columnIndex_(tabKey, key),
    /** The value of one column of one row, by key. */
    get: (row, key) => row[columnIndex_(tabKey, key)],
    /** The same, trimmed to a string, which is what most reads actually want. */
    text: (row, key) => String(row[columnIndex_(tabKey, key)] || '').trim(),
  };
}

/**
 * A venue or organiser name as the sheet's own lookups compare it: trimmed, case folded.
 *
 * Every sheet-side resolution of these names ignores case — `XLOOKUP` in the `City` column and the
 * map export, `MATCH(…,0)` in the hygiene checks, `requireValueInRange` in the dropdowns — so the
 * sheet answers `de nieuwe anita` with the venue it lists as `De Nieuwe Anita`. Validation cannot
 * keep the two spellings in step either: a rule is checked when a cell is written and never
 * retroactively, so recapitalising a name in a lookup tab leaves every row that already named it
 * spelled the old way.
 *
 * A raw comparison therefore reads the sheet wrongly in both directions: the unknown-venue and
 * unknown-organiser reports name a row the `City` column and the map both resolve, and the
 * closed-venue report — the one thing closing a venue can actually break — stops recognising the
 * venue it is watching and goes quiet. Every lookup keyed by a name goes through here.
 */
function lookupKey_(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
}


/* ═════════════════════════════════════════════════════════════════════════════ the data check ═══ */

/**
 * Whether a venue's `City only?` cell says *this venue carries a city and nothing more* — never
 * nagged for a missing address, and never allowed to carry a street number.
 *
 * One cell, both consequences, and three readers held to this one answer: `venueCityOnly_` for the
 * conditional format, the `Venue without an address` check for the sheet's own worklist, and
 * `checkData` in the bound project.
 *
 * Strictly `true`, because the column is a checkbox and a ticked box is the boolean. Text that
 * merely spells it — `TRUE` pasted over the box, `yes`, `ja` — is not ticked, and the sheet's own
 * `=TRUE` comparison reads it as unticked too. Anything looser would have the script exempting a
 * venue the sheet still nags about.
 */
function cityOnlyVenue_(value) {
  return value === true;
}

/**
 * Unknown keys, suspicious dates, missing addresses, `@`-handles and events booked into a closed
 * venue — in one dialog.
 *
 * Three things are deliberately **not** reported, because a check that names a settled decision on
 * every run teaches maintainers to close the dialog unread:
 *
 *   · a concept or cancelled event with no date. A missing date only matters once it is confirmed.
 *   · a venue with no address whose `City only?` box is ticked. The flag lives in the sheet rather
 *     than in a list in here, so the script and the sheet's own checks cannot hold two copies of it
 *     and drift apart.
 *   · a concept event with no venue. Dates go out before rooms are booked, and the event still
 *     belongs in the agenda: the document lists it as *venue to be announced* while the map leaves
 *     it out, because a pin cannot say that. Confirming it makes it a problem — and that is
 *     reported.
 */
function checkData() {
  const events = table_('events');
  const venues = table_('venues');
  const organisers = table_('organisers');
  const status = CONFIG.values.eventStatus;
  const scope = CONFIG.values.scope;

  const venueKeys = new Set();
  const closedVenues = new Set();
  venues.rows.forEach(row => {
    const name = venues.text(row, 'name');
    if (!name) return;
    venueKeys.add(lookupKey_(name));
    if (venues.get(row, 'status') === CONFIG.values.venueStatus.closed) {
      closedVenues.add(lookupKey_(name));
    }
  });

  const organiserKeys = new Set(
    organisers.rows.map(row => lookupKey_(organisers.text(row, 'name'))).filter(String));

  const problems = [];

  events.rows.forEach((row, i) => {
    const at = `${CONFIG.tabs.events} row ${i + 2}`;
    const title = events.get(row, 'title');
    if (!title) return;                       // an untitled row is a placeholder, not an event

    const start = events.get(row, 'dateStart');
    const end = events.get(row, 'dateEnd');
    const venue = events.text(row, 'venue');
    const organiser = events.text(row, 'organiser');
    const eventStatus = events.get(row, 'status');

    if (!start && eventStatus === status.confirmed) {
      problems.push(`${at}: "${title}" is ${status.confirmed} with no date`);
    }
    // The date rule applied to the room: a concept event may still be looking for a venue, a
    // confirmed one may not. Without a venue it has no city and no position, so it cannot be mapped
    // and a reader cannot go to it.
    if (!venue && eventStatus === status.confirmed) {
      problems.push(`${at}: "${title}" is ${status.confirmed} with no venue`);
    }
    if (start && end && end < start) problems.push(`${at}: end date is before the start date`);
    if (venue && !venueKeys.has(lookupKey_(venue))) {
      problems.push(`${at}: unknown venue "${venue}"`);
    }
    if (organiser && !organiserKeys.has(lookupKey_(organiser))) {
      problems.push(`${at}: unknown organiser "${organiser}"`);
    }

    // The one thing closing a venue can actually break: an event still scheduled into it. Past rows
    // are left alone — history is allowed to name a venue that has since shut.
    if (events.get(row, 'upcoming') === scope.upcoming && closedVenues.has(lookupKey_(venue))) {
      problems.push(`${at}: "${title}" is upcoming at "${venue}", which is closed`);
    }
  });

  venues.rows.forEach((row, i) => {
    const at = `${CONFIG.tabs.venues} row ${i + 2}`;
    const name = venues.text(row, 'name');
    if (!name) return;

    const address = venues.text(row, 'address');
    const postcode = venues.text(row, 'postcode');
    const cityOnly = cityOnlyVenue_(venues.get(row, 'cityOnly'));

    if (!address && !cityOnly && venues.get(row, 'status') !== CONFIG.values.venueStatus.closed) {
      problems.push(`${at}: "${name}" has no address`);
    }
    // A city-only venue carries the city and nothing else. A street number on one is the shape a
    // privacy breach takes here, and it goes public the moment the map is re-imported.
    if (cityOnly && /\d/.test(address)) {
      problems.push(`${at}: "${name}" is marked city-only but its address has a street number — ` +
                    'remove it before the next map refresh');
    }
    // The postcode is the same leak by another column: the geocoded line is `address, postcode city`,
    // so a postcode left in place publishes one side of one block as soon as the address column holds
    // anything at all — a place name included, which is what a city-only venue is meant to carry.
    if (cityOnly && postcode) {
      problems.push(`${at}: "${name}" is marked city-only but has a postcode, which the map ` +
                    'publishes beside the address — remove it before the next map refresh');
    }
  });

  organisers.rows.forEach((row, i) => {
    const name = organisers.get(row, 'name');
    const handle = String(organisers.get(row, 'social'));
    if (name && handle.startsWith('@')) {
      problems.push(`${CONFIG.tabs.organisers} row ${i + 2}: "${name}" — drop the @ from the ` +
                    `${CONFIG.social.label} handle`);
    }
  });

  notify_(problems.length
    ? `${problems.length} issue(s):\n\n${problems.slice(0, 40).join('\n')}` +
      (problems.length > 40 ? `\n\n…and ${problems.length - 40} more` : '')
    : 'No issues found — safe to refresh the map.');
}

/**
 * Alerts when a human ran the function, stays silent on a trigger.
 *
 * A bare `getUi().alert()` throws on a scheduled run — at the **last** line, after all the work is
 * done, which reads as a failed refresh. The weekly trigger depends on this.
 */
function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    console.log(message);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════════ map export ═══ */
/*
 * The export tab is a formula, not a snapshot, so it stays current as events change and never needs
 * refreshing to be right. `refreshMapExport` exists to put it *back* — after an edit overwrites it,
 * or on a rebuilt sheet — and to report whether what it computed is safe to import.
 *
 * It lives here rather than in `bootstrap/` because this is the copy that ships: a formula authored
 * only in the scaffolding project could not be repaired by a maintainer. Deliberately **one** copy.
 */

/**
 * Titled and upcoming, which is the whole of *does this publish?*
 *
 * `Upcoming?` already folds in "not cancelled" and "last day is today or later", so these two terms
 * are all of it — the map and the dashboard cannot disagree about what publishes.
 */
function mapExportPublishes_() {
  const scope = CONFIG.values.scope;
  return (
    `(${colRange_('events', 'title')}<>"")` +
    `*(${colRange_('events', 'upcoming')}=${quoteLiteral_(scope.upcoming)})`
  );
}

/**
 * Titled, upcoming, and placed somewhere.
 *
 * The venue term is the map's own: an event with no venue has no position, and its city is looked up
 * from the venue, so it has no city either. `refreshMapExport` names every event it leaves out.
 */
function mapExportCondition_() {
  return `${mapExportPublishes_()}*(${colRange_('events', 'venue')}<>"")`;
}

/**
 * What the formula builds, in order. `CONFIG.mapExport.headers` labels these and nothing else, so
 * the labels are free to change and their meaning is read from here — and the order is the import's:
 * `refreshMapExport` names the position column by looking `location` up in this list, so a stack
 * argument moved without this list moving with it points My Maps at a column it geocodes happily.
 */
function mapExportColumns_() {
  return ['venue', 'events', 'location', 'website'];
}

/**
 * The header labelling the column `key` builds, refused rather than guessed.
 *
 * A key this formula does not build is `indexOf` answering -1 and `headers[-1]` answering
 * `undefined`, which the import instructions would print as the name of the column to point My Maps
 * at — a sentence that can only be followed by guessing.
 */
function mapExportHeader_(key) {
  const columns = mapExportColumns_();
  const at = columns.indexOf(key);
  if (at < 0) {
    throw new Error(`The map export builds no "${key}" column; it builds ${columns.join(', ')}.`);
  }
  return CONFIG.mapExport.headers[at];
}

/**
 * Every column its own `FILTER`, and every lookup inside a `LAMBDA` where its argument is a single
 * value rather than an array.
 *
 * The tidy spelling — one `LET`, names holding arrays, `INDEX` to pick columns — reads far better
 * and does not work: on a live sheet it returns the right rows with `#VALUE!` in every looked-up
 * column. `XLOOKUP` over an array held in a `LET` name collapses and `MAP` then receives arguments
 * of different lengths, so exactly the columns the map needs are the ones that die. The dashboard
 * filter fails the same way. Do not "simplify" either of them back.
 *
 * `UNIQUE` over the resolved venue names is what makes a row a venue rather than an event: events
 * in one room share a point, and a map can draw one pin on it. They are lines in its popup instead.
 *
 * A value two places need is bound by an applied `LAMBDA` — `LAMBDA(x, …)(value)` — rather than
 * spelled twice, each spelling being another scan of a whole column for an answer that cannot
 * differ. A name holding one value is safe that way; a name holding an array is the collapse above.
 */
function mapExportFormula_() {
  const headers = CONFIG.mapExport.headers;
  const columns = mapExportColumns_();
  if (headers.length !== columns.length) {
    throw new Error(`CONFIG.mapExport.headers must name exactly the ${columns.length} columns this ` +
      `formula builds (${columns.join(', ')}); it has ${headers.length}. ` +
      'Change the labels freely — changing the count means changing this function.');
  }

  const cond = mapExportCondition_();
  // Every venue resolved to the venues tab's spelling *before* `UNIQUE` compares them. `UNIQUE`
  // compares text as typed where every other name comparison in this sheet folds case, so the raw
  // column puts `paradiso` and `Paradiso` on one coordinate as two pins listing the same events.
  // A name the venues tab does not hold keeps its typed spelling, which is what `Check data` names.
  const pins = `UNIQUE(MAP(FILTER(${colRange_('events', 'venue')}, ${cond}), ` +
    `LAMBDA(vv, IFERROR(XLOOKUP(vv, ${colLookup_('venues', 'name')}, ` +
    `${colLookup_('venues', 'name')}, vv), vv))))`;
  // One field of the venue `vv` names, read where `vv` is a single bound value. Every column walks
  // `pins` once and binds the fields it needs: a second `MAP` over `pins` is another pass over the
  // events column and an `XLOOKUP` per event of it, to save one venue lookup.
  const field = key => `IFERROR(XLOOKUP(vv, ${colLookup_('venues', 'name')}, ` +
    `${colLookup_('venues', key)}, ""), "")`;

  // The city is appended to the title because the layer list shows titles and nothing else.
  const suffix = quoteLiteral_(CONFIG.mapExport.titleSuffix);
  const venue = `MAP(${pins}, LAMBDA(vv, LAMBDA(cc, vv&IF(cc="", "", ${suffix}&cc))` +
    `(${field('city')})))`;

  // My Maps only linkifies a URL carrying a scheme, and a URL column tends to hold bare hosts, so
  // one is added unless there already is one.
  const website = `MAP(${pins}, LAMBDA(vv, LAMBDA(ss, IF(ss="", "", ` +
    `IF(LEFT(LOWER(ss),4)="http", ss, "https://"&ss)))(${field('url')})))`;

  // `vv` is a name the filtered `UNIQUE` produced, so `venue=vv` excludes a blank venue by itself
  // and the publish terms are the rest: a term that cannot change the answer is a column scanned
  // for every pin for nothing.
  const at = `${mapExportPublishes_()}*(${colRange_('events', 'venue')}=vv)`;

  // The events at one venue, oldest first, as one block: date to sort on, then the three fields a
  // line is made of. Sorting the columns separately would pair the title of one event with the
  // organiser of another whenever two share a date — a line that reads well and is false.
  const block = `SORT(FILTER(HSTACK(${colRange_('events', 'dateStart')}, ` +
    `${colRange_('events', 'when')}, ${colRange_('events', 'title')}, ` +
    `${colRange_('events', 'organiser')}), ${at}), 1, TRUE)`;

  // A line per event, separated by CRLF: a popup does not break on a bare `CHAR(10)`. The bullets
  // keep a run readable where the break itself is dropped, and a venue with one event gets none —
  // a bullet marks it off from nothing. Counted off the condition the lines themselves are filtered
  // by, so the mark and the list cannot disagree.
  const bullet = `IF(ROWS(FILTER(${colRange_('events', 'venue')}, ${at}))=1, "", "• ")`;
  const handle = `IFERROR(XLOOKUP(pp, ${colLookup_('organisers', 'name')}, ` +
    `${colLookup_('organisers', 'social')}, ""), "")`;
  const profile = quoteLiteral_(' — ' + CONFIG.social.profileBaseUrl);

  // `BYROW` walks the sorted block a row at a time, so `block` is spelled once rather than once per
  // field — each spelling is another `SORT(FILTER(HSTACK(…)))` over four open-ended columns, per
  // pin. The row arrives as an array, and the applied `LAMBDA` binding its fields to names is what
  // keeps the organiser a single value under `XLOOKUP`. `hh` holds the handle, which decides
  // whether a profile link is written and then supplies it.
  const line = `LAMBDA(ww, tt, pp, ww&" · "&tt&IF(pp="", "", " · "&pp&` +
    `LAMBDA(hh, IF(hh="", "", ${profile}&SUBSTITUTE(hh,"@","")))(${handle})))`;
  const perEvent = `LAMBDA(rr, ${line}(INDEX(rr,1,2), INDEX(rr,1,3), INDEX(rr,1,4)))`;
  // `bb` holds the mark, which the popup opens with and separates its lines by, and the count
  // behind it is a scan of the events column.
  const events = `MAP(${pins}, LAMBDA(vv, LAMBDA(bb, bb&` +
    `TEXTJOIN(CHAR(13)&CHAR(10)&bb, TRUE, BYROW(${block}, ${perEvent})))(${bullet})))`;

  // Address, postcode and city into one geocodable line, with the country appended here rather than
  // kept in a column. A venue with no address still maps — on the city centre, which is reported.
  const country = CONFIG.mapExport.countrySuffix
    ? '&' + quoteLiteral_(', ' + CONFIG.mapExport.countrySuffix)
    : '';
  const loc = `MAP(${pins}, LAMBDA(vv, LAMBDA(aa, pc, cc,` +
    `IF(aa="", vv&IF(cc="", "", ", "&cc)${country},` +
    `aa&", "&IF(pc="", "", pc&" ")&cc${country}))` +
    `(${field('address')}, ${field('postcode')}, ${field('city')})))`;

  // The guard is not decoration: with nothing upcoming, FILTER returns #N/A and the import source
  // would be an error rather than an empty tab.
  const scope = CONFIG.values.scope;
  const counted = `COUNTIFS(${colRange_('events', 'title')},"<>",` +
    `${colRange_('events', 'upcoming')},${quoteLiteral_(scope.upcoming)},` +
    `${colRange_('events', 'venue')},"<>")=0`;
  return `=IFERROR(IF(${counted}, "",` +
    `HSTACK(${venue}, ${events}, ${loc}, ${website})), "")`;
}

/**
 * Rewrites the export tab and proves it by what the cells computed, never by what was stored.
 *
 * `getFormula` returns whatever string went in, including a broken one, and a spilled formula fails
 * **per column**: a check that reads `A2` alone finds the title column computing perfectly and passes
 * a tab whose next two columns are `#VALUE!` on every row. Every column of every row is read.
 */
function refreshMapExport() {
  const ss = SpreadsheetApp.getActive();
  const name = CONFIG.tabs.mapExport;
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`No "${name}" tab in this spreadsheet.`);

  const headers = CONFIG.mapExport.headers;
  const separator = argSeparator_(ss);
  const lines = [];
  const say = line => lines.push(line);

  // Everything past the contract goes first. Row 1 is the one part a formula change does not clean
  // up after itself: spilled values vanish with their formula, a header does not, and a leftover
  // header with nothing under it is a field My Maps imports — an empty row in every popup.
  const width = headers.length;
  const stale = sheet.getMaxColumns() - width;
  if (stale > 0) {
    sheet.getRange(1, width + 1, sheet.getMaxRows(), stale).clearContent();
  }

  const palette = CONFIG.style.palette;
  sheet.getRange(1, 1, 1, width)
    .setValues([headers])
    .setBackground(palette.primary).setFontColor(palette.surface).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, width).clearContent();
  setFormula_(sheet.getRange('A2'), mapExportFormula_(), separator);
  SpreadsheetApp.flush();

  const rows = countFilled_(sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1));
  const block = rows ? sheet.getRange(2, 1, rows, width).getDisplayValues() : [];
  const broken = block.reduce((total, row) =>
    total + row.filter(value => String(value).startsWith('#')).length, 0);

  const events = table_('events');
  const venues = table_('venues');
  const scope = CONFIG.values.scope;
  const publishes = row => events.get(row, 'title') && events.get(row, 'upcoming') === scope.upcoming;
  const placed = events.rows.filter(row => publishes(row) && events.text(row, 'venue'));

  // The pin a name gets, resolved as the formula resolves it. `XLOOKUP` answers with the venues
  // tab's own spelling and folds case doing it, so every case of a listed venue is one pin; a name
  // the tab does not hold keeps the one that was typed, which `UNIQUE` then compares as typed. A
  // count that folds further refuses a tab holding what the formula built.
  const listed = new Map();
  venues.rows.forEach(row => {
    const name = venues.get(row, 'name');
    const key = String(name).toLowerCase();
    // First match wins, as `XLOOKUP` takes the first row it matches.
    if (name && !listed.has(key)) listed.set(key, String(name));
  });
  const pinOf = value => listed.get(String(value).toLowerCase()) || String(value);
  const pinned = new Set(placed.map(row => pinOf(events.get(row, 'venue'))));
  const expected = pinned.size;
  const unplaced = events.rows
    .filter(row => publishes(row) && !events.text(row, 'venue'))
    .map(row => ({ title: String(events.get(row, 'title')), status: events.get(row, 'status') }));
  const concept = CONFIG.values.eventStatus.concept;
  const announced = unplaced.filter(row => row.status === concept).map(row => row.title);
  const roomless = unplaced.filter(row => row.status !== concept).map(row => row.title);

  say(`${name} rebuilt: ${rows} row(s), ${expected} expected, ${broken} error cell(s)` +
      (rows === expected && !broken ? ' ✓' : ' ⚠'));
  // Why the row count is not the event count: seven rows against twelve upcoming events otherwise
  // reads as five lost. With none placed there is no count to explain, and the lists below say why.
  if (placed.length) {
    say(`One pin per venue: ${placed.length} upcoming event(s) at ${expected} venue(s), each a ` +
        'line in its venue\'s popup.');
  }
  say(`Columns: ${headers.join(' | ')}`);
  if (stale > 0) {
    say(`Cleared ${stale} column(s) past the contract, headers included.`);
  }
  if (broken || rows !== expected) {
    say('');
    say('DO NOT IMPORT this tab — the map would take the errors as place names.');
  }
  // Two lists, because they mean opposite things: a concept event is allowed to have no venue, so
  // naming it as a gap every refresh is how a report stops being read, while a confirmed one with no
  // venue is a real hole in the sheet.
  if (announced.length) {
    say(`${concept}, venue still to be announced: ${announced.join(' · ')}`);
    say(`Expected, not a gap. They stay in ${CONFIG.tabs.events} and the document lists them as`);
    say(`"${CONFIG.doc.venueTba}" — a pin cannot say that, which is why they are not on the map.`);
  }
  if (roomless.length) {
    say(`⚠ ${CONFIG.values.eventStatus.confirmed} with no venue, so left off the map: ` +
        roomless.join(' · '));
    say('Check data names these too: give them a venue, or set them back to ' + concept + '.');
  }

  // A pin that lands on a city centre rather than on the venue, named rather than left to the import
  // report nobody re-reads. Only the venues that got a pin: an addressless one with nothing booked
  // in it is Check data's business.
  const approximate = venues.rows
    .filter(row => venues.get(row, 'name') && !venues.get(row, 'address'))
    .filter(row => pinned.has(pinOf(venues.get(row, 'name'))))
    .map(row => venues.text(row, 'name'));
  if (approximate.length) {
    say(`Geocoding by venue name, so the pin lands on the city centre: ${approximate.join(' · ')}`);
  }

  say('');
  say('The tab is live — it recomputes by itself. The map does not:');
  say(`re-import it (layer menu → delete, then Add layer → Import), position column`);
  say(`"${mapExportHeader_('location')}", title column "${mapExportHeader_('venue')}".`);
  say('');
  say('Deleting the layer is not optional, and a re-import is not enough: My Maps keeps a layer\'s');
  say('own field list and only ever appends to it, so a column that has gone from this tab stays in');
  say('the popup as an empty row until the layer itself is replaced.');
  notify_(lines.join('\n'));
}


/* ═════════════════════════════════════════════════════════════════ formulas, in the dialect ═══ */

/**
 * The sheet's argument separator, detected against the live file and cached.
 *
 * `setFormula` does not translate separators: in a sheet whose locale wants `;` a comma-separated
 * formula is stored verbatim and then evaluates to `#ERROR!` — and *storing* it succeeds, so nothing
 * raises. Detected rather than assumed, because the locale deciding it is a setting any maintainer
 * can change, and cached per locale so the probe runs about once.
 */
function argSeparator_(ss) {
  const properties = PropertiesService.getScriptProperties();
  const key = 'ARG_SEPARATOR:' + ss.getSpreadsheetLocale();
  const cached = properties.getProperty(key);
  if (cached) return cached;

  const name = '_separator_probe';
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  const probe = ss.insertSheet(name);
  try {
    probe.getRange('A1').setFormula('=IF(1=1,"ok","")');
    SpreadsheetApp.flush();
    const separator = probe.getRange('A1').getDisplayValue() === 'ok' ? ',' : ';';
    properties.setProperty(key, separator);
    return separator;
  } finally {
    const leftover = ss.getSheetByName(name);
    if (leftover) ss.deleteSheet(leftover);
  }
}

/** Separators outside string literals only, so a comma inside `", Netherlands"` survives intact. */
function localizeFormula_(formula, separator) {
  if (separator === ',') return formula;
  let out = '';
  let inString = false;
  for (const character of formula) {
    if (character === '"') inString = !inString;
    out += (character === ',' && !inString) ? separator : character;
  }
  return out;
}

/** setFormula, but in the dialect the sheet actually parses. */
function setFormula_(range, formula, separator) {
  range.setFormula(localizeFormula_(formula, separator));
}

/**
 * A value as a formula string literal: wrapped in quotes, with any quote inside it doubled.
 *
 * Sheets escapes a quote by doubling it. Interpolating a config value raw closes the string early: a
 * `dateTba` reading `date "to be announced"` lands in the `When` column as
 * `IF(A2="","date "to be announced"",…)`, four quotes that pair up wrongly. The offline check cannot
 * see it either, because doubling a quote leaves the *count* even. It surfaces in the cell, as a
 * parse error or as a formula that quietly parses into something else.
 *
 * **Every `Config.gs` value that reaches a formula goes through here** — the statuses, the scope
 * words, the day and month names, the unknown-venue marker, the map's title and country suffixes,
 * the social profile URL. All of them are typed by a person, so drawing a line between "a phrase" and
 * "a label" only decides which half breaks silently. What stays spelled inline is the vocabulary the
 * code itself owns and no setting can reach: the `"no matches"` the dashboard tests for, and
 * operators like `"<>"`.
 */
function quoteLiteral_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

/**
 * Non-empty cells in a column. `getLastRow()` is no use on a tab fed by a spilled formula: it returns
 * `""` for every empty row, and an empty string is a value, so the sheet reports a thousand rows.
 */
function countFilled_(range) {
  return range.getValues().filter(row => row[0] !== '' && row[0] !== null).length;
}


/* ═════════════════════════════════════════════════════════════════════ the agenda document ═══ */
/*
 * One fixed document, cleared and rebuilt on every run, listing every upcoming event oldest first —
 * no window, no "+ N more". One id means one stable URL, so a link in a bio or a newsletter never has
 * to change.
 *
 * The consequence of rebuilding it: **nothing may be typed into the document by hand.** The next run
 * clears it. Wording belongs in `Config.gs`, content in the sheet.
 *
 * The weekly trigger is not a luxury: an upcoming-only listing is correct only as of its last run,
 * so an event that finished on Sunday leaves the document when the script next runs.
 */

/**
 * A file id from Script Properties, with a readable failure when it is not set.
 *
 * Ids are not in `Config.gs` on purpose: one person's Drive is not configuration, and keeping it out
 * lets this repo be public without a scrubbing pass. `onOpen` offers a menu item as soon as its
 * function exists, so this stands between an unconfigured project and a maintainer reading
 * `Invalid argument: id`.
 */
function requireId_(propertyKey) {
  const value = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!value) {
    throw new Error(`Script property ${propertyKey} is not set.\n\n` +
      'Run setupDocument in the bootstrap project — it creates the document and the archive folder ' +
      'and prints their ids — then add them here: Extensions → Apps Script → Project Settings → ' +
      'Script Properties.');
  }
  return value;
}

/** The same, for the ids that are genuinely optional. Returns '' rather than throwing. */
function optionalId_(propertyKey) {
  return PropertiesService.getScriptProperties().getProperty(propertyKey) || '';
}

/**
 * The published map's address, composed from the id in Script Properties. No id returns ''.
 *
 * The property holds the `mid` alone, so `CONFIG.mapViewBaseUrl` fixes the one shape a reader can be
 * handed; escaping it turns a pasted URL into a visibly broken link rather than a working `/edit` one.
 * Trimming is what makes a blank-looking value no id at all, rather than a live link to nothing.
 */
function mapUrl_() {
  const mapId = optionalId_(CONFIG.properties.mapId).trim();
  return mapId ? CONFIG.mapViewBaseUrl + encodeURIComponent(mapId) : '';
}

/** Rebuilds the read-only document: every upcoming event, oldest first. */
function generateEventsDoc() {
  const events = upcomingEvents_();
  const docId = requireId_(CONFIG.properties.eventsDocId);
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const margin = CONFIG.doc.marginPt;

  body.clear();
  body.setMarginTop(margin).setMarginBottom(margin)
    .setMarginLeft(margin).setMarginRight(margin);

  titleBlock_(body, events);

  let month = '';
  let table = null;
  events.forEach(event => {
    const label = Utilities.formatDate(event.start, CONFIG.timeZone, 'MMMM yyyy');
    if (label !== month) {
      month = label;
      monthHeading_(body, label);
      table = body.appendTable([['', '']]);
      table.setBorderWidth(0);
      eventRow_(table.getRow(0), event);
    } else {
      eventRow_(table.appendTableRow(), event);
    }
  });

  if (CONFIG.doc.outro) {
    const outro = body.appendParagraph(CONFIG.doc.outro);
    outro.editAsText().setFontFamily(CONFIG.style.font).setFontSize(10).setItalic(true)
      .setForegroundColor(CONFIG.style.palette.muted);
    outro.setSpacingBefore(18);
  }

  // body.clear() leaves one empty paragraph behind; drop it so the logo sits at the top
  const first = body.getChild(0);
  if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === '') {
    body.removeChild(first);
  }

  ensureFooter_(doc);
  doc.saveAndClose();

  // Sharing is a property of the file, not of the content, so `'anyoneWithLink'` is re-asserted on
  // every run — and a change made by hand does not survive one. Under `'leave'` the code never reads
  // or writes the file's access, and whatever you set in Drive stands. See CONFIG.doc.sharing.
  if (CONFIG.doc.sharing === 'anyoneWithLink') {
    DriveApp.getFileById(docId)
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  notify_(docReport_(events, docId));
}

/**
 * What the run published, in the terms it can be checked in: the document holds every upcoming event
 * and no others.
 *
 * Counted from the same `Upcoming?` column the dashboard and the map read, so the three cannot
 * quietly disagree and the one number a human would otherwise look up arrives in the same dialog as
 * the answer.
 */
function docReport_(events, docId) {
  const sheet = table_('events');
  const upcoming = sheet.rows
    .filter(row => sheet.get(row, 'upcoming') === CONFIG.values.scope.upcoming).length;
  const tz = CONFIG.timeZone;

  const lines = [`Document rebuilt: ${events.length} upcoming event(s), oldest first.`];
  lines.push(`${CONFIG.tabs.events} says ${CONFIG.values.scope.upcoming}: ${upcoming}` +
    (upcoming === events.length
      ? ' — the same number, which is the check ✓'
      : ' ⚠ THE TWO MUST MATCH. A row that reads upcoming but has no real date in ' +
        `${headers_('events')[columnIndex_('events', 'dateStart')]} is the usual cause: ` +
        'the column goes by the date, this listing needs one to sort by.'));

  if (events.length) {
    lines.push(`Range: ${Utilities.formatDate(events[0].start, tz, 'd MMMM yyyy')} – ` +
      `${Utilities.formatDate(events[events.length - 1].start, tz, 'd MMMM yyyy')}`);
  }

  // Named rather than left to be noticed: an event in here and on no map is the first question a
  // reader of both asks.
  const tba = events.filter(event => !event.venue).map(event => event.title);
  if (tba.length) {
    lines.push('');
    lines.push(`Listed as "${CONFIG.doc.venueTba}": ${tba.join(' · ')}`);
    lines.push('A concept event may have no venue yet. It is in here and on no map — a pin cannot say');
    lines.push(`that. ${CONFIG.tabs.mapExport} holds a row per venue in any case, not per event.`);
  }

  const linked = events.filter(event => event.handle).length;
  lines.push('');
  lines.push(`${CONFIG.social.label} links: ${linked} of ${events.length} (the rest have no handle ` +
    `in ${CONFIG.tabs.organisers} yet, and the line is simply omitted).`);
  lines.push('');
  lines.push(CONFIG.doc.sharing === 'anyoneWithLink'
    ? 'Sharing: re-asserted as anyone with the link, view only (CONFIG.doc.sharing).'
    : 'Sharing: left exactly as you set it in Drive (CONFIG.doc.sharing is "leave").');
  lines.push(`Read it:  https://docs.google.com/document/d/${docId}/preview`);
  lines.push(`As a PDF: https://docs.google.com/document/d/${docId}/export?format=pdf`);
  return lines.join('\n');
}

/**
 * All upcoming, non-cancelled events, oldest first — the whole listing, with no window applied.
 *
 * Read **by column key** through `table_()`, never by position: `row[0]`…`row[9]` breaks silently —
 * drop a column from a lookup tab and every index after it slides one over while the code goes on
 * answering. The shape that takes here is an agenda listing the private note column instead of the
 * title, and a private column is the one thing no output may ever read.
 *
 * `Upcoming?` already folds in *titled*, *dated*, *not cancelled* and *last day today or later*, so
 * filtering on it is the whole of "does this publish?". The guards after it earn their place: this
 * function sorts by `start` and formats it, so a row that cannot be sorted must drop out here rather
 * than throw halfway through a rebuild.
 */
function upcomingEvents_() {
  const events = table_('events');
  const organisers = table_('organisers');

  // The map export resolves the same handle with `XLOOKUP`, so an event naming its organiser in
  // another case has to reach it here too, or the document drops a link the pin still carries. A
  // `Map` rather than an object: `handles["constructor"]` would otherwise answer from
  // `Object.prototype`, and the source of a function renders as a handle.
  const handles = new Map();
  organisers.rows.forEach(row => {
    const name = organisers.text(row, 'name');
    if (name) handles.set(lookupKey_(name), organisers.get(row, 'social'));
  });

  // The cutoff has to be the *sheet's* today. `Upcoming?` compares against `TODAY()`, which follows
  // the spreadsheet's time zone, while a bare `new Date()` follows the script project's — two
  // separate settings, and `clasp push` reconciles neither: the server keeps the project's own value
  // and ignores the manifest. Left as local date arithmetic, an event that ended yesterday in
  // Amsterdam is still "today" to a project sitting on a US zone, and goes out in the published
  // agenda while the sheet correctly calls it Past. Both sides rendered `yyyyMMdd` in the
  // spreadsheet's zone is the same calendar-day comparison the column makes.
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dayStamp = date => Utilities.formatDate(date, zone, 'yyyyMMdd');
  const today = dayStamp(new Date());

  return events.rows
    .filter(row => events.get(row, 'upcoming') === CONFIG.values.scope.upcoming)
    .filter(row => events.get(row, 'title'))
    .map(row => {
      const start = events.get(row, 'dateStart');
      const end = events.get(row, 'dateEnd');
      const organiser = events.text(row, 'organiser');
      return {
        start: start,
        end: end instanceof Date ? end : start,
        title: String(events.get(row, 'title')),
        venue: events.text(row, 'venue'),
        organiser: organiser,
        city: events.text(row, 'city'),
        when: events.text(row, 'when'),
        // A stray `@` is stripped in every output rather than corrected in the sheet, where the
        // hygiene checks flag it and a person fixes it.
        handle: String(handles.get(lookupKey_(organiser)) || '').trim().replace(/^@+/, ''),
      };
    })
    // `start instanceof Date` first, and not only to drop unsortable rows: it is what guarantees
    // `end` is a Date by the time `dayStamp` sees it, since `end` falls back to `start` above.
    .filter(event => event.start instanceof Date && dayStamp(event.end) >= today)
    .sort((a, b) => a.start - b.start);
}

function titleBlock_(body, events) {
  const font = CONFIG.style.font;
  const palette = CONFIG.style.palette;
  const tz = CONFIG.timeZone;

  // A missing or unreadable logo must never block the listing. It is read fresh from Drive on every
  // run, which is also why the file has to travel along if the sheet ever changes hands.
  const logoId = optionalId_(CONFIG.properties.logoFileId);
  if (logoId) {
    try {
      const logo = body.appendImage(DriveApp.getFileById(logoId).getBlob());
      logo.setWidth(CONFIG.doc.logo.widthPt).setHeight(CONFIG.doc.logo.heightPt);
    } catch (err) {
      console.log('logo skipped: ' + err.message);
    }
  }

  const title = body.appendParagraph(CONFIG.doc.title);
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.editAsText().setFontFamily(font).setBold(true).setForegroundColor(palette.primary);

  const subtitle = body.appendParagraph(`${CONFIG.brand.name} — ${CONFIG.brand.tagline}`);
  subtitle.editAsText().setFontFamily(font).setFontSize(11).setItalic(true)
    .setForegroundColor(palette.secondary);
  subtitle.setSpacingAfter(2);

  // Only the empty listing gets a line of its own here: a document with events shows its own dates
  // row by row, while an empty one would otherwise be a heading followed by nothing.
  if (!events.length) {
    const empty = body.appendParagraph(CONFIG.doc.noEvents);
    empty.editAsText().setFontFamily(font).setFontSize(11).setBold(true)
      .setForegroundColor(palette.primaryDark);
    empty.setSpacingAfter(2);
  }

  const stamp = Utilities.formatDate(new Date(), tz, 'd MMMM yyyy');
  const mapUrl = mapUrl_();
  const meta = body.appendParagraph(`${events.length} events · updated ${stamp}` +
    (mapUrl ? ` · ${mapUrl}` : ''));
  meta.editAsText().setFontFamily(font).setFontSize(10).setForegroundColor(palette.muted);
  meta.setSpacingAfter(10);

  rule_(body, palette.primary, 3);
}

function monthHeading_(body, label) {
  const heading = body.appendParagraph(label.toUpperCase());
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  heading.editAsText().setFontFamily(CONFIG.style.font).setFontSize(13).setBold(true)
    .setForegroundColor(CONFIG.style.palette.primary);
  heading.setSpacingBefore(16).setSpacingAfter(4);
  rule_(body, CONFIG.style.palette.accent, 1);
}

function eventRow_(row, event) {
  const font = CONFIG.style.font;
  const palette = CONFIG.style.palette;
  while (row.getNumCells() < 2) row.appendTableCell('');

  const when = row.getCell(0);
  when.setWidth(105).setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(0);
  const whenParagraph = when.getChild(0).asParagraph();
  // `When` is the sheet's own string, so the document, the dashboard and the map popup all spell a
  // date the same way. The fallback is for a row whose formula column has been overwritten.
  whenParagraph.setText(event.when ||
    Utilities.formatDate(event.start, CONFIG.timeZone, 'd MMM yyyy'));
  whenParagraph.editAsText().setFontFamily(font).setFontSize(10).setBold(true)
    .setForegroundColor(palette.primaryDark);

  const cell = row.getCell(1);
  cell.setPaddingTop(6).setPaddingBottom(6);

  const head = cell.getChild(0).asParagraph();
  head.setText(event.title);
  head.editAsText().setFontFamily(font).setFontSize(12).setBold(true)
    .setForegroundColor(palette.ink);

  // A concept event is allowed to have no venue and still belongs in the agenda. The document is the
  // one output that can say so; a pin cannot, which is why the map export leaves the row out. The
  // wording is a config value, never the private note column, which no output may touch.
  const place = event.venue
    ? event.venue + (event.city ? ', ' + event.city : '')
    : CONFIG.doc.venueTba;
  line_(cell, place, { size: 10, color: palette.muted, italic: !event.venue });

  // No organiser line at all rather than an empty one: an empty paragraph is a visible gap in a
  // listing this tight, which is also why the handle is appended to this line instead of getting its
  // own. A handle with no name cannot happen — it is looked up *by* that name.
  if (event.organiser) {
    const paragraph = line_(cell, event.organiser, { size: 10, color: palette.muted });
    if (event.handle) {
      // `+ 3` steps over the ` · ` separator so the link starts at the `@`; the offset taken raw
      // would underline and recolour the separator too, reading as though the punctuation between
      // the name and the handle were part of the link.
      const from = paragraph.getText().length + 3;
      paragraph.appendText(' · @' + event.handle);
      const to = paragraph.getText().length - 1;
      paragraph.editAsText()
        .setLinkUrl(from, to, CONFIG.social.profileBaseUrl + event.handle)
        .setForegroundColor(from, to, palette.link);
    }
  }
}

function line_(cell, text, options) {
  const paragraph = cell.appendParagraph(text);
  paragraph.setSpacingBefore(0).setSpacingAfter(0);
  const styled = paragraph.editAsText();
  styled.setFontFamily(CONFIG.style.font).setFontSize(options.size || 10)
    .setForegroundColor(options.color || CONFIG.style.palette.ink);
  if (options.bold) styled.setBold(true);
  if (options.italic) styled.setItalic(true);
  return paragraph;
}

/** Docs has no styleable horizontal rule, so a 1×1 borderless table stands in as a coloured bar. */
function rule_(body, color, thickness) {
  const table = body.appendTable([['']]);
  table.setBorderWidth(0);
  const cell = table.getRow(0).getCell(0);
  cell.setBackgroundColor(color)
    .setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  cell.getChild(0).asParagraph().editAsText().setFontSize(thickness);
}

/**
 * Writes the footer only if there is none, so hand-added page numbers survive.
 *
 * That early return is also an ordering rule for the installer: Apps Script has no page-number
 * element, so Docs has to insert it, and only **after** the first run — otherwise the footer already
 * exists, this returns, and the credit line is never written. The credit is not decoration: download
 * and *Make a copy* stay on, so the footer carries the name onto a print-out that has left the
 * building.
 */
function ensureFooter_(doc) {
  if (doc.getFooter()) return;
  const mapUrl = mapUrl_();
  const paragraph = doc.addFooter().appendParagraph(
    CONFIG.brand.name + (mapUrl ? ' · ' + mapUrl : ''));
  paragraph.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  paragraph.editAsText().setFontFamily(CONFIG.style.font).setFontSize(8)
    .setForegroundColor(CONFIG.style.palette.muted);
}

/**
 * One weekly trigger, owned by whoever installs it.
 *
 * Deleting first is what makes it exactly one: triggers are per account and stack silently, so
 * running this twice would otherwise mean two rebuilds every week.
 *
 * **Anyone with Editor can press this, deliberately.** Who may run what in a shared file is the
 * owner's decision through the sharing list, not the script's — and a bound project is part of the
 * file anyway, so Editor on the sheet already *is* Editor on the script.
 *
 * The consequence is stated rather than guarded: a trigger belongs to whoever installed it, and
 * `getProjectTriggers()` returns only *your own*, so a second one is invisible to everyone else. Not
 * destructive — the rebuild is idempotent — but it means two rebuilds a week and a failure notice
 * going to that account if its access later changes. The report names the account it installed
 * under, which is all that can be checked from in here.
 */
function installWeeklyRefresh() {
  // Nothing weekly is worth scheduling for a function that cannot run: an unset document id would
  // fail every week at the same hour, and send a failure notice every week with it.
  requireId_(CONFIG.properties.eventsDocId);

  const me = Session.getEffectiveUser().getEmail();
  const day = CONFIG.weeklyRefresh.weekDay;
  const hour = CONFIG.weeklyRefresh.hour;
  const weekDay = ScriptApp.WeekDay[day];
  if (!weekDay) throw new Error(`CONFIG.weeklyRefresh.weekDay is "${day}" — use MONDAY … SUNDAY.`);

  const existing = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'generateEventsDoc');
  existing.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('generateEventsDoc').timeBased()
    .onWeekDay(weekDay).atHour(hour).inTimezone(CONFIG.timeZone).create();

  notify_(`Weekly refresh installed: ${day} ${String(hour).padStart(2, '0')}:00 ` +
    `${CONFIG.timeZone}.\n\n` +
    (existing.length
      ? `${existing.length} earlier trigger(s) for generateEventsDoc removed first, so there is `
      : 'There is now ') +
    `exactly one, owned by ${me || 'this account'}.\n\n` +
    'A trigger belongs to whoever installed it, does not travel with the file, and nobody can see ' +
    'anyone else\'s — so a second one installed from another account means two rebuilds a week that ' +
    'nobody else can find, and failure notices going only to that account. Which account should own ' +
    'it is for you to decide; this is only what it does.');
}

/**
 * Optional: a dated PDF in an archive folder. Nothing depends on it — a reader takes their own PDF
 * from the document — but it lets you see what was published in a given week.
 */
function saveEventsPdf() {
  const stamp = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');
  const pdf = DriveApp.getFileById(requireId_(CONFIG.properties.eventsDocId)).getAs(MimeType.PDF);
  const file = DriveApp.getFolderById(requireId_(CONFIG.properties.pdfFolderId))
    .createFile(pdf).setName(`${CONFIG.doc.pdfNamePrefix} ${stamp}.pdf`);
  notify_(`Saved: ${file.getName()}\n\n${file.getUrl()}`);
}

/**
 * Prints what this project is configured with — run it from the IDE after setting the properties.
 *
 * Reports the ids it holds rather than trusting them: an id that no longer resolves is the failure
 * that otherwise only shows up as a broken weekly run.
 */
function showConfiguration() {
  const properties = PropertiesService.getScriptProperties();
  const lines = ['=== configuration ==='];
  lines.push(`Brand: ${CONFIG.brand.name} · menu "${CONFIG.brand.menu}" · zone ${CONFIG.timeZone}`);
  lines.push(`Map URL: ${mapUrl_() || '(no map id — the document omits the line)'}`);
  lines.push(`Document sharing: ${CONFIG.doc.sharing === 'anyoneWithLink'
    ? 'every rebuild re-asserts anyone-with-the-link, view only'
    : 'never touched by this code — whatever you set in Drive stands'}`);

  // Every other property holds a Drive id, reported by what it resolves to. My Maps has no API, so
  // the map id is not resolvable from here.
  Object.keys(CONFIG.properties).filter(key => key !== 'mapId').forEach(key => {
    const name = CONFIG.properties[key];
    const value = properties.getProperty(name);
    if (!value) { lines.push(`${name}: (not set)`); return; }
    let resolves;
    try {
      resolves = DriveApp.getFileById(value).getName();
    } catch (err) {
      try {
        resolves = DriveApp.getFolderById(value).getName() + ' (folder)';
      } catch (folderErr) {
        resolves = '⚠ does not resolve from this account';
      }
    }
    lines.push(`${name}: ${value} → ${resolves}`);
  });

  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'generateEventsDoc');
  lines.push(`Weekly triggers owned by this account: ${triggers.length}` +
    (triggers.length === 1 ? ' ✓' : triggers.length ? ' ⚠ more than one' : ''));

  const report = lines.join('\n');
  notify_(report);
  return report;
}
