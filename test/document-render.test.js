/**
 * The agenda document: what the renderers put on the page, and what they must never put on it.
 *
 * These are the functions with no return value — `eventRow_` and friends answer only by mutating an
 * object Google owns, so `helpers/document.js` keeps a plain-data model to assert against. It is
 * also the output with the widest audience: readers get the document and the PDF through a link and
 * never see the sheet, so a leak here is a leak to everyone.
 *
 * The dates are built relative to the current month rather than fixed, so the fixtures are always
 * upcoming without the suite depending on a clock; `dayIn(1, 5)` is the fifth of next month.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadProject } = require('./helpers/project');
const { installFakes, fakeSpreadsheet, fakeDrive, rowFor, midnightIn, formatDate } =
  require('./helpers/fakes');
const { fakeDocument, documentText, paragraphsIn, tablesIn, ParagraphHeading } =
  require('./helpers/document');

const src = loadProject('src');
const CONFIG = src.CONFIG;
const TZ = CONFIG.timeZone;
const DOC_ID = 'fake-doc-id';
const LOGO_ID = 'fake-logo-id';

/* ── fixtures ───────────────────────────────────────────────────────────────────────────────── */

/**
 * One instant, read once, shared by the fixtures and by the code under test.
 *
 * `THREE_EVENTS` and friends are built from "now" when this file loads; `titleBlock_` reads its own
 * "now" later, when a test runs. Everything below is relative to the current month, so the two
 * disagree only across a month boundary — but "only at midnight on the 1st" is still a test that
 * fails for a reason no one will find. Passed to `installFakes` as `now`, which fixes `new Date()`
 * for the code under test as well.
 */
const NOW = new Date();

function todayIn(zone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(NOW);
}

/** Midnight on a day of a month `ahead` months from now, in the sheet's zone. Always upcoming. */
function dayIn(ahead, dayOfMonth) {
  const [year, month] = todayIn(TZ).split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1 + ahead, dayOfMonth));
  return midnightIn(TZ, at.toISOString().slice(0, 10));
}

const event = values => rowFor(CONFIG, 'events', {
  status: CONFIG.values.eventStatus.confirmed,
  upcoming: CONFIG.values.scope.upcoming,
  ...values,
});
const organiser = values => rowFor(CONFIG, 'organisers', values);

/** An `upcomingEvents_`-shaped object, which is all the small renderers ever see. */
const listed = values => ({
  start: dayIn(1, 5), end: dayIn(1, 5), title: 'Open Stage', venue: '', organiser: '',
  city: '', when: '', handle: '', ...values,
});

/** Installs the fakes, hands a body to `use`, and restores. No spreadsheet: none of these read one. */
function onABody(use, { properties = {}, drive = null } = {}) {
  const doc = fakeDocument({ id: DOC_ID });
  // `notified` captures what the code would have told a maintainer; without it those messages go
  // to the real console, where they are both noise and unassertable.
  const logged = [];
  const restore = installFakes({
    properties: { ...properties }, document: doc, drive: drive, notified: logged, now: NOW,
  });
  try {
    use(doc.getBody(), doc);
  } finally {
    restore();
  }
  doc.model.logged = logged;
  return doc.model;
}

/** A single borderless table cell, which is the shape `line_` and `eventRow_` write into. */
const aCell = body => body.appendTable([['']]).getRow(0).getCell(0);

/* ── line_ ──────────────────────────────────────────────────────────────────────────────────── */

test('line_ appends the text and closes the spacing up', () => {
  // Spacing zeroed on both sides is what keeps a three-line entry reading as one block rather than
  // as three paragraphs that happen to be adjacent.
  const model = onABody(body => src.line_(aCell(body), 'Paradiso, Amsterdam', {}));
  const [paragraph] = paragraphsIn(model.body).filter(p => p.text === 'Paradiso, Amsterdam');
  assert.strictEqual(paragraph.spacingBefore, 0);
  assert.strictEqual(paragraph.spacingAfter, 0);
});

test('line_ falls back to the configured font, size and ink', () => {
  const model = onABody(body => src.line_(aCell(body), 'Paradiso', {}));
  const [paragraph] = paragraphsIn(model.body).filter(p => p.text === 'Paradiso');
  assert.strictEqual(paragraph.style.fontFamily, CONFIG.style.font);
  assert.strictEqual(paragraph.style.fontSize, 10);
  assert.strictEqual(paragraph.style.color, CONFIG.style.palette.ink);
});

test('line_ applies bold and italic only when asked for them', () => {
  const model = onABody(body => {
    const cell = aCell(body);
    src.line_(cell, 'plain', {});
    src.line_(cell, 'both', { bold: true, italic: true, size: 12, color: '#123456' });
  });
  const byText = Object.fromEntries(paragraphsIn(model.body).map(p => [p.text, p]));
  assert.strictEqual(byText.plain.style.bold, undefined, 'a plain line was set bold');
  assert.strictEqual(byText.plain.style.italic, undefined, 'a plain line was set italic');
  assert.strictEqual(byText.both.style.bold, true);
  assert.strictEqual(byText.both.style.italic, true);
  assert.strictEqual(byText.both.style.fontSize, 12);
  assert.strictEqual(byText.both.style.color, '#123456');
});

test('line_ hands the paragraph back, which is how the handle gets appended to one', () => {
  onABody(body => {
    const paragraph = src.line_(aCell(body), 'Stichting Podium', {});
    assert.strictEqual(paragraph.getText(), 'Stichting Podium');
  });
});

/* ── rule_ ──────────────────────────────────────────────────────────────────────────────────── */

test('rule_ is a borderless one-cell table coloured as a bar', () => {
  // Docs has no styleable horizontal rule. The table *is* the rule, so a border on it would draw a
  // second line around the first.
  const model = onABody(body => src.rule_(body, '#0B5374', 3));
  const [table] = tablesIn(model.body);
  assert.strictEqual(table.borderWidth, 0, 'the rule would be drawn inside a visible border');
  assert.strictEqual(table.rows.length, 1);
  assert.strictEqual(table.rows[0].cells.length, 1);
});

test('rule_ takes its thickness from the font size and its colour from the fill', () => {
  const model = onABody(body => src.rule_(body, '#0B5374', 3));
  const cell = tablesIn(model.body)[0].rows[0].cells[0];
  assert.strictEqual(cell.background, '#0B5374');
  assert.strictEqual(cell.children[0].style.fontSize, 3);
  assert.deepStrictEqual(cell.padding, { top: 0, bottom: 0, left: 0, right: 0 },
    'padding would make the bar thicker than the thickness asked for');
});

/* ── monthHeading_ ──────────────────────────────────────────────────────────────────────────── */

test('monthHeading_ shouts the label and marks it as a heading', () => {
  const model = onABody(body => src.monthHeading_(body, 'March 2099'));
  const heading = model.body.children[0];
  assert.strictEqual(heading.text, 'MARCH 2099');
  assert.strictEqual(heading.heading, ParagraphHeading.HEADING2,
    'not a real heading, so it is missing from the document outline');
});

test('monthHeading_ draws its rule after the label, not before', () => {
  const model = onABody(body => src.monthHeading_(body, 'March 2099'));
  assert.strictEqual(model.body.children[0].kind, 'paragraph');
  assert.strictEqual(model.body.children[1].kind, 'table', 'the accent rule is missing');
  assert.strictEqual(model.body.children[1].rows[0].cells[0].background,
    CONFIG.style.palette.accent);
});

/* ── eventRow_ ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Renders one event into a row and hands its two cells back.
 *
 * `emptyRow` appends a fresh row instead of using the one `appendTable` made, which is the case
 * `eventRow_` opens by topping up: in Docs a new row arrives with no cells at all.
 */
function renderRow(values, { emptyRow = false } = {}) {
  const model = onABody(body => {
    const table = body.appendTable([['', '']]);
    src.eventRow_(emptyRow ? table.appendTableRow() : table.getRow(0), listed(values));
  });
  const table = tablesIn(model.body)[0];
  const row = emptyRow ? table.rows[1] : table.rows[0];
  return { when: row.cells[0], detail: row.cells[1], row: row };
}

test('eventRow_ tops a fresh row up to two cells, since Docs hands one back empty', () => {
  const { row } = renderRow({ title: 'Open Stage' }, { emptyRow: true });
  assert.strictEqual(row.cells.length, 2);
  assert.strictEqual(row.cells[1].children[0].text, 'Open Stage');
});

test('eventRow_ prints the sheet\'s own When string, so all three outputs spell a date alike', () => {
  const { when } = renderRow({ when: 'Fri 5 June 2099' });
  assert.strictEqual(when.children[0].text, 'Fri 5 June 2099');
});

test('eventRow_ falls back to a formatted start date when the When column was overwritten', () => {
  const start = dayIn(1, 5);
  const { when } = renderRow({ when: '', start: start, end: start });
  assert.strictEqual(when.children[0].text, formatDate(start, TZ, 'd MMM yyyy'));
});

test('eventRow_ puts the title first, in the ink colour', () => {
  const { detail } = renderRow({ title: 'Open Stage' });
  assert.strictEqual(detail.children[0].text, 'Open Stage');
  assert.strictEqual(detail.children[0].style.bold, true);
  assert.strictEqual(detail.children[0].style.color, CONFIG.style.palette.ink);
});

test('eventRow_ writes venue and city on one line', () => {
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso', city: 'Amsterdam' });
  assert.strictEqual(detail.children[1].text, 'Paradiso, Amsterdam');
});

test('eventRow_ omits the comma when the venue has no city', () => {
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso', city: '' });
  assert.strictEqual(detail.children[1].text, 'Paradiso');
});

test('an event with no venue says so in italics, from config and never from the private note', () => {
  // The document is the only output that can carry a venue-less event; a pin cannot say "to be
  // announced", which is why the map export leaves the row out entirely.
  const { detail } = renderRow({ title: 'Open Stage', venue: '', city: '' });
  assert.strictEqual(detail.children[1].text, CONFIG.doc.venueTba);
  assert.strictEqual(detail.children[1].style.italic, true);
});

test('a venue that is present is not italicised', () => {
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso' });
  assert.strictEqual(detail.children[1].style.italic, undefined);
});

test('no organiser means no organiser line, not an empty one', () => {
  // An empty paragraph is a visible gap in a listing this tight, and the row that has no venue yet
  // often has no organiser either.
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso', organiser: '' });
  assert.strictEqual(detail.children.length, 2, 'an empty organiser line was left in the cell');
});

test('an organiser with no handle gets a plain line', () => {
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso',
    organiser: 'Stichting Podium', handle: '' });
  assert.strictEqual(detail.children[2].text, 'Stichting Podium');
  assert.deepStrictEqual(detail.children[2].links, []);
});

test('a handle is appended to the organiser line rather than getting one of its own', () => {
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso',
    organiser: 'Stichting Podium', handle: 'stichtingpodium' });
  assert.strictEqual(detail.children.length, 3, 'the handle was given its own line');
  assert.strictEqual(detail.children[2].text, 'Stichting Podium · @stichtingpodium');
});

test('the link covers the handle and stops short of the separator', () => {
  // The `+ 3` steps over ` · ` and the `- 1` lands on the last character. Taking the offset raw
  // would underline and recolour the punctuation too, which reads as though the ` · ` were part of
  // the link — the exact off-by-one this arithmetic exists to avoid.
  const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso',
    organiser: 'Stichting Podium', handle: 'stichtingpodium' });
  const line = detail.children[2];
  assert.strictEqual(line.links.length, 1);

  const { from, to, url } = line.links[0];
  assert.strictEqual(line.text.slice(from, to + 1), '@stichtingpodium',
    'the link does not cover exactly the handle');
  // Both offsets asserted outright as well, because reading the range back cannot see an overrun:
  // slicing past the end of a string silently returns the same substring.
  assert.strictEqual(from, 'Stichting Podium · '.length, 'the link does not start at the @');
  assert.strictEqual(to, line.text.length - 1, 'the link runs past the end of the paragraph');
  assert.strictEqual(url, CONFIG.social.profileBaseUrl + 'stichtingpodium');
  assert.deepStrictEqual(line.colorRuns, [{ from, to, color: CONFIG.style.palette.link }],
    'the link colour covers a different range from the link itself');
});

test('the link range is recomputed per organiser, not fixed', () => {
  for (const name of ['A', 'Stichting Podium', 'A Very Long Organiser Name Indeed']) {
    const { detail } = renderRow({ title: 'Open Stage', venue: 'Paradiso',
      organiser: name, handle: 'handle' });
    const line = detail.children[2];
    const { from, to } = line.links[0];
    assert.strictEqual(line.text.slice(from, to + 1), '@handle', `wrong range for "${name}"`);
  }
});

/* ── titleBlock_ ────────────────────────────────────────────────────────────────────────────── */

const textsOf = model => paragraphsIn(model.body).map(paragraph => paragraph.text);

test('the title block names the document and the brand, and counts the events', () => {
  const events = [listed({ start: dayIn(1, 5) }), listed({ start: dayIn(2, 20) })];
  const texts = textsOf(onABody(body => src.titleBlock_(body, events)));

  assert.strictEqual(texts[0], CONFIG.doc.title);
  assert.strictEqual(texts[1], `${CONFIG.brand.name} — ${CONFIG.brand.tagline}`);
  assert.match(texts[2], /^2 events · updated /);
});

test('a populated listing carries no date span above the events', () => {
  const events = [listed({ start: dayIn(1, 5) }), listed({ start: dayIn(2, 20) })];
  const texts = textsOf(onABody(body => src.titleBlock_(body, events)));
  const first = formatDate(dayIn(1, 5), TZ, 'd MMMM yyyy');
  const last = formatDate(dayIn(2, 20), TZ, 'd MMMM yyyy');
  assert.ok(!texts.some(text => text.includes(`${first} – ${last}`)),
    `the title block still prints a date span: ${JSON.stringify(texts)}`);
});

test('an empty listing says so instead of leaving the heading bare', () => {
  const texts = textsOf(onABody(body => src.titleBlock_(body, [])));
  assert.strictEqual(texts[2], CONFIG.doc.noEvents);
  assert.match(texts[3], /^0 events · updated /);
});

/* ── the map URL ───────────────────────────────────────────────────────────────────────────── */

/*
 * The map id is an installer setting in Script Properties, so the two places that print it need a
 * fixture that sets one. Both states matter: with an id the line carries the composed URL, without
 * one it must not end in a dangling ` · `.
 */

const MAP_ID = '1FakeMapIdForTests';
const MAP_URL = `${CONFIG.mapViewBaseUrl}${MAP_ID}`;

/** The Script Properties of a project whose map id is set. */
function withMapId(mapId) {
  return { properties: { [CONFIG.properties.mapId]: mapId } };
}

test('the meta line ends with the map URL when a map id is set', () => {
  const texts = textsOf(onABody(body => src.titleBlock_(body, [listed({})]), withMapId(MAP_ID)));
  assert.match(texts[2], /^1 events · updated /);
  assert.ok(texts[2].endsWith(` · ${MAP_URL}`),
    `the map URL is not on the meta line: "${texts[2]}"`);
});

test('the meta line has no dangling separator when no map id is set', () => {
  // Anchored at the end rather than searching for " · ": the line's own separator between the
  // count and the date is meant to be there.
  const texts = textsOf(onABody(body => src.titleBlock_(body, [listed({})])));
  assert.match(texts[2], /^1 events · updated \d{1,2} [A-Za-z]+ \d{4}$/,
    `the meta line is not exactly "N events · updated <date>": "${texts[2]}"`);
});

test('the footer credit ends with the map URL when a map id is set', () => {
  // The footer is what carries the map onto a print-out that has left the building, which is the
  // whole reason the URL is repeated there.
  const doc = fakeDocument({ id: DOC_ID });
  const restore = installFakes({ document: doc, ...withMapId(MAP_ID) });
  try {
    src.ensureFooter_(doc);
  } finally {
    restore();
  }
  assert.strictEqual(doc.model.footer.children[0].text, `${CONFIG.brand.name} · ${MAP_URL}`);
});

test('a set map id reaches the rendered document as a URL, in both places', () => {
  // End to end, on the text a reader receives rather than on one renderer's arguments.
  const { model } = rebuild({ properties: { [CONFIG.properties.mapId]: MAP_ID },
    events: THREE_EVENTS });
  const printed = documentText(model).split('\n').filter(line => line.includes(MAP_URL));
  assert.strictEqual(printed.length, 2,
    `the map URL should appear on the meta line and in the footer, found ${printed.length}`);
});

test('a map id that is absent, empty or blank omits the line rather than composing a URL', () => {
  // Three states a person leaves the property in, all meaning the same thing: never added, set to
  // nothing, and typed as whitespace. Truthiness alone passes the last one on as a live link to
  // nothing.
  for (const [state, mapId] of [['absent', null], ['empty', ''], ['blank', '   ']]) {
    const restore = installFakes(mapId === null ? {} : withMapId(mapId));
    try {
      assert.strictEqual(src.mapUrl_(), '', `the ${state} map id composed a URL`);
    } finally {
      restore();
    }
  }
});

test('the composed map URL is the view form, never edit', () => {
  // The URL reaches every reader and every downloaded PDF, so an edit address hands them the map's
  // editor. Storing the id alone is what puts that shape out of reach.
  const restore = installFakes(withMapId(MAP_ID));
  try {
    assert.strictEqual(src.mapUrl_(), `https://www.google.com/maps/d/view?mid=${MAP_ID}`);
  } finally {
    restore();
  }
});

test('a whole URL pasted into the map id property cannot compose into a working link', () => {
  // The mistake to expect: an installer pastes what the browser gave them, edit address and all.
  const restore = installFakes(withMapId('https://www.google.com/maps/d/edit?mid=1AbC'));
  try {
    const url = src.mapUrl_();
    assert.strictEqual(url.includes('/edit'), false, `an edit address was published: "${url}"`);
    assert.ok(url.startsWith(CONFIG.mapViewBaseUrl),
      `the composed URL does not keep the view form: "${url}"`);
  } finally {
    restore();
  }
});

test('no logo is configured, so none is appended and nothing fails', () => {
  const model = onABody(body => src.titleBlock_(body, []));
  assert.strictEqual(model.body.children.some(child => child.kind === 'image'), false);
});

test('a configured logo is appended at the configured size', () => {
  const model = onABody(body => src.titleBlock_(body, []), {
    properties: { [CONFIG.properties.logoFileId]: LOGO_ID },
    drive: fakeDrive({ blobs: { [LOGO_ID]: 'png bytes' } }),
  });
  const [image] = model.body.children.filter(child => child.kind === 'image');
  assert.ok(image, 'the configured logo was not appended');
  assert.strictEqual(image.width, CONFIG.doc.logo.widthPt);
  assert.strictEqual(image.height, CONFIG.doc.logo.heightPt);
  assert.strictEqual(model.body.children[0], image, 'the logo is not at the top');
});

test('an unreadable logo is skipped and the listing is still rendered', () => {
  // The stated guarantee: a missing or unreadable logo must never block the listing. The file is
  // read fresh from Drive on every run, so it is one permission change away from being gone.
  const model = onABody(body => src.titleBlock_(body, [listed({})]), {
    properties: { [CONFIG.properties.logoFileId]: LOGO_ID },
    drive: fakeDrive({ unreadable: [LOGO_ID] }),
  });
  assert.strictEqual(model.body.children.some(child => child.kind === 'image'), false);
  assert.strictEqual(textsOf(model)[0], CONFIG.doc.title, 'the listing did not survive the logo');
  // A logo that stops resolving is invisible on the page, so this line is the only thing that can
  // explain it.
  assert.ok(model.logged.some(line => /logo skipped/.test(line)),
    `nothing said why the logo is missing: ${JSON.stringify(model.logged)}`);
});

test('the title block ends with the primary rule', () => {
  const model = onABody(body => src.titleBlock_(body, []));
  const last = model.body.children[model.body.children.length - 1];
  assert.strictEqual(last.kind, 'table');
  assert.strictEqual(last.rows[0].cells[0].background, CONFIG.style.palette.primary);
});

/* ── ensureFooter_ ──────────────────────────────────────────────────────────────────────────── */

test('a document with no footer gets the credit line', () => {
  // Download and *Make a copy* stay on, so the footer is what carries the name onto a print-out
  // that has left the building.
  //
  // Pinned to an unset map id: the brand name alone is the whole credit line only while that
  // setting is empty.
  const doc = fakeDocument({ id: DOC_ID });
  const restore = installFakes({ document: doc });
  try {
    src.ensureFooter_(doc);
  } finally {
    restore();
  }
  assert.ok(doc.model.footer, 'no footer was written');
  assert.strictEqual(doc.model.footer.children[0].text, CONFIG.brand.name);
});

test('an existing footer is left alone, so hand-added page numbers survive', () => {
  // Apps Script has no page-number element, so a person inserts it in Docs — after the first run.
  // This early return is what stops the next rebuild wiping it.
  const doc = fakeDocument({ id: DOC_ID, footer: true });
  const restore = installFakes({ document: doc });
  try {
    src.ensureFooter_(doc);
  } finally {
    restore();
  }
  assert.strictEqual(doc.model.footer.preexisting, true, 'the footer was replaced');
  assert.deepStrictEqual(doc.model.footer.children, [], 'the credit line was written over it');
});

/* ── generateEventsDoc, end to end ──────────────────────────────────────────────────────────── */

/**
 * Rebuilds the document from a sheet and hands back everything worth asserting on.
 *
 * `lastRow` presents the events tab as the live one is: its array formulas spill the whole column,
 * so `table_` receives a blank tail on every real run. See `helpers/fakes.js`.
 */
function rebuild({ events = [], organisers = [], properties = {}, drive = null, lastRow = null } = {}) {
  const doc = fakeDocument({ id: DOC_ID });
  const driveFake = drive || fakeDrive({});
  const notified = [];
  const restore = installFakes({
    spreadsheet: fakeSpreadsheet(CONFIG, { timeZone: TZ,
      tabs: { events: lastRow ? { rows: events, lastRow: lastRow } : events, organisers } }),
    properties: { [CONFIG.properties.eventsDocId]: DOC_ID, ...properties },
    document: doc,
    drive: driveFake,
    notified: notified,
    now: NOW,
  });
  try {
    src.generateEventsDoc();
  } finally {
    restore();
  }
  return { model: doc.model, drive: driveFake, report: notified.join('\n') };
}

const THREE_EVENTS = [
  event({ dateStart: dayIn(1, 5), title: 'Open Stage', venue: 'Paradiso', city: 'Amsterdam',
    organiser: 'Stichting Podium', when: 'first one', notePrivate: 'SECRET-DO-NOT-PUBLISH' }),
  event({ dateStart: dayIn(1, 20), title: 'Late Set', venue: 'Paradiso', city: 'Amsterdam',
    when: 'second one' }),
  event({ dateStart: dayIn(2, 3), title: 'Next Month', venue: 'Tivoli', city: 'Utrecht',
    when: 'third one' }),
];

test('the document is rebuilt from scratch, margins and all', () => {
  const { model } = rebuild({ events: THREE_EVENTS });
  const margin = CONFIG.doc.marginPt;
  assert.deepStrictEqual(model.body.margins,
    { top: margin, bottom: margin, left: margin, right: margin });
  assert.strictEqual(model.saved, 1, 'the document was not saved and closed exactly once');
});

test('the empty paragraph body.clear() leaves behind is removed, so the top is the title', () => {
  // Docs always leaves one. Without the removal the document opens on a blank line.
  const { model } = rebuild({ events: THREE_EVENTS });
  assert.strictEqual(model.body.children[0].kind, 'paragraph');
  assert.strictEqual(model.body.children[0].text, CONFIG.doc.title);
});

test('events are grouped under one heading and one table per month', () => {
  const { model } = rebuild({ events: THREE_EVENTS });
  const headings = paragraphsIn(model.body).filter(p => p.heading === ParagraphHeading.HEADING2);
  assert.strictEqual(headings.length, 2, 'the two months did not produce two headings');

  // The rules are tables too, so the event tables are the ones holding two columns.
  const eventTables = tablesIn(model.body).filter(table => table.rows[0].cells.length === 2);
  assert.strictEqual(eventTables.length, 2);
  assert.strictEqual(eventTables[0].rows.length, 2, 'the two same-month events are not in one table');
  assert.strictEqual(eventTables[1].rows.length, 1);
});

test('the listing is oldest first', () => {
  const shuffled = [THREE_EVENTS[2], THREE_EVENTS[0], THREE_EVENTS[1]];
  const { model } = rebuild({ events: shuffled });
  const titles = paragraphsIn(model.body)
    .map(p => p.text)
    .filter(text => ['Open Stage', 'Late Set', 'Next Month'].includes(text));
  assert.deepStrictEqual(titles, ['Open Stage', 'Late Set', 'Next Month']);
});

test('the outro is appended after the listing', () => {
  const { model } = rebuild({ events: THREE_EVENTS });
  const texts = paragraphsIn(model.body).map(p => p.text);
  assert.strictEqual(texts[texts.length - 1], CONFIG.doc.outro);
});

test('the handle from the Organisers tab becomes a link in the document', () => {
  const { model } = rebuild({
    events: THREE_EVENTS,
    organisers: [organiser({ name: 'Stichting Podium', social: '@stichtingpodium' })],
  });
  const [line] = paragraphsIn(model.body).filter(p => p.links.length);
  assert.strictEqual(line.text, 'Stichting Podium · @stichtingpodium',
    'the stray @ from the sheet was not stripped before the handle was used');
  assert.strictEqual(line.links[0].url, CONFIG.social.profileBaseUrl + 'stichtingpodium');
});

test('the handle is found however the organiser is capitalised in the events row', () => {
  // The map export resolves the handle with `XLOOKUP`, which ignores case. A raw comparison here
  // leaves the pin carrying the link and the document silently dropping it — two outputs disagreeing
  // about one organiser.
  const { model } = rebuild({
    events: [event({ dateStart: dayIn(1, 5), title: 'Open Stage', venue: 'Paradiso',
      city: 'Amsterdam', organiser: 'stichting PODIUM', when: 'first one' })],
    organisers: [organiser({ name: 'Stichting Podium', social: 'stichtingpodium' })],
  });
  const [line] = paragraphsIn(model.body).filter(p => p.links.length);
  assert.ok(line, 'the handle was not found, so the organiser line got no link');
  assert.strictEqual(line.text, 'stichting PODIUM · @stichtingpodium');
  assert.strictEqual(line.links[0].url, CONFIG.social.profileBaseUrl + 'stichtingpodium');
});

test('nothing from a (private) column reaches the document, down any render path', () => {
  // The `(private)` column rule, at the far end of the pipeline. Every other privacy test reads a
  // formula; this one reads the rendered page, which is what a reader actually receives.
  //
  // Every branch of `eventRow_` gets its own noted row, because the fallbacks are where a note would
  // be reached for: the venue-less event falls back to a config string, and the organiser-less one
  // omits a line rather than filling it. A fixture whose rows all had a venue and an organiser would
  // never enter either, and would report clean while both leaked.
  const noted = [
    event({ dateStart: dayIn(1, 4), title: 'Has everything', venue: 'Paradiso', city: 'Amsterdam',
      organiser: 'Stichting Podium', when: 'one', notePrivate: 'LEAK-FULL-ROW' }),
    event({ dateStart: dayIn(1, 5), title: 'No venue', when: 'two', notePrivate: 'LEAK-NO-VENUE' }),
    event({ dateStart: dayIn(1, 6), title: 'No organiser', venue: 'Paradiso', city: 'Amsterdam',
      when: 'three', notePrivate: 'LEAK-NO-ORGANISER' }),
    event({ dateStart: dayIn(1, 7), title: 'No when', venue: 'Tivoli', city: 'Utrecht',
      organiser: 'Stichting Podium', notePrivate: 'LEAK-NO-WHEN' }),
  ];
  const { model, report } = rebuild({
    events: noted,
    organisers: [organiser({ name: 'Stichting Podium', social: 'stichtingpodium',
      notesPrivate: 'LEAK-ORGANISER-NOTE' })],
  });

  const rendered = documentText(model);
  for (const secret of ['LEAK-FULL-ROW', 'LEAK-NO-VENUE', 'LEAK-NO-ORGANISER', 'LEAK-NO-WHEN',
    'LEAK-ORGANISER-NOTE']) {
    assert.strictEqual(rendered.includes(secret), false,
      `${secret} was rendered into the published document`);
    assert.strictEqual(report.includes(secret), false,
      `${secret} reached the report, which gets pasted into messages`);
  }
  assert.strictEqual(rendered.includes('No venue'), true, 'the noted rows were not rendered at all');
});

test('a live events tab, blank tail and all, renders exactly the typed events', () => {
  // The whole pipeline against the shape the sheet actually has: the typed rows plus ~997 blank
  // ones, none of which may reach the document or the report.
  const { model, report } = rebuild({ events: THREE_EVENTS, lastRow: 1000 });

  const eventTables = tablesIn(model.body).filter(table => table.rows[0].cells.length === 2);
  const rows = eventTables.reduce((total, table) => total + table.rows.length, 0);
  assert.strictEqual(rows, 3, 'the blank tail was rendered as event rows');

  // The count the maintainer reads is taken from the same tab, so it has to agree.
  assert.match(report, /3 upcoming event\(s\), oldest first/);
  assert.match(report, /the same number, which is the check ✓/);

  // The same events with and without the tail have to produce the same page. Note that "no empty
  // paragraph" would be the wrong assertion: every `rule_` is a one-cell table whose cell holds
  // one.
  assert.strictEqual(documentText(model), documentText(rebuild({ events: THREE_EVENTS }).model),
    'the blank tail changed the rendered document');
});

test('sharing is re-asserted on every run, because it is a property of the file', () => {
  const { drive } = rebuild({ events: THREE_EVENTS });
  assert.deepStrictEqual(drive.recordedSharing,
    [{ id: DOC_ID, access: 'ANYONE_WITH_LINK', permission: 'VIEW' }]);
});

test('under sharing "leave" the file\'s access is not read or written at all', () => {
  const saved = CONFIG.doc.sharing;
  CONFIG.doc.sharing = 'leave';
  try {
    const { drive, report } = rebuild({ events: THREE_EVENTS });
    assert.deepStrictEqual(drive.recordedSharing, [], 'sharing was changed under "leave"');
    assert.match(report, /left exactly as you set it in Drive/);
  } finally {
    CONFIG.doc.sharing = saved;
  }
});

test('an unset document id fails with the instructions, not with "Invalid argument: id"', () => {
  const doc = fakeDocument({ id: DOC_ID });
  const restore = installFakes({
    spreadsheet: fakeSpreadsheet(CONFIG, { timeZone: TZ, tabs: { events: [], organisers: [] } }),
    properties: {},
    document: doc,
    drive: fakeDrive({}),
  });
  try {
    assert.throws(() => src.generateEventsDoc(), /is not set/);
    assert.throws(() => src.generateEventsDoc(), /Script Properties/);
  } finally {
    restore();
  }
});

test('an empty sheet still produces a document, with the no-events line', () => {
  const { model } = rebuild({ events: [] });
  assert.match(documentText(model), new RegExp(CONFIG.doc.noEvents));
  assert.strictEqual(model.saved, 1);
});

/* ── docReport_, the maintainer's half of the run ───────────────────────────────────────────── */

test('the report checks itself against the sheet and says so when the two agree', () => {
  const { report } = rebuild({ events: THREE_EVENTS });
  assert.match(report, /3 upcoming event\(s\), oldest first/);
  assert.match(report, /the same number, which is the check ✓/);
});

test('a row the sheet calls upcoming but cannot be sorted is reported as a mismatch', () => {
  // The sheet says four, the listing has three, and the report has to name that rather than let a
  // dropped event pass as a shorter month.
  const { report } = rebuild({
    events: THREE_EVENTS.concat([event({ dateStart: 'december 2099', title: 'No real date' })]),
  });
  assert.match(report, /THE TWO MUST MATCH/);
  // The hint's job is to send the maintainer to the right column. It builds that name through
  // `headers_`/`columnIndex_`, so naming any other column still reads as a sentence.
  const dateStart = CONFIG.columns.events.find(column => column.key === 'dateStart').header;
  assert.match(report, new RegExp(`no real date in ${dateStart} is the usual cause`));
});

test('the venue-less events are named, because that is why the map is shorter', () => {
  const { report } = rebuild({
    events: [event({ dateStart: dayIn(1, 5), title: 'Roomless', when: 'soon' })],
  });
  assert.match(report, new RegExp(`Listed as "${CONFIG.doc.venueTba}": Roomless`));
  assert.match(report, /shorter than this document by exactly these/);
});

test('the report counts how many events got a link', () => {
  const { report } = rebuild({
    events: THREE_EVENTS,
    organisers: [organiser({ name: 'Stichting Podium', social: 'stichtingpodium' })],
  });
  assert.match(report, new RegExp(`${CONFIG.social.label} links: 1 of 3`));
});

test('the report links the preview and the PDF, never the editable document', () => {
  // It is printed into the dialog a maintainer copies from. An /edit link handed to a reader is
  // write access to the published agenda.
  const { report } = rebuild({ events: THREE_EVENTS });
  assert.match(report, new RegExp(`/document/d/${DOC_ID}/preview`));
  assert.match(report, new RegExp(`/document/d/${DOC_ID}/export\\?format=pdf`));
  assert.strictEqual(/\/edit/.test(report), false, 'the report hands out an edit link');
});
