# Examples

Sample assets, so a fresh install can show a feature working before you have one of your own. Nothing here is read by
the code: an example is a file you copy into your own Drive, never a path the script knows.

## `logo.png`

The optional document logo. Drop it into the project folder under the name `doc.logo.fileName` (`logo.png`), run
`setupDocument`, and put the id it prints into the `LOGO_FILE_ID` script property; the document then reads it fresh
from Drive on every rebuild. Leave the property unset and the document simply starts at its title.

It is a ticket in three of the palette's own colours — `primary` for the tile, `surface` for the ticket, `accent` for
its perforation — so a themed config shows immediately when the logo stops matching the document it heads.

It is square at four times the 64 × 64 pt the document renders it at (`doc.logo.widthPt` / `heightPt`), which is what
keeps the edges clean in a PDF export. Replace it with your own and keep it square: the two dimensions are set
independently, so a rectangular image is stretched rather than fitted.

## `Upcoming Events Doc PDF Export.pdf`

What **Save events PDF** writes, built from the seeded sheet, so it shows the shape of the output rather than anybody's
agenda — the venues are real, the events are not. Your own copy is named from `doc.pdfNamePrefix` and the date of the
run; this one carries a descriptive name instead.

Worth reading it for the things the document does that a description does not convey: a month heading per month, the
`When` column spelling every date the same way the map popup and the dashboard do, an organiser handle as a link, a
concept event listed as venue to be announced, and the brand line in the page footer, which is what carries the name
onto a print-out that has left the building.

It is a snapshot: nothing regenerates it, and the dates in it stay where they are. It is also typeset from the document
the code builds rather than exported by Google, so your own export will not match it pixel for pixel.

## `Upcoming Events Map View.png`

The published My Maps view of the `Map Export` tab, one pin selected. The popup is that tab's columns in sheet order
(`mapExport.headers`) — `Title`, `When`, `Venue`, `Organiser`, `Location` — which is why each one costs a line in
every pin. A name is the date and the title (`mapExport.titleDateFormat`, `titleJoin`); the location carries the city
and ends in the country (`mapExport.countrySuffix`).

Also a snapshot: the pins in the image carry no date, because the layer was imported from an export that had none, and
pin colour, base map and side panel are My Maps' own, set in the map and not in this config.
