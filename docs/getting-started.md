# Getting started

**This is the installer's path — one person, once.** Maintainers never do any of it: they get edit access to the
finished spreadsheet, and the `Read me` tab in it is written for them. Readers get two links and no access at all.

About 30 minutes, most of it waiting for Google's permission dialogs. You need a Google account and `node`. No Cloud
project, no API key, no billing.

## 1. Install clasp

[`clasp`](https://github.com/google/clasp) is Google's Apps Script CLI. It lets the `.gs` files live in this repo and be
pushed into an Apps Script project, instead of being pasted through the browser.

```sh
npm install -g @google/clasp
clasp login
```

Then enable the Apps Script API for your account, once, at <https://script.google.com/home/usersettings>. Without it
every push fails with a permissions error that does not mention this setting.

`push`, `pull`, and `clone` need nothing else. Only `clasp run` — executing a function remotely — needs a Cloud project
attached, and this codebase never uses it.

## 2. Make it yours

Edit `shared/Config.gs`: at minimum `brand`, `spreadsheet.folderName`, `spreadsheet.fileName`, `spreadsheet.locale`, and
`timeZone`. Everything in there is a name, a label, or a colour — see [`configuration.md`](configuration.md). Then:

```sh
./scripts/sync-config.sh          # copies the config into both projects; run it after every change
node scripts/check-formulas.js    # rebuilds every formula from your config, offline
```

If you renamed something into a state the code cannot build, the second command is where you find out, rather than in a
cell.

Leave `.clasp.json` alone for now: the next step writes `bootstrap/.clasp.json` for you, and `src/` gets one by hand in
step 5. Both are gitignored, because each pins one specific Apps Script project — the `.clasp.json.example` files are
there for when you are pointing a fresh checkout at projects that already exist.

## 3. The scaffolding project

```sh
cd bootstrap
clasp create-script --type standalone --title "Event Listings — build" --rootDir .
```

`create-script` writes the script id into `.clasp.json`, and overwrites `appsscript.json` with a default manifest of its
own. Sync puts the repo's back, so run it before pushing: otherwise the push carries that default into the new project
and `Sheets` arrives undeclared — see [`gotchas.md`](gotchas.md).

```sh
../scripts/sync-config.sh
clasp push -f
clasp open-script
```

`-f` is needed because the manifest is part of the push.

In the IDE that opens:

1. Check that **Sheets** is in the **Services** list. The manifest declares it, so it should be. If not, add it:
   Services → **+** → **Google Sheets API** → Add. It is called *Google Sheets API* in the picker and appears as
   *Sheets* afterwards. Without it the build still completes and says what it skipped.
2. Run **`setupAll`** from `bootstrap/SetupAll.gs`. Google asks for permissions the first time. The run ends with a
   dialog listing what it did, and the spreadsheet URL.

If the run reports `Sheets is not defined` while the Services list plainly shows it, the service is declared but not yet
authorised. Run any function from the editor, accept the prompt, and run `setupAll` again.

The sheet is now built and empty. Step 4 fills it with sample rows and is optional — skip to step 5 to go straight to
your own data.

## 4. Sample data — optional

Run **`seedSheet`** from `bootstrap/ToolSeed.gs` to fill the three data tabs with example rows, so you can see the map,
the document and the dashboard with something in them.

**Only on a sheet nobody has typed into yet.** It rewrites all three tabs, and refuses to run if it finds rows it cannot
regenerate — so on a sheet in use it stops rather than deletes.

The rows are made to be imported, not just read: most venues are real and carry a published address, so the map in
step 8 puts real pins on real doors. A few are deliberately incomplete — no address, city only, closed — to show what
the checks and the map report say about missing data. The events and organisers are invented.

To swap in your own: fill in the sheet, run `captureSheetData`, and paste its output over the three functions in
`SeedData.gs`.

## 5. The bound project

This one cannot be created by clasp, because a container-bound project needs its container to exist first. So it starts
in the browser, once:

1. Open the spreadsheet the build just created → **Extensions → Apps Script**. That creates the bound project.
2. **Project Settings** → copy the **Script ID**. Ignore the time zone on that page: nothing reads it, and its list of
   cities may not even offer yours. See [`gotchas.md`](gotchas.md).
3. Point clasp at it *without cloning*, and push:

   ```sh
   cp src/.clasp.json.example src/.clasp.json
   $EDITOR src/.clasp.json          # paste the script id; gitignored, like bootstrap's
   cd src && clasp push -f
   ```

The new bound project opens with a `Code.gs` holding an empty `myFunction()`. Leave it: the push overwrites it. Naming
the project is worth a moment, since an untitled one is hard to find later and trigger failure emails quote the name.

**The id must be the bound project's, not the scaffolding's.** They look alike, and pasting the wrong one is silently
destructive: `.claspignore` sends only its own directory's files, so the push replaces everything else in whichever
project it reaches. You get a bound project still holding its stub, no menu, and a scaffolding project with its setup
steps gone. `sync-config.sh` refuses when both `.clasp.json` files name the same id, so run it before you push.

**Do not `clasp clone-script` into `src/`.** Clone overwrites local files, and the repo is the truth — cloning would
replace `Code.gs` with the browser's empty stub. Writing the script id by hand is the whole of what clone would have
been for.

A bound project does not appear in `clasp list-scripts`; that only returns standalone projects, which is why its id has
to come off the Project Settings page.

## 6. Point the bound project at its files

The scaffolding's `setupDocument` printed two or three ids. Put them into the **bound** project: Extensions → Apps
Script → **Project Settings** → **Script Properties** → Add script property:

| Property        | Value                          | Required                              |
|-----------------|--------------------------------|---------------------------------------|
| `EVENTS_DOC_ID` | the agenda document            | yes, for the document functions       |
| `PDF_FOLDER_ID` | the archive folder             | only for `saveEventsPdf`              |
| `LOGO_FILE_ID`  | an image in the project folder | no — the document builds without one  |
| `MAP_ID`        | the published map, from step 8 | only for the map link in the document |

Run `showConfiguration` in that project to check: it prints each property and what the id resolves to, so an id from the
wrong account shows up immediately.

## 7. Use it

Reload the spreadsheet. It now has your configured menu, with:

- **Check data** — unknown venues and organisers, dates the wrong way round, missing addresses, an `@` in a handle,
  events booked into a closed venue.
- **Refresh map export** — rebuilds the export tab and reports whether it is safe to import.
- **Generate events document** — rebuilds the agenda document from every upcoming event.
- **Save events PDF** — optional, a dated copy in the archive folder. `examples/` holds one, built from the seed data.
- **Install weekly refresh** — the trigger that keeps the document current. A trigger belongs to the account that
  installs it and is invisible to every other account, so it matters *who* presses it; see
  [`operations.md`](operations.md).

## 8. The map

The map is the one part that is not scripted, because My Maps has no API:

1. <https://www.google.com/mymaps> → **Create a new map**.
2. **Import** → the spreadsheet → it imports the **first** tab, which is the export tab.
3. Position column: **Location**. Title column: **Venue**.
4. Style the pins and name the layer, then set the map's sharing to whatever it should be — a public link, a named list,
   or nothing yet. My Maps has no API, so no part of this codebase can read or change that.
5. Copy the `mid=` value out of the map's URL — the id alone, without the `&ll=…&z=…` tail the browser appends — and
   put it into the bound project as the `MAP_ID` script property.

The property holds the id, never a URL: the code composes the **`/view`** address around it, so the link in the document
and in every downloaded PDF cannot be the `/edit` one. `showConfiguration` prints the address it composes. Without
`MAP_ID` the line is omitted and the document builds regardless.

## Rebuilding from scratch

Every step is idempotent, so this is a supported path rather than a disaster recovery:

1. Run `captureSheetData` and paste its output into `bootstrap/SeedData.gs`. Do this **first** — it is the only copy of
   the hand-entered columns once the spreadsheet is gone.
2. Delete the spreadsheet (and empty the trash — a trashed file still answers to its name).
3. Run `setupAll`, then `seedSheet`.
4. Re-create the bound project as in step 5, and set its properties again.

The agenda document and its id survive all of that, which is the point: the link in a bio or a newsletter never has to
change.
