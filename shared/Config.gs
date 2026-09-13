/**
 * Every name, label, colour and column in one place.
 *
 * **This is the canonical copy.** `scripts/sync-config.sh` copies it verbatim into
 * `bootstrap/Config.gs` and `src/Config.gs`, two Apps Script projects that cannot share a file.
 * Edit this one, run the script, push both. Nothing here is secret.
 *
 * Two rules keep it safe to edit:
 *
 *   1. **Never read `CONFIG` at load time.** Apps Script concatenates a project's files in an order
 *      you do not control and `const` does not hoist, so a top-level `var X = CONFIG.a.b` works or
 *      throws depending on which file was evaluated first. Derive every value inside a function.
 *   2. **Address columns by `key`, never by letter or position.** Renaming a `header`, reordering
 *      the list or inserting a column carries formulas, reads and protections with it, through
 *      `columnLetter_()` / `columnIndex_()`. Changing a `key` is the one thing that is a code change.
 *
 * No id is here, a file's or the published map's: they live in Script Properties, so a public repo
 * never carries someone's Drive layout. See `docs/configuration.md`.
 */
const CONFIG = {

  /* ─────────────────────────────────────────────────────────────── identity and wording ───── */

  brand: {
    /** Used in the document subtitle, the page footer and the outro line. */
    name: 'Example Collective',
    /** One line under the title of the generated document. */
    tagline: 'What is on, and where',
    /** The spreadsheet menu the whole thing hangs off. */
    menu: 'Event Map',
  },

  /**
   * Passed to every `formatDate` explicitly, never trusted from the manifest: `clasp push` does not
   * move the manifest's `timeZone` — the server keeps the project's own — so a project created in
   * another zone would date the document wrongly and look fine doing it.
   */
  timeZone: 'Europe/Amsterdam',

  /**
   * The address a map id is composed into. Fixing the **view** form here keeps an `/edit` link, and
   * the `&ll=…&z=…` viewport a browser appends, out of the document and every PDF downloaded from
   * it. The id is in `properties.mapId`; without one the line is omitted.
   */
  mapViewBaseUrl: 'https://www.google.com/maps/d/view?mid=',

  /**
   * The social network organiser handles belong to. Handles are stored bare, without the `@`.
   * The column *header* is separate, in `columns.organisers` — re-pointing this is two edits.
   */
  social: {
    label: 'Instagram',
    profileBaseUrl: 'https://instagram.com/',
  },

  /* ─────────────────────────────────────────────────────────────────────── house style ───── */

  style: {
    /** One font everywhere. Anything below 10 pt is unreadable in print, so 10 is the floor. */
    font: 'Arial',
    fontSize: 10,
    /**
     * Eleven **roles**, not eleven favourite colours: the code names the job, so re-theming is this
     * block and nothing else.
     *
     * Three conventions are worth keeping if you change the values:
     *
     *   · `link` is for links and nothing else, so a link is never mistaken for a heading.
     *   · a solid `primary` fill with `surface` text is a header row or a broken reference, never a
     *     warning — warnings are light fills with `ink` text, so the two cannot be confused.
     *   · colour is never the only signal: a concept row is filled *and* says `Concept`, a closed
     *     venue struck through *and* `Closed`, an incomplete address filled *and* named in a hygiene
     *     check — which keeps the sheet readable in black and white.
     *
     * These values stay legible light-on-dark and dark-on-light; which contrast standard your
     * outputs must meet is your call, not this codebase's. Text on a coloured fill is what goes
     * wrong quietly: fine on the screen it was picked on, unreadable on a projector or in print.
     */
    palette: {
      primary: '#0B5374',      // header rows, doc title, month headings, unknown-reference fill
      primaryDark: '#05364B',  // block labels, control labels, subheadings, the date column
      secondary: '#1C6B90',    // computed-column headers, generated tabs, the doc subtitle
      accent: '#4E8FB5',       // thin rules — decorative, carries no text
      infoFill: '#BEE8FF',     // "not settled yet, and that is fine" — light fill, ink text
      warnFill: '#FFE3B0',     // "incomplete, and it needs finishing" — light fill, ink text
      link: '#1236CC',         // links, and only links
      ink: '#10222E',          // body text
      muted: '#52616E',        // secondary text
      grey: '#6B6B6B',         // struck through: past, cancelled, closed
      surface: '#F7FAFC',      // text on a dark fill, and the one light cell fill
    },
  },

  /* ────────────────────────────────────────────────────────────────────────── the sheet ───── */

  spreadsheet: {
    /** Created in the root of My Drive by the bootstrap project if it is not there already. */
    folderName: 'Event Listings',
    fileName: 'Events & Map',
    /**
     * Decides the formula argument separator (`,` or `;`) and how dates are typed. Set it once,
     * before any data is entered: changing it later reinterprets what is already in the cells. The
     * code measures the separator rather than assuming it.
     */
    locale: 'nl_NL',
    dateFormat: 'dd-mm-yyyy',
  },

  /**
   * Tab names, and the order they appear in.
   *
   * **The order is load-bearing.** My Maps imports the *first* sheet and offers no way to pick
   * another, so `mapExport` stays in position 1. Reorder for reading order and the next map refresh
   * geocodes whatever now sits first — the read-me included.
   */
  tabs: {
    mapExport: 'Map Export',
    readMe: 'Read me',
    events: 'Events',
    venues: 'Venues',
    organisers: 'Organisers',
    dashboard: 'Dashboard',
    lists: 'Lists',
  },

  /**
   * The column contracts. `key` is what the code calls a column, `header` what a human reads,
   * `computed` marks one written by a formula rather than typed.
   *
   * Every read, formula and protected range derives from this list, and a contract mismatch is
   * refused rather than read on: a check that reads the wrong column reports *clean*.
   *
   * A `(private)` column never leaves the sheet and says so in its header, where nobody can miss it.
   * It is always the **last non-computed** column of its tab, so every tab reads left to right as
   * publishable, then private, then computed. A new typed column goes *before* it, not inside the
   * block a maintainer reads as generated.
   */
  columns: {
    events: [
      { key: 'dateStart',   header: 'Date Start' },
      { key: 'dateEnd',     header: 'Date End' },
      { key: 'title',       header: 'Title' },
      { key: 'venue',       header: 'Venue' },
      { key: 'organiser',   header: 'Organiser' },
      { key: 'status',      header: 'Status' },
      { key: 'notePrivate', header: 'Note (private)' },
      { key: 'city',        header: 'City',      computed: true },
      { key: 'when',        header: 'When',      computed: true },
      { key: 'upcoming',    header: 'Upcoming?', computed: true },
    ],
    venues: [
      { key: 'name',         header: 'Venue' },
      { key: 'address',      header: 'Address' },
      { key: 'postcode',     header: 'Postcode' },
      { key: 'city',         header: 'City' },
      { key: 'url',          header: 'Venue URL' },
      { key: 'status',       header: 'Status' },
      { key: 'cityOnly',     header: 'City only?' },
      { key: 'notesPrivate', header: 'Notes (private)' },
    ],
    organisers: [
      { key: 'name',         header: 'Organiser' },
      { key: 'social',       header: 'Instagram' },
      { key: 'website',      header: 'Website' },
      { key: 'notesPrivate', header: 'Notes (private)' },
    ],
  },

  /**
   * The values the two `Status` columns accept, and what the computed columns produce.
   *
   * Compared in formulas *and* in JavaScript, in both projects.
   */
  values: {
    eventStatus: { confirmed: 'Confirmed', concept: 'Concept', cancelled: 'Cancelled' },
    venueStatus: { active: 'Active', closed: 'Closed' },
    /** What `Upcoming?` computes to. A cancelled event is neither upcoming nor past. */
    scope: { upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled' },
    /** What the computed columns say when they cannot answer. */
    unknownVenue: '⚠ unknown venue',
    dateTba: 'date to be announced',
    /** The `All` entry at the top of the dashboard's city and organiser pickers. */
    all: 'All',
    /**
     * How `When` spells a date, and why it spells it at all rather than leaving it to
     * `TEXT(…,"ddd d mmm yyyy")`: that follows the *sheet's* locale, so a Dutch sheet renders
     * `di 13 jan 2026` amid English output. The dashboard, the map popup and the document all reuse
     * this one column, so it picks its own words.
     *
     * Seven days from Sunday (`WEEKDAY` numbers them that way) and twelve months. Translate them and
     * every output follows.
     */
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    /** What a check that found nothing prints, so an empty cell always means "did not run". */
    clean: '✓ none',
  },

  /* ──────────────────────────────────────────────────────────────────── the map export ───── */

  mapExport: {
    /**
     * These columns *are* the popup: My Maps renders every imported column as a label/value row in
     * sheet order, with no way to hide one, so each costs a line in every pin. `City` is deliberately
     * absent — the title carries it (see `titleSuffix`) and `Location` says it again.
     *
     * **Dropping a column needs a fresh layer, not a re-import.** My Maps matches a later import to
     * the layer's *existing* field list by name and only ever appends. Delete the layer, add it again.
     */
    headers: ['Title', 'When', 'Venue', 'Organiser', 'Location'],
    /**
     * Appended to every geocodable line: true of every venue in one sheet, so not worth a column. Set
     * it to '' for a sheet spanning countries — and add a country column to `columns.venues`.
     */
    countrySuffix: 'Netherlands',
    /**
     * The city is appended to the map title because the layer panel lists titles and nothing else: a
     * touring show otherwise makes that list a dozen indistinguishable rows.
     */
    titleSuffix: ' — ',
  },

  /* ──────────────────────────────────────────────────────────────── the agenda document ───── */

  doc: {
    /** The file name the one-time setup creates and then never changes. */
    fileName: 'Upcoming Events',
    title: 'Upcoming Events',
    /** Rebuilt on every run, so nothing may be typed into the document by hand. */
    outro: 'Something missing? Let us know.',
    /** A concept event may have no venue yet. The document is the one output that can say so. */
    venueTba: 'Venue to be announced',
    noEvents: 'No upcoming events listed',
    /** A4 margins in points: 56 pt ≈ 2 cm. Re-asserted on every run. */
    marginPt: 56,
    /** Prefix of the dated PDF written by the optional archive function. */
    pdfNamePrefix: 'Upcoming Events',
    /** The Drive folder the optional PDF archive is written to, beside the spreadsheet. */
    pdfFolderName: 'PDF archive',
    /**
     * The **only** place this codebase touches file sharing, and a setting because who may read what
     * is yours to decide, not the script's.
     *
     *   · `'anyoneWithLink'` — set to anyone-with-the-link, view-only, on every rebuild. That is what
     *     makes a stable public link possible, and re-asserting it means a change made by hand does
     *     not survive the next run.
     *   · `'leave'` — the code never reads or writes anything's sharing. Set the document's access
     *     yourself in Drive; everything else still works, and the document is as private as you
     *     made it.
     *
     * Nothing else here changes anyone's access: the spreadsheet's own sharing list is never touched,
     * and the range protections only stop *accidental* edits to generated cells.
     */
    sharing: 'anyoneWithLink',
    /**
     * Entirely optional — the document builds without one and says so in the log.
     *
     * `fileName` is what the one-time setup looks for in the project folder: drop your image there
     * and it is found by name, then bound by **id**. An id binds to the bytes, so replacing the file
     * later with a differently-sized one renders a blurry logo and raises nothing — hence the digest
     * the setup step prints.
     */
    logo: { fileName: 'logo.png', widthPt: 64, heightPt: 64 },
  },

  /** The weekly rebuild of the document. One trigger, owned by whoever installs it. */
  weeklyRefresh: { weekDay: 'MONDAY', hour: 6 },

  /* ───────────────────────────────────────────────────────────────── Script Properties ───── */

  /**
   * An id is **not** configuration in a repo — it is one person's Drive. Ids live in Script
   * Properties instead (Apps Script IDE → Project Settings → Script Properties), which is why this
   * codebase can be public without a scrubbing pass. These are the property *names*, not the values.
   */
  properties: {
    spreadsheetId: 'SPREADSHEET_ID',   // written by the bootstrap project when it builds the sheet
    eventsDocId: 'EVENTS_DOC_ID',      // read by the bound project
    logoFileId: 'LOGO_FILE_ID',        // optional
    pdfFolderId: 'PDF_FOLDER_ID',      // optional
    mapId: 'MAP_ID',                   // optional — the map's `mid`, not a Drive id
  },
};
