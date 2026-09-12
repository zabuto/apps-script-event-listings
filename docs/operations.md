# Running it

Each section says whose job it is. *Maintainers* have edit access to the spreadsheet and work from its menu; the
*installer* owns the files in Drive and the two script projects.

## Day to day — maintainers

**Adding an event.** One row on the events tab. That is the only tab anyone types in. A venue or organiser that is not
in the lookups is *refused* by the dropdown — add it to its own tab first. Never type a city; it fills itself in.

**After changing anything the map shows.** Menu → **Refresh map export**, read the dialog, then re-import the layer in
My Maps. The export tab is a live formula and is already current; the map is the part that is not.

**Re-importing the layer.** In My Maps: the layer's ⋮ menu → **Delete this layer**, then **Add layer** → **Import** →
the spreadsheet → position column `Location`, title column `Title`. Deleting first is not optional: a layer keeps its
own field list and only ever appends to it, so a re-import leaves any dropped column in every popup as an empty row.

**A venue that must not publish its address.** Tick **City only?** on its row in the venues tab and leave the address
empty: the checks stop asking for one, and the map puts the pin on the city. Typing a street number into a row with
that box ticked is reported by **Check data**, and so is a postcode, because both reach the map with the address. The
private notes column is free text nothing reads: notes there are for people, and the box is what the checks read.

**Before publishing anything.** Menu → **Check data**. It reports what is wrong and stays quiet about what is merely
unfinished — a concept event with no venue yet, a city-only venue with no address, and a past event at a venue that has
since closed are all correct, and it says nothing about them.

**The agenda document** rebuilds itself weekly, and on demand from the menu. Nothing may be typed into it: the next run
clears it. Wording belongs in `Config.gs`.

## The weekly trigger — installer

Installed once, from the menu, by whichever account you want it to run as. That is not a preference: a trigger belongs
to the account that installed it, does not travel with the file, and `getProjectTriggers()` returns only your own — so
nobody can see, check, or delete anyone else's.

The practical consequences, so you can decide who presses it:

- Two accounts pressing it means two rebuilds a week. Not destructive — the rebuild is idempotent, so the document ends
  up identical — just invisible and twice the runtime.
- Failure notices go to the account that installed it, and to nobody else.
- If that account later loses access to the file, the weekly rebuild starts failing quietly.

`showConfiguration` in the bound project reports how many triggers the account you are signed in as owns. When the file
changes hands, the old account deletes its own from Apps Script → **Triggers** and the new one presses **Install weekly
refresh** once.

The only quota worth knowing about is Apps Script's own: a consumer account gets 90 minutes of script runtime a day and
20 triggers. A weekly rebuild of the document uses seconds of that, so the ceiling only matters if you start scheduling
more.

## Adding a column to a sheet in use — installer

The build writes row 1 and moves nothing, so insert the column **in the sheet first**, at the position the contract
gives it, and only then run `setupSkeleton`. Against a sheet whose columns do not line up, every column from there
rightwards is relabelled where it stands: values sit one column left of the header describing them, and nothing
afterwards says so — the contract read-back matches and every check reads the wrong column and reports clean. The
private column is the last typed one, so anything inserted before it lands on the notes. Repair it by moving the values
across, not by renaming headers.

## Checking that it is sound — installer

Run `reportState` in the scaffolding project. It reads everything: contracts, volumes, what each computed column
resolves to, every hygiene check, the dashboard, and the protections. It leaves the sheet as it found it — the one thing
it writes is a throwaway `_state_probe` tab, because some of those answers exist only once a formula has been evaluated,
and it deletes it again in a `finally`.

Three things it cannot check, because no script can see them:

- that a typed unknown venue is actually refused — that dialog is UI, so screenshot it once
- that a second account with Editor rights cannot overwrite a generated tab — test it with a second account
- Tools → **Notification settings** → daily digest, which is how a maintainer's edit reaches you

## The sheet is the only copy

There are no backups. This codebase does not make one, does not keep one, and cannot restore one:

- **The outputs are not copies.** The agenda document is cleared and rebuilt from scratch on every run and holds only
  upcoming events. The map export is a formula holding only events with a venue. Neither has ever contained a past
  event, a private note, or anything you deleted.
- **`captureSheetData` is a snapshot, not a backup.** It writes the events and the hand-researched venue and organiser
  columns into `SeedData.gs` as code — enough for `seedSheet` to rebuild a sheet that looks like the one you had — but
  only for the moment you ran it, and only if you then paste and commit the result. Nothing schedules it.
- **`seedSheet` is destructive by design.** It rewrites all three data tabs from `SeedData.gs`. It refuses when it finds
  rows the seed cannot regenerate, which is a guard, not a safety net.
- **Deleting the spreadsheet takes the bound script with it**, because the script is part of the file. The scaffolding
  project in `bootstrap/` survives, which is the only reason a rebuild is possible.

Google's own version history and Drive trash exist and are not managed from here. If the data matters, whatever protects
it is yours to set up.

## When something breaks

The first four are maintainer-fixable from the menu or by a call to the installer; the rest need the scaffolding
project, so they are the installer's.

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard is blank or `#REF!` | an edit landed on top of the results | `repairDashboard` |
| A hygiene check reads empty | the check formula was overwritten | `setupChecks` |
| Export tab has `#` cells | a lookup tab's headers moved | fix the headers, then **Refresh map export** |
| Export tab is empty | nothing is upcoming, or nothing upcoming has a venue | check the dialog — it says which |
| Document has fewer events than the export | it has *more*: venue-to-be-announced rows are off the map | expected |
| Document and sheet disagree on the count | a row reads upcoming but has no real date to sort by | fix the date |
| Menu item answers `Script function not found` | the bound project was not pushed | `cd src && clasp push -f`, reload |
| `Script property … is not set` | the bound project has no ids | [`getting-started.md`](getting-started.md), step 6 |
| Formula reads `#ERROR!` after an edit | wrong argument separator for the locale | let the code write it, not by hand |
| `Project settings not found` from clasp | wrong directory | `cd bootstrap` or `cd src` first |

## Handing it over — installer

The spreadsheet, the bound script, and the agenda document travel together — transferring the file transfers the script,
and the document keeps its id, so every published link keeps working. What does *not* travel:

- **Triggers.** The new owner installs their own; the old owner deletes theirs.
- **The map.** My Maps has no ownership transfer, so it gets rebuilt on the new account and `CONFIG.mapUrl` becomes a
  one-line edit.
- **Personal folders.** The PDF archive folder is one of these — re-point `PDF_FOLDER_ID` or drop it.
- **The scaffolding project.** It stays with you. Nothing in the running system needs it, but it is the only scripted
  path back from an empty spreadsheet, so do not delete it until you are sure.

Move the logo file along too, if there is one: the document reads it fresh from Drive on every run.
