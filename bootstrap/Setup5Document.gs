/**
 * Step 5 — the one-time setup for the agenda document.
 *
 * Creates the two Drive files the bound project points at — the document itself and the optional PDF
 * archive folder — sets the page size, margins and sharing, then prints the ids ready to paste into
 * the bound project's Script Properties.
 *
 * Run `setupDocument`. Idempotent: it reuses a document or folder that is already there and never
 * creates a second one. It does **not** write the document's body — `generateEventsDoc` in the bound
 * project owns that, and clears it on every run.
 *
 * Reuse by name is deliberate: a second document with the same name means a new id, and every link,
 * short link and printed PDF then points at the one nobody updates.
 */

/** A4 in points, which is what `Body.setPageWidth` wants: 210 × 297 mm. */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

function setupDocument() {
  log_ = [];

  const ss = openSpreadsheet_();
  const folder = parentFolder_(ss);
  report_('=== the document, the logo and the archive folder ===');
  report_(`Folder: ${folder.getName()} (${folder.getId()})`);
  report_(`Spreadsheet: ${ss.getName()} (${ss.getId()})`);

  const doc = ensureDoc_(folder);
  const logo = findLogo_(folder);
  const pdfFolder = ensurePdfFolder_(folder);

  report_('');
  report_('--- paste these into the BOUND project ---');
  report_('Open the spreadsheet → Extensions → Apps Script → Project Settings →');
  report_('Script Properties → Add script property, once per line:');
  report_(`  ${CONFIG.properties.eventsDocId} = ${doc.getId()}`);
  report_(`  ${CONFIG.properties.pdfFolderId} = ${pdfFolder.getId()}`);
  report_(logo
    ? `  ${CONFIG.properties.logoFileId} = ${logo.getId()}`
    : `  ${CONFIG.properties.logoFileId} = (no logo yet — optional, see above)`);
  report_('');
  report_('--- the three URLs the document is read through ---');
  report_(`  edit:    https://docs.google.com/document/d/${doc.getId()}/edit`);
  report_(`  preview: https://docs.google.com/document/d/${doc.getId()}/preview   ← share this one`);
  report_(`  PDF:     https://docs.google.com/document/d/${doc.getId()}/export?format=pdf`);
  report_('');
  report_('--- still by hand, and only these ---');
  report_('  1. Page numbers in the footer. Apps Script has no page-number element, so Docs has to');
  report_('     insert it — and it has to happen AFTER the first "Generate events document" run,');
  report_('     because that run writes the credit line and then never touches an existing footer.');
  report_('     Put the cursor at the end of the credit line, press Enter, then Insert → Page');
  report_('     numbers. Do it before and the credit never gets written at all.');
  report_('  2. The document\'s access, which is yours to decide. If you want readers to be able to');
  report_('     take their own PDF, the download/print/copy tick has to be on — Google states it the');
  report_('     other way round, as a restriction that is off by default, and Drive\'s script API can');
  report_('     neither read nor set it. So the default already allows it; just look at it once.');
  report_('  3. A short link for the document, if you want one.');

  notify_('Document setup ready', log_.join('\n'));
  return log_.join('\n');
}

/**
 * The folder the spreadsheet actually lives in, rather than one looked up by name.
 *
 * Looking it up by name would *create* the folder in the root if the spreadsheet had been moved, and
 * then put the document somewhere the sheet is not — two folders with one name, and the logo in the
 * wrong one. Asking the file where it is cannot get that wrong.
 */
function parentFolder_(ss) {
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  if (parents.hasNext()) return parents.next();
  report_('⚠ the spreadsheet has no parent folder — falling back to a folder by name');
  return ensureFolder_(CONFIG.spreadsheet.folderName);
}

function ensureDoc_(folder) {
  const name = CONFIG.doc.fileName;
  report_('--- the document ---');

  const existing = live_(folder.getFilesByName(name));
  let file;
  if (existing.length) {
    file = existing[0];
    report_(`  reused "${name}" — the id is unchanged, which is the point`);
    if (existing.length > 1) {
      report_(`  ⚠ more than one file called "${name}" in this folder. Only the id below is the one`);
      report_('    the script writes to; the others are strays — delete them.');
    }
  } else {
    const created = DocumentApp.create(name);        // lands in My Drive root
    file = DriveApp.getFileById(created.getId());
    file.moveTo(folder);
    report_(`  created "${name}" and moved it into the folder`);
  }

  const doc = DocumentApp.openById(file.getId());
  const body = doc.getBody();
  const margin = CONFIG.doc.marginPt;
  body.setPageWidth(A4_WIDTH).setPageHeight(A4_HEIGHT);
  body.setMarginTop(margin).setMarginBottom(margin)
    .setMarginLeft(margin).setMarginRight(margin);
  doc.saveAndClose();
  report_(`  A4 (${A4_WIDTH} × ${A4_HEIGHT} pt) and ${margin} pt margins set, so no File → Page`);
  report_('  setup by hand. `body.clear()` resets neither of them, which is why they are set here');
  report_('  and re-asserted on every rebuild.');

  // Whatever CONFIG.doc.sharing says, and nothing more. A new document is private to its creator
  // until the installer decides otherwise, so under `'leave'` this step leaves it that way and the
  // access is yours to set in Drive.
  if (CONFIG.doc.sharing === 'anyoneWithLink') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    report_('  sharing: anyone with the link → Viewer (CONFIG.doc.sharing)');
  } else {
    report_('  sharing: not touched — CONFIG.doc.sharing is "leave", so set the access yourself');
  }
  report_('  body left empty on purpose — generateEventsDoc clears and rebuilds it');
  return file;
}

/**
 * The logo, if there is one — found by name, reported by digest.
 *
 * Nothing is uploaded from here: a script has no access to your disk, and a repo has no business
 * carrying somebody's logo. Drop an image into the project folder and this finds it.
 *
 * The digest is the part worth having. The bound project binds the logo by **id**, so a file merely
 * *called* the right thing proves nothing: swap in a smaller image later and the document renders a
 * blurry logo forever without raising anything. Record the digest once and a run where it changes
 * tells you.
 */
function findLogo_(folder) {
  const name = CONFIG.doc.logo.fileName;
  report_('--- the logo (optional) ---');
  const existing = live_(folder.getFilesByName(name));
  if (!existing.length) {
    report_(`  no file called "${name}" in this folder.`);
    report_('  The document builds without one — the logo is skipped and the listing is unaffected.');
    report_(`  To add one: upload an image named "${name}" into the folder, run this again, and put`);
    report_(`  the id it prints into the ${CONFIG.properties.logoFileId} property.`);
    return null;
  }

  const file = existing[0];
  const blob = file.getBlob();
  const digest = md5_(blob.getBytes());
  report_(`  found "${name}" · ${blob.getBytes().length} bytes · MD5 ${digest}`);
  report_(`  ${CONFIG.doc.logo.widthPt} pt on the page. Record that digest somewhere: it is the only`);
  report_('  way to tell later that this is still the same image.');
  return file;
}

/**
 * The archive folder for the optional PDF. Nothing depends on it — a reader takes their own PDF from
 * the document — but it lets you see what was published in a given week.
 */
function ensurePdfFolder_(folder) {
  const name = CONFIG.doc.pdfFolderName;
  report_('--- the PDF archive folder (optional) ---');
  const existing = live_(folder.getFoldersByName(name));
  if (existing.length) {
    report_(`  reused "${name}"`);
    return existing[0];
  }
  const created = folder.createFolder(name);
  report_(`  created "${name}"`);
  return created;
}

/** MD5 as lowercase hex. `computeDigest` returns signed bytes, so mask before padding. */
function md5_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    .map(byte => ('0' + (byte & 0xff).toString(16)).slice(-2))
    .join('');
}
