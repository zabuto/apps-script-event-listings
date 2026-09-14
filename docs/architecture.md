# Architecture

## What the thing is

A Google Sheet is the datasource, and three outputs read from it:

```
                    ┌────────────────────────────────┐
                    │  Events · Venues · Organisers  │   maintainers type here
                    │      (one row per event)       │
                    └───────────────┬────────────────┘
                                    │
                   three computed columns, one source
                       ┌─────────────┴─────────────┐
                       │  City · When · Upcoming?  │   formulas, protected
                       └────────────┬──────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
      ┌───────┴───────┐    ┌────────┴────────┐   ┌────────┴─────────┐
      │   Map Export  │    │    Dashboard    │   │ Agenda document  │
      │ (row per date)│    │   (a formula)   │   │ (rebuilt weekly) │
      └───────┬───────┘    └─────────────────┘   └────────┬─────────┘
              │                                           │
     imported by hand into                        read-only link, and
     Google My Maps                               a PDF anyone can take
```

Three roles, because almost every decision below turns on which one is meant:

- **The installer** runs `clasp` and the scaffolding project, owns the files in Drive, and decides who gets access to
  what. One person, usually once.
- **Maintainers** have edit access to the spreadsheet. They type events into it and run the menu items; they never touch
  the code, and the sheet is the only interface they have.
- **Readers** get the map and the agenda document through links, and no access to the spreadsheet — which is why nothing
  they see may come from a column marked private.

Three properties hold the whole design together:

**One source for every derived fact.** The city is looked up from the venue, never typed. *Does this publish?* is a
single column — the map, the document, and the dashboard all read it, so they cannot disagree about what is upcoming.
The dates and names a reader sees come from `Config.gs`, so the three outputs cannot spell a date differently.

**A formula where the sheet can hold the answer.** The dashboard and the computed columns recompute as the events
change; the scripts put one *back*. The map export is the exception: one row per **date** needs the spellings that
collapse here ([`gotchas.md`](gotchas.md)), so its rows are written as values.

**A private column is never read by an output** — not by the map, not the document, not even the `When` string. So what
leaves the sheet is decided per column, in the contract; who may open the sheet in the first place is decided in Drive,
by you, not anywhere in this code.

## The two Apps Script projects

|                       | `bootstrap/`                                  | `src/`                                    |
|-----------------------|-----------------------------------------------|-------------------------------------------|
| Kind                  | standalone                                    | container-bound to the spreadsheet        |
| Purpose               | builds and repairs the sheet                  | ships with the sheet, run from its menu   |
| Who runs it           | the installer, from the Apps Script IDE       | any maintainer, from the spreadsheet menu |
| Travels with the file | no                                            | yes                                       |
| Ever deleted          | not until a rebuild is certainly never needed | never                                     |

The split is not tidiness. A container-bound project cannot exist before the spreadsheet does, so the scaffolding has to
be standalone — and a bound project is part of the file, so anything maintainers must be able to repair has to live
there. That is why the map export is built in `src/`: an export written only by a project that never leaves your Drive
cannot be rebuilt by a maintainer.

`shared/Config.gs` is copied into both by `scripts/sync-config.sh`. Two projects cannot share a file, and the
alternative — two configs that drift — is worse than a copy with a sync script. Each project's `appsscript.json` is
generated the same way, from `shared/appsscript.bootstrap.json` and `shared/appsscript.src.json`: the manifest sitting
in a project directory is a copy, not the original, because that is the one file `clasp` itself rewrites.

## The column contract

Every column has a **key** the code uses and a **header** a human reads:

```js
const CONFIG = {
  columns: {
    events: [
      {key: 'dateStart', header: 'Date Start'},
      {key: 'city', header: 'City', computed: true},
    ],
  },
};
```

Nothing in the codebase spells a column position or letter. Reads go through `columnIndex_()`, formulas through
`columnLetter_()` and `colRange_()`, and the ranges that get protected are derived from which columns are marked
`computed`. So renaming a header, reordering the list, or inserting a column is a config edit; only changing a `key` is
a code change.

Two positions in the list are load-bearing. The computed columns are contiguous and last, because they are cleared,
marked, and protected as one range; and the `(private)` column is the last typed one, so every tab reads left to right
as publishable, then private, then computed.

Dropping two columns from the middle of a lookup tab slides every index after it one over, and a read by position does
not fail when that happens. It answers, wrongly, and a hygiene check that reads the wrong column reports *clean*. Reads
by key cannot do that, and `table_()` refuses to read a tab whose header row does not match the contract at all.

## Where state lives

| State | Where | Why |
|---|---|---|
| Everything nameable | `shared/Config.gs` | one file to fork, no code to read |
| File ids | Script Properties | a repo has no business carrying someone's Drive |
| The spreadsheet id | Script Properties, written by the build | a rebuild needs no edit anywhere |
| The formula separator | Script Properties, measured once per locale | cheaper than probing every run |
| The data | the sheet | it is the authority the moment anyone edits it |
| A copy of the data | `bootstrap/SeedData.gs` | so a rebuild does not lose the manual work |

That last pair is the loop that matters: `seedSheet` writes the seed into an empty sheet, and `captureSheetData` reads
the live sheet back out as pasteable code. The sheet is where maintainers type; the repo is where that survives the
sheet being deleted. Precedence on every seeding run is *sheet → seed → empty*, so the sheet always wins, and the seed
is a floor, never an override.

It is a snapshot of the moment the installer ran it, and only of the columns it is told to capture — no history, nothing
automatic. The spreadsheet is the single point of data in this design; see
[`operations.md`](operations.md#the-sheet-is-the-only-copy).

## Reporting, and why every run is so talkative

Each entry point ends with a dialog listing what it did, read back from the live file rather than assumed from what it
just wrote, because in a spreadsheet almost every failure is silent. A formula stores fine and evaluates to an error. A
validation rule applies to the wrong column. A check collapses and reports clean. Storing something proves nothing, so
the runs report what the cells actually *computed* — and where a formula has more than one plausible spelling, they
render both and say whether the two agree.

The rule the reports follow: **never report a settled decision.** A concept event with no venue yet, a city-only venue
with no address, a past event at a venue that has since closed — all of these are correct. Naming them on every run is
how a report stops being read. They are separated from the things that are actually wrong and labelled as expected.
