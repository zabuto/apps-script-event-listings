/**
 * What every setup step shares: finding the spreadsheet, addressing columns, writing formulas in the
 * dialect the sheet parses, and reporting what a run actually did.
 *
 * The one-off **scaffolding** project: standalone, because at first run the spreadsheet it would be
 * bound to does not exist yet, and it never leaves the repo. The code that ships is `src/`.
 *
 * Nothing here reads `CONFIG` at load time, on purpose: Apps Script concatenates a project's files
 * in an order you do not control and `const` does not hoist, so a top-level `var X = CONFIG.a.b`
 * works or throws depending on which file was evaluated first.
 */

/** The lines a run has reported so far. Reset by each entry point. */
let log_ = [];

function report_(line) {
  log_.push('- ' + line);
}

/** Reports through the UI when a human started this, and to the log always. */
function notify_(title, body) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, body, ui.ButtonSet.OK);
  } catch (err) {
    Logger.log(title + '\n' + body);
  }
}


/* ══════════════════════════════════════════════════════════════════════ finding the sheet ═══ */

/**
 * Opens the spreadsheet the skeleton step built. No hardcoded id: `setupSkeleton` stores it in this
 * project's properties, with a folder-and-name lookup as the fallback, so deleting everything and
 * building again needs no edit anywhere.
 *
 * A trashed file still answers to `openById`, hence the check — otherwise a rebuild would quietly
 * write into the copy you just deleted.
 */
function openSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const key = CONFIG.properties.spreadsheetId;
  const stored = properties.getProperty(key);
  if (stored) {
    try {
      if (!DriveApp.getFileById(stored).isTrashed()) return SpreadsheetApp.openById(stored);
      properties.deleteProperty(key);
    } catch (err) {
      properties.deleteProperty(key);      // the id no longer resolves: fall through to the lookup
    }
  }

  const folderName = CONFIG.spreadsheet.folderName;
  const fileName = CONFIG.spreadsheet.fileName;
  const folders = DriveApp.getRootFolder().getFoldersByName(folderName);
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.isTrashed()) continue;
    const files = folder.getFilesByName(fileName);
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      properties.setProperty(key, file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  }
  throw new Error(`No "${fileName}" in "${folderName}" — run setupSkeleton first.`);
}

/** Records the spreadsheet id, so the later steps need no id of their own. */
function rememberSpreadsheet_(ss) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.properties.spreadsheetId, ss.getId());
  report_('Spreadsheet id stored in this project\'s properties: ' + ss.getId());
  return ss;
}

/**
 * The untrashed entries of a Drive iterator, which is the only kind worth reusing.
 *
 * `getFilesByName` and `getFoldersByName` answer with the trash included, so a lookup by name hands
 * back the file somebody deleted an hour ago. Reusing one is worse than not finding it: the run
 * reports a stable id, a rebuild writes into a file every reader's link shows as trashed, and once
 * the trash empties the id dies — while the lookup goes on finding it, so the step that would
 * recreate the file never does. Every reuse-by-name in this project goes through here.
 */
function live_(iterator) {
  const found = [];
  while (iterator.hasNext()) {
    const item = iterator.next();
    if (!item.isTrashed()) found.push(item);
  }
  return found;
}

/** The folder in My Drive, reused if it is already there. */
function ensureFolder_(name) {
  const root = DriveApp.getRootFolder();
  const existing = live_(root.getFoldersByName(name));
  if (existing.length) {
    report_('Folder reused: ' + name);
    return existing[0];
  }
  report_('Folder created: ' + name);
  return root.createFolder(name);
}

/** The tab a `CONFIG.tabs` key names, or a readable failure. */
function sheetFor_(ss, tabKey) {
  const name = CONFIG.tabs[tabKey];
  if (!name) throw new Error(`No tab configured for "${tabKey}" — check CONFIG.tabs.`);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`No "${name}" tab in ${ss.getName()} — run setupSkeleton first.`);
  return sheet;
}


/* ═════════════════════════════════════════════════════════════════ columns and contracts ═══ */

function columnSpec_(tabKey) {
  const spec = CONFIG.columns[tabKey];
  if (!spec) throw new Error(`No columns configured for "${tabKey}" — check CONFIG.columns.`);
  return spec;
}

/** The header row a tab must have, in order. */
function headers_(tabKey) {
  return columnSpec_(tabKey).map(column => column.header);
}

/** The header a column key stands for, for a message a human reads. */
function headerOf_(tabKey, key) {
  return columnSpec_(tabKey)[columnIndex_(tabKey, key)].header;
}

/** 0-based position of a column, by its `key`. Throws rather than returning -1. */
function columnIndex_(tabKey, key) {
  const at = columnSpec_(tabKey).findIndex(column => column.key === key);
  if (at < 0) throw new Error(`No "${key}" column on ${tabKey} — check CONFIG.columns.`);
  return at;
}

/** 1-based position, which is what the `getRange(row, column, …)` family wants. */
function columnNumber_(tabKey, key) {
  return columnIndex_(tabKey, key) + 1;
}

/**
 * `1` → `A`, `26` → `Z`, `27` → `AA`. Spreadsheet columns are base-26 with no zero, which is why
 * this is a loop rather than one addition onto `'A'`.
 *
 * Every column letter in this project comes from here, including the ones on tabs that have no
 * `CONFIG.columns` contract of their own. `'A' + n` is right for the first twenty-six columns and
 * then answers `'['`, which a range accepts the shape of and no cell ever matches.
 */
function letterOf_(number) {
  let n = number;
  let letter = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - remainder) / 26);
  }
  return letter;
}

/** `A`, `B`, … `AA` for a contract column, by its `key`. */
function columnLetter_(tabKey, key) {
  return letterOf_(columnNumber_(tabKey, key));
}

/** The first column of a tab's computed block, for the marks and the protections that follow it. */
function firstComputed_(tabKey) {
  const at = columnSpec_(tabKey).findIndex(column => column.computed);
  return at < 0 ? null : at + 1;
}

/** How many computed columns a tab has. They are always contiguous and always last. */
function computedCount_(tabKey) {
  return columnSpec_(tabKey).filter(column => column.computed).length;
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

/** `C2:C` — the same column as a formula *on that sheet* refers to it, with no tab prefix. */
function local_(tabKey, key) {
  const letter = columnLetter_(tabKey, key);
  return `${letter}2:${letter}`;
}

/** `Venues!A:A` — the whole column, for a lookup that has to include row 1's header harmlessly. */
function colFull_(tabKey, key) {
  const letter = columnLetter_(tabKey, key);
  return `${tabRef_(tabKey)}!${letter}:${letter}`;
}

/** The same, absolute: `Venues!$A:$A`. */
function colLookup_(tabKey, key) {
  const letter = columnLetter_(tabKey, key);
  return `${tabRef_(tabKey)}!$${letter}:$${letter}`;
}


/* ══════════════════════════════════════════════════════════════ names, as the sheet reads them ═══ */

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
 * A read-back that compares raw therefore describes a different sheet from the rules it is reporting
 * on, which is the one thing a read-back may not do.
 */
function lookupKey_(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
}

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


/* ════════════════════════════════════════════════════════════ formulas, in the dialect ═══ */

/**
 * Which argument separator this spreadsheet wants, detected against the live file and cached per
 * locale.
 *
 * `setFormula` does **not** translate: in a sheet whose locale wants `;`, a comma-separated formula
 * is stored verbatim and then evaluates to `#ERROR!` — silently, because *storing* it always
 * succeeds. Every formula in this repo is written US-style and translated on the way in.
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

/**
 * Rewrites a formula written US-style for the sheet's separator. Only separators outside string
 * literals are touched, so a comma inside `", Netherlands"` survives intact. Decimal points are not
 * translated — every formula in this build uses whole numbers.
 */
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
 * Non-empty cells in a column, ignoring the empty strings a formula leaves behind.
 *
 * `getLastRow()` is no use on a tab fed by an array formula: it returns `""` for every empty row, an
 * empty string is a value, and the sheet reports a thousand rows.
 */
function countFilled_(range) {
  return range.getValues().filter(row => row[0] !== '' && row[0] !== null).length;
}


/* ═══════════════════════════════════════════════════════════════════ small sheet helpers ═══ */

/** A block label on a generated tab: bold, on the dark fill, so it reads as a heading. */
function label_(sheet, a1, text) {
  const palette = CONFIG.style.palette;
  sheet.getRange(a1)
    .setValue(text)
    .setFontWeight('bold')
    .setFontColor(palette.surface)
    .setBackground(palette.primaryDark);
}

/** A dropdown that refuses anything not in the source range — the point being that it refuses. */
function rejectInvalid_(sourceRange) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(sourceRange, true)
    .setAllowInvalid(false)
    .build();
}

/**
 * A tick box, and a column that refuses anything else.
 *
 * Validation rather than `insertCheckboxes()`: the rule is what makes the cell hold a boolean and
 * nothing else, and text that merely spells `TRUE` is what both halves of the city-only test read as
 * unticked. Without the refusal a pasted word sits in the box looking like a decision and counting
 * as none.
 */
function checkbox_() {
  return SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .build();
}

/**
 * Protects a value the sheet would otherwise interpret.
 *
 * `setValues` behaves like typing: a leading apostrophe is the literal-text marker and gets
 * swallowed, so a venue called `'t Something` lands as `t Something` — a lookup key, so everything
 * referring to it silently stops matching. Doubling the apostrophe stores it as written; a leading
 * `=` or `+` would be read as a formula, same fix.
 */
function literal_(value) {
  if (typeof value !== 'string' || value === '') return value;
  const first = value.charAt(0);
  return (first === "'" || first === '=' || first === '+') ? "'" + value : value;
}

/** `2026-01-16` → a date at local midnight. An empty string stays empty. */
function dateOf_(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/**
 * The same, in named cells of a tab that is not throwaway, and cleared again whatever happens.
 *
 * A probe belongs on a tab of its own, and `probeValues_` is that. This one exists for the formulas
 * that cannot be evaluated anywhere else: `$B$1:$B$3` are relative to the sheet holding them, so the
 * dashboard's filter means something different on any other tab.
 *
 * The clear is in a `finally` because these cells sit on a tab a maintainer reads, outside the block
 * a rerun rewrites — so nothing else would ever remove them. One of the formulas probed this way is
 * expected to fail, which is the whole point of probing it.
 */
function probeInPlace_(sheet, separator, probes) {
  try {
    probes.forEach(probe => setFormula_(sheet.getRange(probe[1]), probe[2], separator));
    SpreadsheetApp.flush();
    return probes.map(probe => `${probe[0]}: ${sheet.getRange(probe[1]).getDisplayValue()}`);
  } finally {
    probes.forEach(probe => sheet.getRange(probe[1]).clearContent());
  }
}

/**
 * Has the sheet count the ticked `City only?` boxes, in its own language.
 *
 * `=TRUE` is the one boolean literal this codebase writes into a formula, and both rules that turn on
 * it hide a failure to parse it. The conditional format silently matches nothing, painting every
 * city-only venue as unfinished work; the `Venue without an address` check sits inside `IFERROR`,
 * which swallows the error and prints the clean marker for good. Both steps call this, because a
 * step that writes one of those rules and does not evaluate the literal is reporting on a comparison
 * it never saw the sheet make. The JavaScript read-backs cannot cover it: they agree with themselves
 * whatever the sheet does.
 */
function reportCityOnlyFlag_(ss, separator) {
  report_('  ' + probeValues_(ss, separator, [[
    `rows the sheet reads as ${headerOf_('venues', 'cityOnly')}`,
    `=SUMPRODUCT(--(${colRange_('venues', 'cityOnly')}=TRUE))`,
  ]], '_flag_probe').join(''));
}

/** Evaluates read-only formulas on a throwaway tab and returns `label: value` lines. */
function probeValues_(ss, separator, pairs, tabName) {
  const name = tabName || '_probe';
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  const probe = ss.insertSheet(name);
  try {
    pairs.forEach((pair, i) => setFormula_(probe.getRange(i + 1, 1), pair[1], separator));
    SpreadsheetApp.flush();
    return pairs.map((pair, i) => `${pair[0]}: ${probe.getRange(i + 1, 1).getDisplayValue()}`);
  } finally {
    const leftover = ss.getSheetByName(name);
    if (leftover) ss.deleteSheet(leftover);
  }
}
