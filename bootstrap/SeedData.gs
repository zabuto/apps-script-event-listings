/**
 * The rows a fresh build starts from — **sample data, and nothing real**.
 *
 * Two jobs, and they are the same job:
 *
 *   1. A new install has something to look at. Every branch the code has is exercised by a row in
 *      here: a multi-day run, a venue holding two upcoming events, a city-only venue with no street
 *      address, a venue with no postcode, a closed venue with a past event, a cancelled event, a
 *      concept event with no venue yet, and one with no date at all.
 *   2. Once it is *your* data, this file is where it survives a rebuild. `captureSheetData` reads the
 *      live sheet and prints these three functions back out, ready to paste over the ones here.
 *
 * Precedence on every seeding run: what the sheet already holds → what is seeded here → empty. The
 * sheet always wins and this file is a floor, never an override.
 *
 * The private note columns carry seeded sample lines like everything else here, and what a
 * maintainer types outranks them: `seedSheet` harvests those notes before it clears a tab and writes
 * them back onto the regenerated rows. No output reads them.
 *
 * **The venues are real, the rest is not.** Ten of the twelve are actual theatres, concert halls and
 * conference centres in and around Amsterdam, with their published visiting addresses and their own
 * websites, because an invented street does not geocode — a first map import would put every pin
 * nowhere at all, which makes the one output worth showing off useless. Addresses of public venues
 * are public information; nothing here is anybody's home.
 *
 * The events, the organisers and their handles *are* invented, as are the two venues that
 * demonstrate a privacy case. No row here claims that something is really on, and no handle points
 * at a real person.
 *
 * Four cities — Amsterdam, Amstelveen, Diemen and Zaandam — so the dashboard's city filter has
 * something to filter and the map has pins that are not all in one place. `Touring Revue` plays three
 * of them on three dates, which is what the city-in-the-map-title rule exists for: the layer panel
 * lists titles and nothing else, so without the city those three rows would be indistinguishable.
 */

/**
 * Dates as offsets from today rather than fixed calendar dates.
 *
 * A seed with hardcoded dates is a seed that goes stale: install it a year later and every "upcoming"
 * event is in the past, so the map, the document and the dashboard all come up empty on a build that
 * worked perfectly. Offsets keep a first run interesting whenever it happens.
 *
 * Your own captured data will be fixed ISO dates, which is correct — those are real events.
 */
function inDays_(offset) {
  const day = 24 * 60 * 60 * 1000;
  const then = new Date(new Date().getTime() + offset * day);
  return Utilities.formatDate(then, CONFIG.timeZone, 'yyyy-MM-dd');
}

/** Organiser names — the lookup keys the events reference. Spellings are verbatim, whatever they are. */
function seedOrganisers_() {
  return [
    'Aurora Collective',
    'Bluebird Revue',
    'Company Example',
    "Dana O'Hare",
    'Northside Youth Theatre',
    'Studio Zuid',
  ];
}

/**
 * Venues: name, city, notes. The city is the municipality, not the district — it is what the geocoder
 * and the city filter both read.
 *
 * Ten of the twelve are real, and named as they name themselves; the two invented ones are last and
 * each says so. `'t Blauwe Theehuis` keeps its leading apostrophe for a reason beyond accuracy: a
 * venue name is a lookup key, and `setValues` swallows a leading apostrophe as the literal-text
 * marker unless it is doubled — landing the row as `t Blauwe Theehuis` and silently unhooking every
 * event naming it. `literal_()` handles that, and this row is what proves it still does.
 */
function seedVenues_() {
  return [
    ["'t Blauwe Theehuis", 'Amsterdam', 'In the Vondelpark. Spelled with its apostrophe'],
    // Named *Amsterdam* Bostheater and standing in Amstelveen: this column is the municipality, not
    // whatever the venue calls itself. The city drives the filter and the geocoded line, so taking it
    // from the name would put this pin in the wrong town.
    ['Amsterdam Bostheater', 'Amstelveen', 'Open air, in the Amsterdamse Bos'],
    ['Beurs van Berlage', 'Amsterdam', 'Conference centre — several halls, one address'],
    ['Boom Chicago', 'Amsterdam', ''],
    ['Koninklijk Theater Carré', 'Amsterdam', ''],
    ["Muziekgebouw aan 't IJ", 'Amsterdam', ''],
    ['RAI Amsterdam', 'Amsterdam', 'Conference centre'],
    // The address below is the one this venue publishes while its own building is being renovated. A
    // venue that moves is exactly why addresses are maintained in the sheet and not in code.
    ['Schouwburg Amstelveen', 'Amstelveen', 'Playing at a temporary location during a renovation'],
    ['Theater De Omval', 'Diemen', ''],
    ['Zaantheater', 'Zaandam', ''],
    // Invented, and deliberately so: a venue that carries a city and nothing more. What makes it
    // one is the ticked `City only?` box in `seedVenueDetails_`, not this note.
      ['Living Room Sessions', 'Amsterdam', 'House show — ask the organiser'],
    // Invented as well. Its only event is in the past, so a closed venue never reaches the map.
    ['Zaal Zeeburg', 'Amsterdam', 'Closed, kept for its history'],
  ];
}

/**
 * The hand-researched venue columns, keyed by venue name.
 *
 * `status` and `cityOnly` are in here because closing a venue and declaring one city-only are human
 * decisions nothing can regenerate: the seeding step carries them over from the sheet, and
 * carry-over is lost the moment the spreadsheet is deleted — which is exactly the case this file
 * exists for. Both are omitted where they hold their default, so a closed venue and a city-only one
 * are impossible to miss.
 */
function seedVenueDetails_() {
  return {
    // Eight complete addresses. These are what actually plot: address + postcode + city + country is
    // the line the map export builds, and it is the only form that lands a pin on the door.
    "'t Blauwe Theehuis": { address: 'Vondelpark 5', postcode: '1071 AA', url: 'blauwetheehuis.nl' },
    'Amsterdam Bostheater': { address: 'De Duizendmeterweg 7', postcode: '1182 DC', url: 'bostheater.nl' },
    'Beurs van Berlage': { address: 'Damrak 243', postcode: '1012 ZJ', url: 'beursvanberlage.com' },
    "Muziekgebouw aan 't IJ": { address: 'Piet Heinkade 1', postcode: '1019 BR', url: 'muziekgebouw.nl' },
    'RAI Amsterdam': { address: 'Europaplein 24', postcode: '1078 GZ', url: 'rai.nl' },
    'Schouwburg Amstelveen': { address: 'Uilenstede 106', postcode: '1183 AM', url: 'schouwburgamstelveen.nl' },
    'Theater De Omval': { address: 'Ouddiemerlaan 104', postcode: '1111 HL', url: 'theaterdeomval.nl' },
    'Zaantheater': { address: 'Nicolaasstraat 3', postcode: '1506 BB', url: 'zaantheater.nl' },

    // A postcode nobody has looked up yet. The incomplete rule paints this row until a maintainer
    // does, and the pin still lands correctly — street plus city is enough for the geocoder — which
    // is why that rule is a nudge rather than an error.
    'Koninklijk Theater Carré': { address: 'Amstel 115-125', url: 'carre.nl' },

    // No address at all, and *not* by design: this is the row the address worklist exists for. Its
    // pin lands on the city centre until a maintainer fills it in, and the map refresh names it as
    // approximate rather than leaving you to notice it.
    'Boom Chicago': { url: 'boomchicago.nl' },

    // No address either, but on purpose: the ticked box is what keeps every check quiet about it,
    // and what makes a street number typed into this row a reported breach. A house show carries the
    // city, and the organiser is how a reader finds the rest.
    'Living Room Sessions': { cityOnly: true },

    // Closed — the one row the `status` field described above exists for.
    'Zaal Zeeburg': { status: 'Closed' },
  };
}

/**
 * The hand-researched organiser columns. Handles are stored bare, without the `@`.
 *
 * Invented, unlike the venues, so the handles are invented with them. The document turns a handle
 * into a link, and `.example` is a reserved documentation TLD, so an invented one cannot land on
 * somebody's real account by coincidence. Two organisers have no handle at all, which is what proves
 * the document omits the line rather than printing a dangling separator.
 */
function seedOrganiserDetails_() {
  return {
    'Aurora Collective': { social: 'aurora.collective.example', website: 'aurora.example' },
    'Bluebird Revue': { social: 'bluebird.revue.example' },
    'Company Example': { website: 'company.example' },
    'Northside Youth Theatre': { social: 'northside.youth.example', website: 'northside.example' },
  };
}

/**
 * Events: start, end, title, venue, organiser, status, private note.
 *
 * There is no ticket link and no public remarks column: the outputs say what, where and who, and
 * leave the reader to reach the organiser. Wording for a vague date therefore lives in the private
 * note, which nothing publishes.
 */
function seedEvents_() {
  const status = CONFIG.values.eventStatus;
  return [
    // ── past: kept, and greyed out by the conditional formatting
    [inDays_(-30), '', 'Winter Warm-Up', "Muziekgebouw aan 't IJ", 'Aurora Collective', status.confirmed, ''],
    [inDays_(-7), inDays_(-6), 'Spring Weekender', 'Beurs van Berlage', 'Company Example', status.confirmed, ''],
    // A past event at a venue that has since closed. History is allowed to name it: the venue cell is
    // struck through, the row is not an error, and no check complains.
    [inDays_(-3), '', 'Farewell Matinee', 'Zaal Zeeburg', 'Bluebird Revue', status.confirmed, ''],

    // ── upcoming: these are what the map, the document and the dashboard publish
    [inDays_(3), '', 'Open Stage', "'t Blauwe Theehuis", 'Studio Zuid', status.confirmed, ''],

    // One title, three cities, three dates. On the map these become "Touring Revue — Zaandam" and so
    // on, because the layer panel lists titles and nothing else; in the document they are three
    // separate lines under their own months. It is also what makes the city filter worth having.
    [inDays_(7), '', 'Touring Revue', 'Zaantheater', 'Bluebird Revue', status.confirmed, ''],
    [inDays_(9), '', 'Touring Revue', 'Theater De Omval', 'Bluebird Revue', status.confirmed, ''],
    [inDays_(12), '', 'Touring Revue', 'Schouwburg Amstelveen', 'Bluebird Revue', status.confirmed, ''],

    [inDays_(10), inDays_(11), 'Two-Day Conference', 'RAI Amsterdam', 'Company Example', status.confirmed, ''],
    // Open air, and in a different municipality from its own name — see seedVenues_.
    [inDays_(18), inDays_(19), 'Midsummer Night', 'Amsterdam Bostheater', 'Aurora Collective', status.confirmed, ''],
    // A city-only venue: the pin lands on the city, deliberately, and there is no street address to
    // leak in the first place.
    [inDays_(14), '', 'House Concert', 'Living Room Sessions', "Dana O'Hare", status.confirmed, ''],
    // Its venue has no address in the sheet yet, so this one geocodes by venue name and lands on the
    // city centre — and the map refresh names it rather than letting you find out from the map.
    [inDays_(21), '', 'Improv Night', 'Boom Chicago', 'Northside Youth Theatre', status.confirmed, ''],
    // The venue with no postcode: marked incomplete in the sheet, and still plots correctly,
    // because street plus city is enough for the geocoder.
    [inDays_(28), '', 'Autumn Revue', 'Koninklijk Theater Carré', 'Bluebird Revue', status.confirmed, ''],
    [inDays_(35), '', 'Late Show', 'Beurs van Berlage', 'Aurora Collective', status.confirmed, ''],

    // Two venues carrying two upcoming events each. The export writes a row per event, so both pins
    // share one coordinate and the layer panel tells them apart by title; the document lists them as
    // two lines in date order, never grouped under their venue.
    [inDays_(16), '', 'Youth Matinee', 'Zaantheater', 'Northside Youth Theatre', status.confirmed, ''],
    [inDays_(24), '', 'Makers Market', 'Beurs van Berlage', 'Studio Zuid', status.confirmed, ''],

    // ── the edges
    // Cancelled: struck through, counted nowhere, and visible only where everything is visible.
    [
      inDays_(42),
      '',
      'Cancelled Try-Out',
      "Muziekgebouw aan 't IJ",
      'Studio Zuid',
      status.cancelled,
      'Cancelled by the organiser',
    ],
    // Announced before the room was booked: the document lists it as venue to be announced, the map
    // leaves it out, and neither is a mistake.
    [inDays_(60), '', 'Winter Tour', '', 'Bluebird Revue', status.concept, 'Venue still being booked'],
    // No date at all. Kept rather than invented — it simply does not publish until it has one.
    ['', '', 'Next Season Preview', 'RAI Amsterdam', 'Company Example', status.concept, 'Dates not settled yet'],
  ];
}
