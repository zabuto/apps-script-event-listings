# Configuration

Everything nameable lives in one file: [`shared/Config.gs`](../shared/Config.gs). Nothing in it is a secret, and there
is nothing to configure anywhere else.

```sh
$EDITOR shared/Config.gs
./scripts/sync-config.sh            # copies it into both projects
node scripts/check-formulas.js      # rebuilds every formula and checks it, offline
(cd bootstrap && clasp push -f)
(cd src && clasp push -f)
```

The copies in `bootstrap/` and `src/` are generated, `appsscript.json` among them. Editing one of those directly means
the next sync silently overwrites your change.

## What each section does

| Section         | What it controls                                                                 |
|-----------------|----------------------------------------------------------------------------------|
| `brand`         | the name in the document and footer, its tagline, and the spreadsheet menu       |
| `timeZone`      | passed explicitly to every date format — do not rely on the manifest             |
| `mapUrl`        | the published map's **`/view`** URL. Empty means the line is omitted             |
| `social`        | the label reports use for handles, and the profile URL they are appended to      |
| `style`         | one font, one size floor, and eleven colour *roles*                              |
| `spreadsheet`   | folder and file name, locale, date format                                        |
| `tabs`          | tab names — **and their order**, which is load-bearing                           |
| `columns`       | the column contracts, by key and header                                          |
| `values`        | the strings the statuses and computed columns use, in formulas and in code       |
| `mapExport`     | the five popup column labels, the country suffix, the title separator            |
| `doc`           | the document's file name, title, wording, margins, logo and PDF archive          |
| `weeklyRefresh` | which day and hour the document rebuilds itself                                  |
| `properties`    | the *names* of the Script Properties that hold file ids — not the ids            |

## The things that are not just labels

**`tabs` order.** The map export tab must stay in position 1, because My Maps imports the first sheet and offers no way
to pick another. The build enforces the order on every run and says which tab ended up first.

**`values`.** These strings are compared in formulas *and* in JavaScript, in *both* projects. Change one, sync, and push
both — a status the sheet writes, but the bound script does not recognise fails quietly, in the direction of publishing
nothing.

**`columns`.** `key` is the name the code uses; `header` is what a human reads. Rename a header, reorder the list, or
insert a column, and everything follows — reads, formulas, protected ranges, and the read-me all derive from this list.
Changing a **key** is a code change: grep for it first.

Adding a column is a config edit plus a re-run of `setupSkeleton` (headers, formats, and protections) and
`setupChecks`. Two positions are fixed: the `computed: true` block is contiguous and last, so those columns may only
be reordered among themselves, and the `(private)` column is the last non-computed one — a new typed column goes
*before* it, not after, where it would read as part of the generated block. On a sheet that already has rows, reordering
typed columns moves the headers and not the values, so move the data across in the same pass, or the two disagree
silently.

**Where the city-only decision lives.** In the sheet, not here: it is the `City only?` box on the venue's own row. One
cell, read by the conditional format, by the address worklist and by `checkData`, so the three cannot come to different
conclusions about the same venue. See [`gotchas.md`](gotchas.md#privacy) for why a decision a check acts on is a value
rather than a phrase anyone has to word.

**`mapExport.headers`.** The labels are yours to change; the *count* is not. Exactly five columns are built — title,
when, venue, organiser, location — and the code refuses to run with a different number rather than mislabelling a popup.
Removing a column from the export also needs a fresh map layer, not a re-import.

**`style.palette`.** Eleven roles, each with one job, so re-theming is this block and nothing else. The starting scheme
is cool blue and neutral; the two light fills mean opposite things and are told apart by hue — `infoFill` for "not
settled yet, and that is fine", `warnFill` for "incomplete, and it needs finishing".

Two conventions are worth keeping if you change the colours. A solid `primary` fill with `surface` text is a header row
or a broken reference, never a warning, so the two cannot be confused at a glance. And colour is never the only signal:
a concept row is filled *and* says `Concept`, a closed venue is struck through *and* says `Closed`, an incomplete
address is filled *and* named in a hygiene check — which keeps the sheet readable printed in black and white. Whether
your outputs need to meet a particular contrast standard is your call, not this codebase's.

**`doc.logo.fileName`.** Optional. Drop an image with that name into the folder the spreadsheet lives in, and step 5
reports its id and digest. The digest matters: the document binds the logo by **id**, so replacing the file later with a
differently-sized image renders a blurry logo and raises nothing. `examples/logo.png` is one to try it with,
drawn in the palette's own colours at the size the document renders.

## Script Properties

File ids are not configuration — they are one person's Drive. They live in Script Properties, which is also why this
repo can be public without a scrubbing pass.

| Property                 | Project     | Set by                             | Required            |
|--------------------------|-------------|------------------------------------|---------------------|
| `SPREADSHEET_ID`         | `bootstrap` | the build itself                   | automatic           |
| `ARG_SEPARATOR:<locale>` | both        | measured on first run              | automatic           |
| `EVENTS_DOC_ID`          | `src`       | you, from `setupDocument`'s output | for the document    |
| `PDF_FOLDER_ID`          | `src`       | you, from `setupDocument`'s output | for `saveEventsPdf` |
| `LOGO_FILE_ID`           | `src`       | you, if you want a logo            | no                  |

Set them at Extensions → Apps Script → Project Settings → Script Properties. `showConfiguration` in the bound project
prints each one and what it resolves to. It lists `SPREADSHEET_ID` as well, and `(not set)` there is correct rather than
a fault: that one belongs to the scaffolding project, and the bound script never reads it.

The organiser handle column is a separate setting from `social`: its header lives in `columns.organisers` and still
reads `Instagram` until you change it too. Re-pointing `social` at another network is two edits, not one.

## Adapting it to something other than events

The domain shows up in three places, and all three are configuration:

- **The vocabulary.** `columns` headers and `tabs` names. Venues become *rooms*, organisers become *teachers*, events
  become *classes* — a config edit.
- **The lookups.** Two lookup tabs, each keyed by a name column. Anything that is "one row per thing, referenced by name
  from the main tab" fits without code changes.
- **The outputs.** A map needs one geocodable line per row, which is what `mapExport` builds; a listing needs a date to
  sort by and group into months, which is what the document does. If your thing has neither, delete the function and the
  menu shrinks by itself — `onOpen` only offers items whose function exists.

What is *not* configuration: three computed columns with those three meanings (looked-up city, formatted date, publish
flag) and exactly two lookup tabs. Wanting a third lookup is a code change, and a small one — `columns`, a picker in
`listColumns_`, a check in `checkBlocks_`.
