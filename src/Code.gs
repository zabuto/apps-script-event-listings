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


/* ══════════════════════════════════════════════════════════════════════════ what publishes ═══ */

/**
 * All upcoming, non-cancelled events, oldest first — the whole listing, with no window applied.
 *
 * Read by both outputs that leave the sheet; the map narrows it to events with a venue and spreads
 * each over its dates. **By column key** through `table_()`, never by position: a dropped column
 * slides every index after it, and an agenda lists the private note instead of the title.
 *
 * `Upcoming?` is the whole of "does this publish?". The guards after it drop a row that cannot be
 * sorted rather than throwing mid-rebuild.
 */
function upcomingEvents_() {
  const events = table_('events');
  const organisers = table_('organisers');

  // Folded, because the map resolves the same handle the same way: an event naming its organiser in
  // another case must reach it here too. A `Map` rather than an object, or
  // `handles["constructor"]` answers from `Object.prototype` and a function renders as a handle.
  const handles = new Map();
  organisers.rows.forEach(row => {
    const name = organisers.text(row, 'name');
    if (name) handles.set(lookupKey_(name), organisers.get(row, 'social'));
  });

  // The cutoff has to be the *sheet's* today: `Upcoming?` compares against `TODAY()` in the
  // spreadsheet's zone, while a bare `new Date()` follows the script project's, and `clasp push`
  // reconciles neither. Both sides rendered `yyyyMMdd` in the spreadsheet's zone is the same
  // calendar-day comparison the column makes.
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
        // The map reads it to tell the two kinds of venue-less event apart: a concept event has no
        // room yet, a confirmed one is a hole in the sheet.
        status: events.get(row, 'status'),
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


/* ═══════════════════════════════════════════════════════════════════════════════ map export ═══ */
/*
 * One row per **date**: a three-day run is three rows, each named for its day. Their pins share one
 * coordinate, and the layer panel tells them apart, so the date leads the name.
 *
 * Values, not a formula: a row per date needs the spellings that collapse here (`docs/gotchas.md`).
 */

/**
 * A calendar day as one number, which is what a run is stepped through in.
 *
 * Days rather than milliseconds: the day a clock change falls on is 23 or 25 hours long, so adding
 * 24 hours to midnight lands on the evening before. `Date.UTC` has no such day.
 */
function dayNumber_(year, month, day) {
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/**
 * The calendar day a date cell holds, as the **spreadsheet's** zone sees it.
 *
 * A date-only cell is midnight in that zone, and the script project's zone is a second setting
 * `clasp push` does not reconcile. Read a few hours west, it is the evening before.
 */
function dayOf_(date, zone) {
  const iso = Utilities.formatDate(date, zone, 'yyyy-MM-dd').split('-');
  return dayNumber_(Number(iso[0]), Number(iso[1]), Number(iso[2]));
}

/** The parts of a day number, the weekday among them, numbered from Sunday as `dayNames` is. */
function dayParts_(number) {
  const at = new Date(number * 86400000);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    weekDay: at.getUTCDay(),
  };
}

/**
 * A date as `CONFIG.mapExport.titleDateFormat` spells it, in the configured day and month names.
 *
 * Not `Utilities.formatDate`: it reads `mm` as the minutes, and takes its month names from the
 * script project's locale. A token this cannot spell raises rather than naming a pin after it.
 */
function mapDateText_(parts) {
  const format = CONFIG.mapExport.titleDateFormat;
  const pad = (value, width) => String(value).padStart(width, '0');
  const spell = {
    d: () => String(parts.day),
    dd: () => pad(parts.day, 2),
    ddd: () => CONFIG.values.dayNames[parts.weekDay],
    m: () => String(parts.month),
    mm: () => pad(parts.month, 2),
    mmm: () => CONFIG.values.monthNames[parts.month - 1],
    // `y` is the sheet's own spelling of a two-digit year, and means what `yy` means.
    y: () => pad(parts.year % 100, 2),
    yy: () => pad(parts.year % 100, 2),
    yyyy: () => pad(parts.year, 4),
  };
  return String(format).replace(/[A-Za-z]+/g, run => {
    const spelling = spell[run.toLowerCase()];
    if (!spelling) {
      throw new Error(`CONFIG.mapExport.titleDateFormat is "${format}", and a map pin cannot be ` +
        `named from "${run}": the tokens built here are d, dd, ddd, m, mm, mmm, y, yy and yyyy. ` +
        'day and month names come from CONFIG.values.dayNames and monthNames, which hold short ' +
        'names.');
    }
    return spelling();
  });
}

/**
 * The `When` one pin carries: its own date in full, and which day of a run it is.
 *
 * The events tab's `When` is a span — `13 Feb – 15 Feb 2027` — which every pin of the run would
 * repeat while its name says one date.
 */
function mapWhenText_(parts, ordinal, days) {
  const date = `${CONFIG.values.dayNames[parts.weekDay]} ${parts.day} ` +
    `${CONFIG.values.monthNames[parts.month - 1]} ${parts.year}`;
  if (days < 2 || !CONFIG.mapExport.runDay) return date;
  return date + String(CONFIG.mapExport.runDay)
    .replace('{day}', String(ordinal)).replace('{days}', String(days));
}

/**
 * Every row the export tab should hold, and everything the refresh has to say about them.
 *
 * Built on `upcomingEvents_`, less the two things a pin cannot do: an event with no venue has no
 * position, and a date that is over is one nobody can turn up on.
 */
function mapExportRows_() {
  const headers = CONFIG.mapExport.headers;
  if (headers.length !== 5) {
    throw new Error('CONFIG.mapExport.headers must name exactly the five columns this builds ' +
      `(title, when, venue, organiser, location); it has ${headers.length}. ` +
      'Change the labels freely — changing the count means changing this function.');
  }
  const maxDays = CONFIG.mapExport.maxDays;
  // A cap below one empties the map without failing: every event is then cut to no dates at all.
  if (!(maxDays >= 1)) {
    throw new Error(`CONFIG.mapExport.maxDays is ${maxDays} — an event occupies at least one date, ` +
      'so a cap under 1 is an export with nothing in it.');
  }

  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const venues = table_('venues');

  // Keyed by the folded name, as every name lookup in the sheet is: an event naming
  // `de nieuwe anita` reaches the venue listed as `De Nieuwe Anita`, which is how the `City` column
  // resolved it too.
  const details = new Map();
  venues.rows.forEach(row => {
    const name = venues.text(row, 'name');
    if (!name) return;
    details.set(lookupKey_(name), {
      address: venues.text(row, 'address'),
      postcode: venues.text(row, 'postcode'),
      url: venues.text(row, 'url'),
    });
  });

  const join = CONFIG.mapExport.titleJoin;
  const country = CONFIG.mapExport.countrySuffix ? ', ' + CONFIG.mapExport.countrySuffix : '';
  const concept = CONFIG.values.eventStatus.concept;
  const today = dayOf_(new Date(), zone);

  const built = [];
  const announced = [];
  const roomless = [];
  const capped = [];
  const approximate = [];
  let placed = 0;
  let past = 0;

  upcomingEvents_().forEach(event => {
    // Two lists, because they mean opposite things: a concept event is allowed to have no venue, so
    // naming it as a gap on every refresh is how a report stops being read, while a confirmed one
    // with no venue is a real hole in the sheet.
    if (!event.venue) {
      (event.status === concept ? announced : roomless).push(event.title);
      return;
    }
    const venue = details.get(lookupKey_(event.venue)) || { address: '', postcode: '', url: '' };

    // Address, postcode and city in one geocodable line, with the country appended here rather than
    // kept in a column. A venue with no address still maps — onto the city centre, which is reported.
    const location = venue.address
      ? `${venue.address}, ${venue.postcode ? venue.postcode + ' ' : ''}${event.city}${country}`
      : `${event.venue}, ${event.city}${country}`;
    if (!venue.address) approximate.push(event.title);

    // Venue with its own site, organiser with their handle: one fact per row, and no labelled blank
    // for the ones that have neither. A URL column tends to hold bare hosts, and My Maps only
    // linkifies one carrying a scheme, so it is added here unless there already is one.
    const site = venue.url
      ? ' — ' + (/^https?:\/\//i.test(venue.url) ? venue.url : 'https://' + venue.url)
      : '';
    const organiser = event.organiser +
      (event.handle ? ' — ' + CONFIG.social.profileBaseUrl + event.handle : '');

    const first = dayOf_(event.start, zone);
    const days = Math.max(dayOf_(event.end, zone) - first + 1, 1);
    if (days > maxDays) capped.push(`${event.title} (${days} dates)`);

    for (let ordinal = 1; ordinal <= Math.min(days, maxDays); ordinal++) {
      const number = first + ordinal - 1;
      // A run under way keeps the dates it has left and loses the ones that are over: a pin a reader
      // has to work out is past is worse than no pin.
      if (number < today) {
        past++;
        continue;
      }
      const parts = dayParts_(number);
      built.push({
        day: number,
        row: [
          mapDateText_(parts) + join + event.title,
          mapWhenText_(parts, ordinal, days),
          event.venue + site,
          organiser,
          location,
        ],
      });
    }
    placed++;
  });

  // By date, so the layer panel lists the names in the order the dates come. The name settles a tie,
  // which is what makes a rebuild of unchanged data identical.
  built.sort((a, b) => a.day - b.day ||
    (a.row[0] < b.row[0] ? -1 : a.row[0] > b.row[0] ? 1 : 0));

  return {
    rows: built.map(entry => entry.row),
    placed: placed,
    announced: announced,
    roomless: roomless,
    capped: capped,
    approximate: approximate,
    past: past,
  };
}

/**
 * Rewrites the export tab and proves it by what the cells hold, not by what was sent.
 *
 * `setValues` stores a string opening with `=` as a formula, and a title is whatever a maintainer
 * typed. So the block is plain text before the write, and read back after it.
 */
function refreshMapExport() {
  const ss = SpreadsheetApp.getActive();
  const name = CONFIG.tabs.mapExport;
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`No "${name}" tab in this spreadsheet.`);

  const headers = CONFIG.mapExport.headers;
  const built = mapExportRows_();
  const width = headers.length;
  const lines = [];
  const say = line => lines.push(line);
  const concept = CONFIG.values.eventStatus.concept;

  // Everything past the contract goes first. A dropped column takes its rows with it but not its
  // header, and a header with nothing under it is a field My Maps imports — an empty row in every
  // popup.
  const stale = sheet.getMaxColumns() - width;
  if (stale > 0) {
    sheet.getRange(1, width + 1, sheet.getMaxRows(), stale).clearContent();
  }

  const palette = CONFIG.style.palette;
  sheet.getRange(1, 1, 1, width)
    .setValues([headers])
    .setBackground(palette.primary).setFontColor(palette.surface).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Cleared over the whole tab rather than over what is about to be written: an export shrinks as
  // dates pass, and a row left underneath imports as a pin on a date that is gone.
  const body = sheet.getRange(2, 1, sheet.getMaxRows() - 1, width);
  body.clearContent();
  body.setNumberFormat('@');
  if (built.rows.length) {
    sheet.getRange(2, 1, built.rows.length, width).setValues(built.rows);
  }
  SpreadsheetApp.flush();

  const written = built.rows.length
    ? sheet.getRange(2, 1, built.rows.length, width).getDisplayValues()
    : [];
  const differing = written.reduce((total, row, r) =>
    total + row.filter((value, c) => value !== built.rows[r][c]).length, 0);
  const rows = countFilled_(sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1));

  say(`${name} rebuilt: ${rows} row(s) from ${built.placed} event(s)` +
      (rows === built.rows.length && !differing ? ' ✓' : ' ⚠'));
  say(`Columns: ${headers.join(' | ')}`);
  say('One row per date: an event running over three days is three rows, each named for its date.');
  if (stale > 0) {
    say(`Cleared ${stale} column(s) past the contract, headers included.`);
  }
  if (differing || rows !== built.rows.length) {
    say('');
    say(`DO NOT IMPORT this tab — ${built.rows.length} row(s) were written, the tab reads back ` +
        `${rows}, and ${differing} cell(s) hold something other than what this run computed.`);
  }
  if (built.past) {
    say(`${built.past} date(s) of a run already under way are past, so they are not on the map.`);
  }
  if (built.announced.length) {
    say(`${concept}, venue still to be announced: ${built.announced.join(' · ')}`);
    say(`Expected, not a gap. They stay in ${CONFIG.tabs.events} and the document lists them as`);
    say(`"${CONFIG.doc.venueTba}" — a pin cannot say that, which is why they are not on the map.`);
  }
  if (built.roomless.length) {
    say(`⚠ ${CONFIG.values.eventStatus.confirmed} with no venue, so left off the map: ` +
        built.roomless.join(' · '));
    say('Check data names these too: give them a venue, or set them back to ' + concept + '.');
  }
  if (built.capped.length) {
    say(`⚠ Cut to ${CONFIG.mapExport.maxDays} dates, which is as many as one event may take: ` +
        built.capped.join(' · '));
    say(`Check the end date in ${CONFIG.tabs.events} — a year typed wrong is what this usually is.`);
  }
  if (built.approximate.length) {
    say(`Geocoding by venue name, so the pin lands on the city centre: ` +
        built.approximate.join(' · '));
  }
  const limit = CONFIG.mapExport.importRowLimit;
  if (built.rows.length > limit) {
    say(`⚠ ${built.rows.length} rows, and one layer imports ${limit}: the rest is dropped by the ` +
        'import without a word. This tab is the only place the whole export can be read.');
  }

  say('');
  say('The tab holds what this run computed, and does not follow the sheet. The map follows neither:');
  say(`re-import it (layer menu → delete, then Add layer → Import), position column`);
  say(`"${headers[headers.length - 1]}", title column "${headers[0]}".`);
  say('');
  say('Deleting the layer is not optional, and a re-import is not enough: My Maps keeps a layer\'s');
  say('own field list and only ever appends to it, so a column that has gone from this tab stays in');
  say('the popup as an empty row until the layer itself is replaced.');
  notify_(lines.join('\n'));
}


/**
 * Non-empty cells in a column. `getLastRow()` is no use on a tab an array formula feeds: it returns
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

  mapLine_(body);

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

  // Named rather than left to be noticed: this is the whole of why the map export holds fewer rows.
  const tba = events.filter(event => !event.venue).map(event => event.title);
  if (tba.length) {
    lines.push('');
    lines.push(`Listed as "${CONFIG.doc.venueTba}": ${tba.join(' · ')}`);
    lines.push('A concept event may have no venue yet. It is in here and on no map — a pin cannot say');
    lines.push(`that. ${CONFIG.tabs.mapExport} counts dates rather than events, so its row count and`);
    lines.push('this one do not line up either way.');
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
  const meta = body.appendParagraph(`${events.length} events · updated ${stamp}`);
  meta.editAsText().setFontFamily(font).setFontSize(10).setForegroundColor(palette.muted);
  meta.setSpacingAfter(10);

  rule_(body, palette.primary, 3);
}

/**
 * The link to the published map, as a sentence a reader can act on.
 *
 * The whole sentence carries the link, which is what a screen reader announces. Without a map id
 * nothing is written: a line about a map that is not there is worse than no line.
 */
function mapLine_(body) {
  const url = mapUrl_();
  if (!url || !CONFIG.doc.mapLink) return;

  const marker = CONFIG.doc.mapLinkIcon ? CONFIG.doc.mapLinkIcon + ' ' : '';
  const paragraph = body.appendParagraph(marker + CONFIG.doc.mapLink);
  const text = paragraph.editAsText();
  text.setFontFamily(CONFIG.style.font).setFontSize(10)
    .setForegroundColor(CONFIG.style.palette.link)
    .setLinkUrl(url)
    // Docs underlines what it links, and paints it its own blue. Both are overridden here, in that
    // order: the link is set first, or the styling is what it overrides.
    .setUnderline(false);

  // The marker in the brand colour, the sentence in the one colour a link is spelled in.
  if (marker) {
    text.setForegroundColor(0, CONFIG.doc.mapLinkIcon.length - 1, CONFIG.style.palette.primary);
  }
  paragraph.setSpacingBefore(18);
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
  const paragraph = doc.addFooter().appendParagraph(CONFIG.brand.name);
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
