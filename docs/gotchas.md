# Gotchas

Every item here cost a debugging session. Each names the failure *and* what it looks like when it happens — because most
of these do not raise an error. They answer, wrongly.

## Google Sheets formulas

**`setFormula` does not translate argument separators.** A sheet whose locale wants `;` stores a comma-separated formula
verbatim and then evaluates it to `#ERROR!`. Storing always succeeds, so nothing raises. Every formula here is written
US-style and passed through `setFormula_()`, which translates only separators outside string literals — so a comma
inside `", Netherlands"` survives. The separator is *measured* on a throwaway tab and cached per locale, never assumed:
`argSeparator_()`.

**`LET` collapses arrays, and `IFERROR` hides it.** The tidy spelling of both the map export and the dashboard filter —
one `LET`, names holding arrays, `INDEX` or `XLOOKUP` over them — returns the right row count with `#VALUE!` in every
looked-up column, or `#N/A` for the whole thing. One term collapsing to its first element zeroes the entire product, and
the `IFERROR` wrapper presents that as something tidy. Both formulas are therefore written flat, with direct range
references, and every lookup sits inside a `LAMBDA` where its argument is a single value.

*What it looks like when it happens* differs by output, which is most of why it is hard to place. The dashboard's
wrapper falls back to `"no matches"`, so a collapsed filter reads as *nothing matched your dropdowns* —
indistinguishable from a Scope and City that genuinely select nothing. The map export's wrapper falls back to `""`, so
the tab is simply **empty**, exactly what a sheet with nothing upcoming looks like. Neither presentation says *error*,
and the row count is right in both, so counting rows will not tell you either.

*Only the dashboard proves it on every run.* `dashboardFilterLet_()` is kept solely as the counter-example, and
`probeFilterTerms_()` renders it beside the shipped spelling on every `setupDashboard` run, so the difference stays
visible rather than becoming folklore. The map export has no `LET` spelling kept and no probe of its own:
`refreshMapExport` instead reads back every computed cell of every row, counts the ones starting with `#`, and says **DO
NOT IMPORT** when it finds any. If you are debugging the map export, that report is the instrument — not the tab, which
looks fine while being wrong.

**A conditional format rule may not reference another sheet.** The sheet rejects the rule when it is *set*, not when it
is evaluated: `Conditional format rule cannot reference another sheet`. `INDIRECT` resolves the name at evaluation time,
so the stored rule carries no cross-sheet reference — which is how the closed-venue strikethrough works, and why the
other rules read a computed column instead of looking anything up themselves.

**An array formula refuses to spill over existing data.** It reports `#REF!` instead. So every block an array formula or
a `FILTER` writes into is cleared *first* — that is what makes `repairDashboard` able to repair anything: after a stray
paste into the results, re-setting the formula alone would only yield `#REF!` again.

**`getLastRow()` lies on a tab fed by a formula.** An array formula returns `""` for every empty row, an empty string is
a value, and the sheet duly reports a thousand rows. Count non-empty cells instead: `countFilled_()`.

**`COUNTA` counts a "no matches" string as one row.** Hence the explicit zero in the dashboard count. And count the
*title* column, not the date column: a dateless event is still a row.

**`TEXT(…,"ddd d mmm yyyy")` follows the sheet's locale.** A sheet set to Dutch renders `di 13 jan 2026` while the rest
of the output is in English. The `When` column spells its own names through `CHOOSE`, from `CONFIG.values.dayNames` and
`monthNames`. `CHOOSE` does expand inside `ARRAYFORMULA` — measured on every run by `probeWhen_()`, which renders the
same block twice, through `CHOOSE` and through `MID`, and reports any row where the two disagree.

**`COUNTIFS` broadcasts an array criterion reliably only under `ARRAYFORMULA`.** Inside `FILTER` it can collapse to a
single value and report clean for every row — a false negative, invisible while nothing is wrong. The closed-venue check
uses `XLOOKUP` inside `ARRAYFORMULA` for that reason.

**Array literals use a *different* locale-dependent separator again.** `{"a","b"}` is not portable and this codebase
does not translate it. Where a set of phrases has to be tested, the formula is built as an `OR(…)` over individual
`SEARCH` calls instead.

**A quote in a config value closes the string literal it was interpolated into.** Sheets escapes a quote by doubling it,
so a status renamed to `Confirmed ("provisional")` builds `F2:F="Confirmed ("provisional")"` and the cell holds a parse
error, or worse, a formula that parses into something else. The offline check cannot catch it either: doubling a quote
leaves the *count* even, so balanced-quote counting sees nothing wrong. Every `Config.gs` value that reaches a formula
therefore goes through `quoteLiteral_()`, which doubles what is inside and wraps the rest. Only the vocabulary the code
itself owns — the dashboard's `"no matches"`, operators like `"<>"` — is spelled inline, because no setting can reach
it.

**`ISDATE` does not vectorise inside `SUMPRODUCT`.** It answers 0 for perfectly good dates. Use `COUNT` for "how many of
these are real dates", or `ISNUMBER` per row.

**Multiplying two ranges outside `ARRAYFORMULA` gives `#VALUE!`.** In a probe that is a fact about the probe, not about
the data. `SUMPRODUCT` is the shape that works.

## Data validation and protection

**Strict validation makes `setValues` throw.** A rule left on a column that has since changed meaning does not sit there
harmlessly — it blocks a script from writing the column that took its place. Every setup step clears validation before
setting it, including past the current contract.

**A range's editor list cannot lock out the owner.** For whoever owns the file, a range protection is decoration: a
stray Delete over the dashboard results takes out the filter formula. A **warning-only** protection is the one kind the
sheet also applies to the owner, and it stacks with the editor restriction rather than replacing it — so the results
block carries both.

**A validation source that runs to the bottom of the sheet offers a trailing blank as a choice.** A list of fixed values
gets an exact range; only a formula-fed list is open-ended. `listRange_()` makes that distinction for you.

**A label inside a picker becomes a selectable value.** The human-readable "all venues, closed ones marked" list is
deliberately not a validation source: a value like `Somewhere — Closed, do not use` would validate and then match no
lookup anywhere.

## Apps Script

**An advanced service in the manifest is declared, not authorised.** `clasp push` carries the declaration up and the
editor lists it under **Services**, so everything looks right. But the service adds an OAuth scope, and a project
authorised before that arrived has not consented to it — calls then fail with `Sheets is not defined`, which reads as a
missing service rather than a missing consent, and sends you to the Services list where it plainly is. Run any function
from the editor, accept the prompt, and rerun. Here it costs the workbook default font and the three filter views; both
call sites catch it and say what they skipped, so the build completes either way.

**`clasp create-script` overwrites the `appsscript.json` already in the directory it runs in.** It writes a default of
its own: a US time zone, and a `dependencies` block emptied of the Sheets declaration. Nothing warns, nothing is
reported, and the `clasp push` that follows carries that default up as though it were what the repo says. The editor
then lists no **Services**, `setupAll` completes and reports what it skipped, and the failure looks like a missing
service rather than a file the tooling rewrote under you. Which is why the manifests are canonical in `shared/` and
copied in like the config: run `sync-config.sh` between the create and the push, and the suite fails meanwhile, naming
the file.

**`clasp push` does not move the manifest's `timeZone`, and nothing here reads it.** The server keeps the project's own
value and ignores what you push; pull it back and it still reads the old zone. That is harmless: every `formatDate` is
passed a zone explicitly, the weekly trigger carries `CONFIG.timeZone`, and `TODAY()` follows the **spreadsheet's** zone
that `setupSkeleton` sets. Project Settings offers a list of cities rather than every zone, so the one you want may not
be on it — Amsterdam is not, and Brussels is the same zone. Pick whichever is nearest and move on. `CONFIG.timeZone` and
the spreadsheet are the two that decide what a date means.

**Files are concatenated in an order you do not control, and `const` does not hoist.** A top-level
`const X = CONFIG.a.b` in one file works or throws depending on which file was evaluated first, which is a trap for
whoever renames a file. Everything derived from `CONFIG` here is computed inside a function.

**`getUi().alert()` throws on a scheduled run.** At the *last* line, after all the work is done — so it reads as a
failed refresh while the output is actually fine. `notify_()` catches that and logs instead.

**Execution logs truncate at roughly 8 KB.** The output goes on looking like a complete listing while having dropped
most of it. `captureSheetData` writes its payload to a Drive file and puts only counts and a URL in the log, because
pasting a truncated dump would delete exactly the data the tool exists to preserve.

**A leading apostrophe is swallowed by `setValues`.** It is the literal-text marker, so a venue called `'t Voorbeeld`
lands as `t Voorbeeld` — and it is a lookup key, so everything referring to it silently stops matching. `literal_()`
doubles it. A leading `=` or `+` would be read as a formula; same fix.

**A trashed file still answers to `getFileById` and `getFilesByName`.** Without an `isTrashed()` check, a rebuild
quietly writes into the copy you just deleted.

**Triggers are per account, stack silently, and are invisible to everyone else.** `getProjectTriggers()` returns only
your own. Installing one twice means two runs a week; installing it from a second account means nobody can see or delete
it but that person. `installWeeklyRefresh` deletes before it creates, and names the account it installed under.

**A strict dropdown refuses a script, not only a person.** `setValues` over a range carrying a rule built with
`setAllowInvalid(false)` throws `The data entered in cell D4 does not meet the data validation rules set for this cell`
— it names one cell and writes none of the block, so a whole rewrite dies on one row. The venue dropdown lists only
*active* venues while the seed carries a past event at a venue that has since closed, which is exactly that collision:
the rule is right, the write is right, and the seed writers go through `setValuesPastValidation_`, which suspends the
rule for the width of its write and restores it in a `finally`. Validation constrains a person typing a new row; it is
not a guarantee about values already in cells, and it is never applied retroactively — which is also why recapitalising
a name in a lookup tab leaves existing rows spelled the old way.

**Filter views need the Sheets advanced service.** `SpreadsheetApp` only exposes the single *shared* basic filter — the
opposite of per-user views. Without the service the run says so and carries on.

**The workbook theme cannot be patched field by field.** Sending only `primaryFontFamily` is rejected with
`All theme color types must be set`, and a `spreadsheetTheme` field mask is rejected outright. Read the theme, change
one field, send it back whole.

**`clasp` cannot create a container-bound project, and must not clone into one.** Create it once from the spreadsheet
(Extensions → Apps Script), copy the script id into `src/.clasp.json` by hand, and push. `clasp clone-script` would
overwrite your local files with the browser's empty stub.

## Google My Maps

**It imports the *first* sheet and offers no way to pick another.** So the map export tab must be tab 1. Reorder the
tabs and the next refresh imports whatever is there — a read-me, geocoded.

**A layer keeps its own field list and only ever appends to it.** Removing a column from the export does not remove it
from the popup: a re-import leaves the old field there as an empty row in every popup. Delete the layer and add it
again.

**Every imported column becomes a labelled row in the popup, in sheet order.** There is no way to hide one, so each
column costs a line in every popup. That is why the city is appended to the title instead of being its own column — and
why the export is five columns, not the eleven the sheet has.

**The layer panel lists titles and nothing else.** A touring show makes that list unreadable: a dozen identical rows
with no way to tell one town from the next. Hence the city in the title.

**A row with no address still maps** — onto the city centre. Not a failure, and not obvious either, so
`refreshMapExport` names every event whose pin is approximate.

**Only a URL carrying a scheme gets linkified.** `https://` is added in the formula when the stored value does not have
it, because URL columns tend to be filled in as bare hosts.

**With nothing upcoming, `FILTER` returns `#N/A`** and the import source becomes an error rather than an empty tab.
Hence the `COUNTIFS` guard around the whole export formula.

## Privacy

**A decision a check acts on is a value, never a phrase in free text.** Text matching fails in both directions and the
two cannot be fixed at once. A substring flags whatever merely contains it: look for `huis` and every venue whose name
ends in `-huis` is flagged, which compound-friendly languages make a certainty. A whole phrase misses instead: it does
not read the *not* in front of it, and the maintainer who writes the same thing in their own words gets nothing. A
check that flags correct rows is one maintainers stop reading; a check that misses a flag publishes an address. So a
decision gets a column with a single value that carries it — here the `City only?` tick box, which the conditional
format tests as `=TRUE`, the address worklist as `<>TRUE`, and `cityOnlyVenue_` compares strictly against `true` in
both projects. Text in the cell is a tick in none of them, which matters because `Boolean('FALSE')` is `true`: a reader
looser than this exempts a venue the sheet goes on nagging about, and takes the street-number report off the same row.

**A private column is one edit away from being published.** The rule here is absolute: no output reads a `(private)`
column — not the map, the document, the dashboard, or the `When` string. Wording that has to be published lives in
`Config.gs`; wording that must not lives in the sheet. No formula reads one either, not even the ones that never leave
the sheet: the venues rules and the hygiene checks are held to the same rule in `privacy.test.js`, so a note is never
the thing a rule happens to be looking at when somebody extends it into an output.

**A city-only venue with a street number is the shape a leak takes.** It goes public at the next map refresh, so
`checkData` reports it as an issue rather than a note.

**The document's meta line and footer carry the map URL into every downloaded PDF.** An `/edit` URL is not a link to the
map, it is an invitation to edit it — which is why `CONFIG.mapUrl` asks for the `/view` form. Drop the `&ll=…&z=…` a
browser leaves on it too: that is the viewport somebody happened to be looking at, and it goes stale the next time
anyone pans the map.
