# Event listings — a Google Sheet that publishes itself

A Google Apps Script codebase that turns one spreadsheet of events into three things, none of which have to be
maintained by hand:

- **a map** — an export tab shaped for Google My Maps, with one geocodable line and one popup per upcoming event
- **an agenda document** — a read-only Google Doc, rebuilt weekly, grouped by month, that anyone can read or download as
  a PDF from a link that never changes
- **a dashboard** — three dropdowns, no formulas to touch

The sheet is the only place anyone types. Everything else is derived, and the parts a maintainer is most likely to break
by accident can be put back with one menu item.

**Google and nothing else.** No server, no hosting, no domain, no database, no build step, no API key, no Cloud project,
no billing account. It runs entirely inside a personal Google account — Sheets, Docs, Drive, My Maps, and Apps Script,
all on the free tier, all owned by whoever signs in. The only thing installed anywhere is `clasp`, on your own machine,
to push the code up.

**Noncommercial licence.** [PolyForm Noncommercial 1.0.0](LICENSE) — no commercial use.

## What you get

**In the spreadsheet — what maintainers work in.** Seven tabs: the map export, a read-me, the three you type in, a
dashboard, and a tab of picker lists and hygiene checks. An unknown venue is *refused* by the dropdown rather than
accepted and later reported. The city fills itself in from the venue. A closed venue leaves the picker but keeps its
history. A venue that must not publish its address is one ticked box, and a street number typed onto that row is
reported before the next map refresh. Generated tabs and computed columns are protected, and the dashboard results
carry a second, warning-only protection on top.

**In the menu — what maintainers run.** Check the data, rebuild the map export, rebuild the document, save a dated PDF,
install the weekly trigger. Each one ends with a dialog saying what it actually did — read back from the live file, not
assumed from what it just wrote.

**In the repo — what the installer uses.** A one-off scaffolding project that builds or repairs the whole sheet, a
capture tool that reads the sheet back out as pasteable code so a rebuild does not lose the manual work, and a
`reportState` that checks the lot against what it should be.

## Why it is built like this

One source per derived fact, so the three outputs cannot disagree about a date or about what publishes. Live formulas
rather than snapshots, so the scripts only ever have to put one *back*. No output ever reads a `(private)` column. And
because almost every spreadsheet failure is silent — a formula stores fine and evaluates to an error, a check collapses
and reports clean — every run reports what the cells actually *computed*, while staying quiet about what is merely
unfinished.

The reasoning, the three roles it all turns on, and where state lives: [`docs/architecture.md`](docs/architecture.md).

## Layout

```
shared/Config.gs      every name, label, colour, and column — the only file you have to edit
shared/appsscript.*   each project's manifest, copied in by the sync like the config above
scripts/              sync-config.sh and check-formulas.js: a test that needs no Google account
test/                 the suite — node --test test/
bootstrap/            standalone: builds and repairs the sheet, never leaves the repo
src/                  container-bound: ships with the spreadsheet, run from its menu
docs/                 getting started, configuration, architecture, running it, testing, gotchas
```

Two Apps Script projects, because a bound project cannot exist before its spreadsheet does — and because anything
maintainers must be able to repair has to travel *with* the sheet.

## Getting started

The installer's path: one person, once, about 30 minutes, most of it waiting for Google's permission dialogs. You need a
Google account and `node`. Edit `shared/Config.gs`, push the two projects with `clasp`, run `setupAll`, and import the
map export tab into My Maps.

The commands are in [`docs/getting-started.md`](docs/getting-started.md) and nowhere else, so there is one copy of them
to keep right. Maintainers need none of it: they get edit access to the finished spreadsheet and the `Read me` tab
written into it.

```sh
node --test test/     # the whole suite
```

**Everything is tested offline — no Google account, and nothing to install.** The suite uses node's own `--test` runner,
so there is no `package.json` and no framework to pull in: clone the repo and run the command. What it covers, what it
deliberately cannot, and how to add a case: [`docs/testing.md`](docs/testing.md).

**Nothing private is in this repo.** Every file id lives in Script Properties rather than in the code, and the sample
events, organisers, and handles are invented. Ten of the twelve sample venues are real and nine carry their published
address, because an invented street does not geocode — a seed full of them would demo the map by showing you an empty
one. [`docs/getting-started.md`](docs/getting-started.md) step 4 has the breakdown.

**The spreadsheet is the only copy of the data.** Nothing here backs it up, keeps a copy, or can restore one, and the
outputs are not copies either. What that means in practice, and what `captureSheetData` does and does not preserve:
[`docs/operations.md`](docs/operations.md#the-sheet-is-the-only-copy).

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | install, both projects, the map, rebuilding from scratch |
| [Configuration](docs/configuration.md) | every setting, and how to adapt it to something other than events |
| [Architecture](docs/architecture.md) | how the pieces fit, and where state lives |
| [Running it](docs/operations.md) | day to day, the weekly trigger, when something breaks, handover |
| [Testing](docs/testing.md) | running the suite, what it covers, what it cannot, how to add a case |
| [Gotchas](docs/gotchas.md) | every trap that cost a debugging session — Sheets, Apps Script, My Maps |

The gotchas page is the part worth reading even if you never run this. Most of what is in it does not raise an error; it
answers, wrongly.

## Requirements

A Google account, and `node` — for `clasp`, and for the test suite.

The build also uses the Sheets advanced service: a checkbox rather than a paid API, declared in the manifest so the push
carries it up. It adds a scope, so Apps Script asks you to authorise once more before it works. Without it the build
completes and says what it skipped.

## Licence and support

[PolyForm Noncommercial License 1.0.0](LICENSE) — use it, change it and share it for any noncommercial purpose: personal
study, hobby projects and testing, and any use by a charitable, educational, public research, health, environmental or
government organisation, whatever its funding. **Commercial use is not permitted under it.** Passing it on, changed or
not, means passing on the terms and the `Required Notice:` line from [`LICENSE`](LICENSE).

**Provided as is. No warranty, no guarantees, no support.** It is published because it might save somebody else the
debugging sessions in `docs/gotchas.md`, not because it is a product. Issues and pull requests are welcome and may sit
unanswered; forking is entirely fine.

---

**Topics**: `google-apps-script` `google-sheets` `google-docs` `google-my-maps` `clasp` `spreadsheet` `events`
`agenda` `no-build` `zero-dependency`
