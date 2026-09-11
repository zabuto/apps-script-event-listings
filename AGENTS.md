# Event listings

Google Apps Script. One spreadsheet is the data; it publishes a Google My Maps export tab, a read-only agenda Google Doc
rebuilt weekly, and a dashboard. Two Apps Script projects share one config file. No server, no build step, no
dependencies.

## Layout

| Path | What |
|---|---|
| `shared/Config.gs` | **canonical** config — every name, label, colour, column |
| `shared/appsscript.*.json` | **canonical** manifests, one per project; the copies in `bootstrap/` and `src/` are generated |
| `bootstrap/` | standalone project: builds and repairs the sheet (`Setup1`…`Setup5`, `Tool*`) |
| `src/` | container-bound project: ships with the spreadsheet, run from its menu |
| `scripts/` | `sync-config.sh`, `check-formulas.js` |
| `test/` | the suite: `node --test test/`, with the Apps Script fakes in `test/helpers/` |
| `docs/` | `gotchas.md` is the one to read before touching a formula |
| `examples/` | sample assets to copy into your own Drive, the document logo among them |

Each bootstrap file is named for what you run from it, and the prefix is the promise. A **`Setup*`** builds or repairs
the structure of the sheet, is idempotent, and is safe to run at any time — every one of them is in `setupAll`. A
**`Tool*`** does something other than build: it writes data, writes a file to Drive, or only reads and reports. What
decides the prefix is what the function *does*, not whether `setupAll` happens to call it.

| Run | In | Safe to run |
|---|---|---|
| `setupAll` | `bootstrap/SetupAll.gs` | yes — the build entry point, runs all five steps |
| `setupSkeleton` | `bootstrap/Setup1Skeleton.gs` | yes |
| `setupFormulas` | `bootstrap/Setup2Formulas.gs` | yes |
| `setupChecks` | `bootstrap/Setup3Checks.gs` | yes — touches no data |
| `setupDashboard`, `repairDashboard` | `bootstrap/Setup4Dashboard.gs` | yes |
| `setupDocument` | `bootstrap/Setup5Document.gs` | yes |
| `seedSheet` | `bootstrap/ToolSeed.gs` | **empty sheet only** — rewrites all three data tabs |
| `captureSheetData` | `bootstrap/ToolCapture.gs` | yes — writes one file to Drive |
| `reportState` | `bootstrap/ToolState.gs` | yes — reads the sheet back |

`repairDashboard` is step 4 over a narrower range rather than a tool, which is why it sits beside `setupDashboard` and
shares `writeDashboard_` with it. `test/build-steps.test.js` holds the list of steps and the list of entry points
deliberately outside it, each with its reason. `bootstrap/SeedData.gs` holds data and nothing to run; the shared helpers
live in `bootstrap/Common.gs`. Besides `gotchas.md`, `docs/` holds `getting-started`, `configuration`, `architecture`,
`operations`, and `testing`.

## Commands

```sh
./scripts/sync-config.sh          # REQUIRED after any edit in shared/; also guards the clasp ids
node --test test/                 # the whole suite, offline — run this before any push
node scripts/check-formulas.js    # the formula inventory on its own, for reading
(cd bootstrap && clasp push -f)   # ask a human first
(cd src && clasp push -f)
```

`node --test test/` is the whole suite and includes `check-formulas.js`, which it runs as a subprocess and fails on. Run
the script directly when you want to *read* the formula inventory it prints; run the suite when you want a verdict.
Either one fails when a generated copy differs from its canonical file in `shared/`, so a config edited in one place and
pushed from another, or a manifest `clasp` rewrote, is caught before `clasp` sends it.

**The suite adds no dependency.** `node --test` and `node:assert` ship with node itself, so there is no `package.json`,
no `node_modules` and nothing to install — cloning the repo and running the command is the whole setup. There is no
package manager and no build step, and `node --check` on a copy remains the only syntax check (Apps Script files use the
`.gs` extension).

Tests load the `.gs` files the way Apps Script does — every file of a project into one shared scope — through
`test/helpers/project.js`, and stand in for `SpreadsheetApp` and friends through `test/helpers/fakes.js`. A fake there
does the one thing the code under test asks of it and throws on anything else: a stub that answers plausibly is how a
test passes against behaviour Google does not have. `docs/testing.md` has the rest: running less than everything, what
the suite cannot cover, and how to add a case.

## Rules

Most of these prevent a failure that answers wrongly instead of raising. `docs/gotchas.md` records what each looks like
when it happens, and is where that reasoning belongs.

1. **Never edit a generated copy.** `bootstrap/Config.gs`, `src/Config.gs`, and each project's `appsscript.json` are
   written by the sync, which overwrites them. Edit the file in `shared/`, then run `./scripts/sync-config.sh`.
2. **Never read `CONFIG` at load time.** Every value derived from it is computed inside a function.
3. **A helper that exists in both projects must be changed in both.** Apps Script cannot share a file, so
   `bootstrap/Common.gs` and `src/Code.gs` each carry their own copy of a set of helpers.
   `test/cross-project-helpers.test.js` holds the list, in `EXPECTED_SHARED`, and compares them by behaviour *and* by
   source; a difference that is deliberate goes in its `INTENDED_DIFFERENCES` list, with the reason.
4. **Address columns by `key`**, through `columnIndex_` / `columnLetter_` / `colRange_` / `colLookup_`, plus `colFull_`
   in `bootstrap/`. In `src/`, read rows through `table_`, which refuses a tab whose header row no longer matches the
   contract. Never by letter or position: a shifted column then answers wrongly instead of failing.
5. **The map export tab stays first.**
6. **Write formulas US-style** with `,` and pass them through `setFormula_`, which translates to the sheet's separator.
7. **Do not rewrite the flat map-export or dashboard formulas as `LET`.** `dashboardFilterLet_` is kept solely as the
   counter-example `probeFilterTerms_` renders beside the shipped spelling on every `setupDashboard` run; nothing else
   may adopt that spelling.
8. **No output may read a `(private)` column** — not the map, the document, the dashboard, or the `When` string.
9. **A writer that clears a tab reads it first.** `seedSheet` regenerates the data tabs from `bootstrap/SeedData.gs`, so
   anything typed into a column the seed does not own — private notes above all — is harvested before the clear and
   written back onto the regenerated rows. Clearing first harvests a blank tab: nothing is carried over, and the run
   still reports a plausible count, because the seed supplies notes of its own. `test/seed-carry-over.test.js` holds all
   three writers to it.
10. **File ids live in Script Properties**, never in code — that is what keeps this repo publishable.
11. **Sample data**: real venues, real organisations and their published addresses belong here. An invented street does
    not geocode, so a seed full of them would demo the map by showing an empty one, and a public venue's address is
    public information. The real addresses are verified against each venue's own page; the events, the organisers and
    two of the venues are invented. **Do not add a private individual or a private address.** A fixture that closes a
    venue or cancels an event is exercising that code path, not making a claim: whoever installs this owns whatever
    they then type into their own sheet.
12. **Style**: indent, line width, quotes, line endings, and charset are defined by `.editorconfig`. Read it; do not
    restate its values here or in `docs/`, so there is nothing to drift. The rest is not expressible as editor config:
    V8 JS, private helpers end with `_`, and comments explain *why*, especially where a simpler-looking version silently
    fails.

## Do / Don't

- **Do** read `docs/gotchas.md` before changing a formula, a validation rule, or a protection.
- **Do** keep every entry point idempotent and end it with a report read back from the live file.
- **Do** run `node --test test/` after touching a formula builder, the config, or `src/Code.gs`, and add a case when you
  fix a bug: prove the new test fails against the old code before keeping it.
- **Don't** add a dependency, a build step, or a framework: it must stay runnable with `clasp` alone. Node's built-in
  `--test` runner is not a dependency — it is part of the runtime — but anything that needs `npm install` is, including
  a test framework.
- **Don't** make a decision that belongs to the installer — who has access, how files are shared, what is backed up,
  which contrast standard applies. Those are settings or their call, never behaviour hardcoded here. Three roles, worth
  keeping straight: the **installer** sets it up and owns the files, **maintainers** type into the sheet and use its
  menu, **readers** get the map and the document through links and no access to the sheet.
- **Don't** add employer-, client-, or organisation-specific rules, names, or internal policy to this repo, in this file
  or any other. It is a personal project, published publicly, and everything in it has to make sense to a stranger with
  no connection to anyone. Keep such rules in your own user-level agent config, where they apply to your work without
  shipping with the code.

## Escalation

Ask a human before: `clasp push` or anything that writes to a live spreadsheet, document, or Drive folder; running
`seedSheet` (it rewrites the data tabs); changing `LICENSE`; and anything that leaves the repo — committing, pushing,
publishing.
