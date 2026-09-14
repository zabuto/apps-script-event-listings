# Testing

Everything here runs offline. No Google account, no spreadsheet, no network, and nothing installed.

```sh
node --test test/
```

That is the whole suite. It exits `0` when everything passes and `1` when anything fails, so it is safe to gate a push
on.

## What you need

`node`, which you already have if you are running `clasp`. That is all — there is no `package.json`, no `node_modules`,
and no framework to pull in. The suite uses `node --test` and `node:assert`, both of which ship with node itself.

## Running less than all of it

```sh
node --test test/upcoming-events.test.js          # one file
node --test --test-name-pattern="time zone" test/ # tests whose name matches
node --test --test-reporter=dot test/             # one character per test
node --test --test-concurrency=1 test/            # serially, when output is interleaving
```

Each file runs in its own process, so nothing one test file loads can affect another. That is not incidental: the two
projects declare a set of identically named helpers between them, and in one process the second one loaded would win.

## What is covered

| File | What it holds the code to |
|---|---|
| `config-contracts.test.js` | tab order, computed block last, `(private)` last, five map headers, unique keys |
| `build-steps.test.js` | every step being in `setupAll`, and what is deliberately kept out of it |
| `privacy.test.js` | the `(private)` column rule made mechanical: no formula reads one, and no map row carries one |
| `formula-dialect.test.js` | separator translation, `quoteLiteral_`, `literal_`, `countFilled_` |
| `columns.test.js` | addressing a column by `key`, letters past `Z`, tab-name quoting |
| `map-export.test.js` | one row per date, how a pin is named and what it says, and the geocodable line |
| `map-refresh.test.js` | what `refreshMapExport` writes to the tab, and the report that refuses an unsafe import |
| `upcoming-events.test.js` | the agenda's cutoff agreeing with the sheet under any script time zone |
| `cross-project-helpers.test.js` | the duplicated helpers not drifting between the projects, and the list of them |
| `check-formulas.test.js` | runs `scripts/check-formulas.js` and fails on its verdict |
| `table.test.js` | `table_` refusing a tab whose header row no longer matches the contract |
| `data-check.test.js` | what `checkData` reports, and the three things it deliberately stays quiet about |
| `city-only-flag.test.js` | the `City only?` box: only a tick counts, and every reader of it agreeing |
| `document-render.test.js` | what the agenda renderers put on the page — and that no `(private)` column reaches it |
| `menu.test.js` | `onOpen` offering only items whose function exists, and never a leading or trailing separator |
| `seed-carry-over.test.js` | the seed writers reading the sheet before they clear it, so hand-typed notes survive |
| `capture-quoting.test.js` | `quote_` and `isoOrBlank_` emitting `SeedData.gs` that parses, whatever a cell holds |
| `drive-reuse.test.js` | reuse by name looking past the trash, so a deleted file is never resurrected |
| `probe-cleanup.test.js` | `probeInPlace_` clearing every cell it wrote, including when the probed formula fails |

## What it cannot cover

Worth knowing, so a green suite is not read as more than it is:

- **Anything needing a live spreadsheet** — protections, data validation, filter views, whether a formula *means* what
  you intended. Only a sheet can answer those, which is what the probes inside each setup step are for.
- **Trigger and PDF plumbing** — `installWeeklyRefresh`, `saveEventsPdf`, `showConfiguration`. Each is a call into a
  Google service with almost no logic of its own. `menu.test.js` carries that list as its closing test, so removing a
  name from it should mean a test now exists.
- **How a document *looks*** — the renderers are checked for what they put on the page and how they style it, which is
  not the same as the page being well laid out. Only Docs answers that.
- **`notify_`** across the two projects: it needs a UI, so it cannot be compared by calling it, and its source
  comparison is exempted. `cross-project-helpers.test.js` says so out loud rather than leaving the gap implied.

## How the harness works

Two helpers, both in `test/helpers/`:

**`project.js`** loads a project the way Apps Script does — every file into one shared scope, in one order, with no
module boundaries. It uses `new Function` rather than `eval` so each call gets a fresh, isolated scope, and rewrites
`const`/`let` to `var` because the concatenated source declares some names more than once.

```js
const {loadProject} = require('./helpers/project');
const src = loadProject('src');          // or 'bootstrap'
src.mapExportRows_();
```

**`document.js`** is `DocumentApp`, built the other way round from the rest: the renderers return nothing and answer
only by mutating an object Google owns, so the fake keeps a **plain-data model** of everything appended and styled, with
the API surface as a shell over it. Tests assert against `doc.model` — never against the fake objects — and
`documentText(model)` flattens the whole page to text, which is what the privacy assertion reads.

Three Docs behaviours are reproduced rather than smoothed over, because the code compensates for all three and a tidier
fake would make the compensation untestable: `body.clear()` leaves one empty paragraph behind, `appendTableRow()`
returns a row with no cells, and `setLinkUrl` refuses an offset outside the text.

```js
const {fakeDocument, documentText} = require('./helpers/document');
const doc = fakeDocument({id: 'fake-doc-id'});        // or { footer: true }
const restore = installFakes(
  {document: doc, drive: fakeDrive({blobs: { /* … */ }})})
;
```

**`fakes.js`** stands in for `SpreadsheetApp`, `PropertiesService`, `DriveApp`, and the rest. Each stub does the one
thing the code under test asks of it and **throws on anything else** — a fake that answers plausibly is how a test
passes against behaviour Google does not have.

`Utilities.formatDate` is the exception: it is implemented for real, against `Intl`, because the time zone tests turn on
a date being projected into a *named* zone. A stub that ignored the zone argument would make the bug those tests exist
to catch invisible.

```js
const {installFakes, fakeSpreadsheet} = require('./helpers/fakes');
const spreadsheet = fakeSpreadsheet(CONFIG, {tabs: {events: rows}});
const restore = installFakes({spreadsheet});
try { /* … */
} finally {
  restore();
}
```

`timeZone` defaults to `FIXTURE_ZONE`, an arbitrary zone: matching `CONFIG.timeZone` is chance, and most tests never
format a date against it. Name one only where the answer turns on it — `CONFIG.timeZone` to agree with the shipped
config, a zone of its own where the subject *is* two zones disagreeing, as in `upcoming-events.test.js`.

Where a fixture *constrains* the zone, assert the property rather than trusting the literal: `reseed` in
`seed-carry-over.test.js` spells midnight UTC, so a zone west of UTC reads a day earlier and the carry-over key misses.
It checks each date survives the projection, naming the cause instead of a lost note.

A fake spreadsheet takes its headers from the live `CONFIG.columns`, never from a pasted fixture, so a test cannot
quietly drift from the contract it is meant to be relying on. Build the rows the same way, with `rowFor`, so no fixture
spells a column position:

```js
const {rowFor} = require('./helpers/fakes');
rowFor(CONFIG, 'venues', {name: 'Beurs van Berlage', address: 'Damrak 243'});
```

Three options exist for the cases that would otherwise be unreachable:

- `installFakes({ spreadsheet, notified })` — `notified` is an array that collects what the code would have shown a
  maintainer. `notify_` alerts through `SpreadsheetApp.getUi()` and falls back to `console.log` when there is no UI,
  which in a test run is always, so that fallback is the only output `checkData` has. `data-check.test.js` reads its
  whole verdict from it.
- `installFakes({ document, drive })` — `DocumentApp.openById` answers only for the document given, and
  `fakeDrive({ blobs, unreadable })` supplies the logo. `unreadable` is the case worth having: a logo id that no longer
  resolves has to be skipped rather than block the listing, and only a Drive that throws can prove it.
  `drive.recordedSharing` holds every `setSharing` the run made.
- a tab given as `{ rows, headers }` instead of an array — the one way to build a sheet whose header row disagrees with
  the contract, which is what `table_` exists to refuse. Taking the headers from `CONFIG.columns` otherwise makes that
  impossible to express. Use it for that refusal and nothing else: a fixture spelling its own headers for any other
  reason is a copy of the contract, and the copy is what goes stale.

## Adding a test

**Prove it fails first.** When a test covers a bug you have just fixed, put the bug back, watch the test fail, then
restore the fix — it is the only thing that tells you the test is wired to the code. A test wired to the bug fails on
the cases the bug touches and passes the neighbouring ones; a test that fails on all of them is reading its own fixture.

**Assert the silences too.** `checkData` stays quiet about three things on purpose, and a check that starts nagging
about a settled decision is a check people stop reading — which loses every *other* report with it. Each silence in
`data-check.test.js` is asserted beside the report it is the exception to, so removing the guard fails a test rather
than merely making the dialog longer.

**Say what is not covered.** Where a test deliberately leaves a gap, assert the gap — see the last case in
`cross-project-helpers.test.js`. A gap nobody wrote down reads as coverage.

## `scripts/check-formulas.js`

It stays a script and is also part of the suite: `check-formulas.test.js` runs it and fails on its exit code. Run it
directly when you want to *read* what it prints — every formula the build generates, the column letters, the picker
lists, the hygiene checks, the dashboard columns, the protected ranges, and the seed counts:

```sh
node scripts/check-formulas.js
```

What it checks, and what it cannot, is listed in the script's own header — beside the checks themselves, so the list
cannot drift from them. Every setting it reads is documented in [`configuration.md`](configuration.md).

If the suite fails right after you have edited the config, it is almost certainly the sync check among those: run
`./scripts/sync-config.sh`.
