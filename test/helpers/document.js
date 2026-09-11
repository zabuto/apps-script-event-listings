/**
 * Just enough of `DocumentApp` to render the agenda offline, and to read back what was rendered.
 *
 * The renderers are the one part of this codebase whose whole output is side effects on an object
 * Google owns: `eventRow_` returns nothing, and what it did is only visible in the document. So this
 * fake is built the other way round from the rest of `fakes.js` — it keeps a **plain-data model** of
 * everything appended and styled, and the Apps Script surface is a thin shell that mutates it. Tests
 * assert against the model, never against the shell, so `assert` never touches a fake object.
 *
 * Two behaviours are reproduced rather than simplified, because code under test compensates for both
 * and a tidier fake would make that compensation untestable:
 *
 *   · `body.clear()` leaves one empty paragraph behind. `generateEventsDoc` removes it so the logo
 *     sits at the top; against a fake that cleared to nothing, that removal could never be wrong.
 *   · `appendTableRow()` gives a row with **no** cells. That is why `eventRow_` opens by topping the
 *     row up to two, and a fake handing back a ready-made pair would hide it.
 *
 * Anything the renderers do not call is left out. Adding a method here means the code under test
 * genuinely needs it.
 */

/** Ties an API shell back to its model, so `removeChild` can find what `getChild` handed out. */
const MODEL = Symbol('model');

const ElementType = { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', INLINE_IMAGE: 'INLINE_IMAGE' };
const ParagraphHeading = {
  TITLE: 'TITLE', SUBTITLE: 'SUBTITLE', NORMAL: 'NORMAL',
  HEADING1: 'HEADING1', HEADING2: 'HEADING2', HEADING3: 'HEADING3',
};
const HorizontalAlignment = { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFY: 'JUSTIFY' };

/* ─────────────────────────────────────────────────────────────────────────────── the model ─── */

const paragraphModel = text => ({
  kind: 'paragraph',
  text: String(text),
  heading: null,
  alignment: null,
  spacingBefore: null,
  spacingAfter: null,
  /** Styling applied to the whole paragraph, which is how every renderer here applies it. */
  style: {},
  /** `setLinkUrl(from, to, url)` — kept as ranges, because the offsets are the thing being got right. */
  links: [],
  /** The three-argument `setForegroundColor`, same reason. */
  colorRuns: [],
});

const cellModel = text => ({
  kind: 'cell', width: null, background: null, padding: {}, children: [paragraphModel(text)],
});

/* ───────────────────────────────────────────────────────────────────────── the API surface ─── */

/**
 * Docs refuses an offset outside the text, and both offsets are *inclusive*.
 *
 * Reproduced rather than ignored because the ranged calls in `eventRow_` are computed by hand — a
 * `- 1` that goes missing runs the link one character past the end. Against a fake that accepted
 * anything, that is invisible: the overrun is off the end of the string, so reading the range back
 * still returns exactly the handle.
 */
function checkRange(model, from, to, label) {
  const length = model.text.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new Error(`${label}: offsets must be integers, got ${from} and ${to}`);
  }
  if (from < 0 || to < from || to >= length) {
    throw new Error(`${label}: [${from}, ${to}] is outside "${model.text}" (0…${length - 1})`);
  }
}

function textApi(model) {
  const api = {
    setFontFamily: value => { model.style.fontFamily = value; return api; },
    setFontSize: value => { model.style.fontSize = value; return api; },
    setBold: value => { model.style.bold = value; return api; },
    setItalic: value => { model.style.italic = value; return api; },
    // One argument styles the paragraph; three style a range. Docs overloads it, and `eventRow_`
    // uses both spellings on the same paragraph.
    setForegroundColor: (a, b, c) => {
      if (c === undefined) model.style.color = a;
      else {
        checkRange(model, a, b, 'setForegroundColor');
        model.colorRuns.push({ from: a, to: b, color: c });
      }
      return api;
    },
    setLinkUrl: (from, to, url) => {
      checkRange(model, from, to, 'setLinkUrl');
      model.links.push({ from, to, url });
      return api;
    },
  };
  return api;
}

function paragraphApi(model) {
  const api = {
    [MODEL]: model,
    getType: () => ElementType.PARAGRAPH,
    asParagraph: () => api,
    getText: () => model.text,
    setText: text => { model.text = String(text); return api; },
    appendText: text => { model.text += String(text); return api; },
    setHeading: value => { model.heading = value; return api; },
    setAlignment: value => { model.alignment = value; return api; },
    setSpacingBefore: value => { model.spacingBefore = value; return api; },
    setSpacingAfter: value => { model.spacingAfter = value; return api; },
    editAsText: () => textApi(model),
  };
  return api;
}

function cellApi(model) {
  const api = {
    [MODEL]: model,
    setWidth: value => { model.width = value; return api; },
    setBackgroundColor: value => { model.background = value; return api; },
    setPaddingTop: value => { model.padding.top = value; return api; },
    setPaddingBottom: value => { model.padding.bottom = value; return api; },
    setPaddingLeft: value => { model.padding.left = value; return api; },
    setPaddingRight: value => { model.padding.right = value; return api; },
    getNumChildren: () => model.children.length,
    getChild: index => paragraphApi(model.children[index]),
    appendParagraph: text => {
      const paragraph = paragraphModel(text);
      model.children.push(paragraph);
      return paragraphApi(paragraph);
    },
  };
  return api;
}

function rowApi(model) {
  const api = {
    [MODEL]: model,
    getNumCells: () => model.cells.length,
    getCell: index => cellApi(model.cells[index]),
    appendTableCell: text => {
      const cell = cellModel(text === undefined ? '' : text);
      model.cells.push(cell);
      return cellApi(cell);
    },
  };
  return api;
}

function tableApi(model) {
  const api = {
    [MODEL]: model,
    getType: () => ElementType.TABLE,
    asTable: () => api,
    getNumRows: () => model.rows.length,
    setBorderWidth: value => { model.borderWidth = value; return api; },
    getRow: index => rowApi(model.rows[index]),
    // A fresh row arrives with no cells, exactly as in Docs.
    appendTableRow: () => {
      const row = { kind: 'row', cells: [] };
      model.rows.push(row);
      return rowApi(row);
    },
  };
  return api;
}

function imageApi(model) {
  const api = {
    [MODEL]: model,
    getType: () => ElementType.INLINE_IMAGE,
    setWidth: value => { model.width = value; return api; },
    setHeight: value => { model.height = value; return api; },
  };
  return api;
}

const childApi = model => (
  model.kind === 'paragraph' ? paragraphApi(model)
    : model.kind === 'table' ? tableApi(model)
      : imageApi(model));

function bodyApi(model) {
  const api = {
    // Docs leaves one empty paragraph behind, which is the whole reason generateEventsDoc goes
    // looking for it afterwards.
    clear: () => { model.children.length = 0; model.children.push(paragraphModel('')); return api; },
    // The page size the one-time setup asserts. `body.clear()` resets neither it nor the
    // margins, which is why both are written again on every rebuild.
    setPageWidth: value => { model.pageWidth = value; return api; },
    setPageHeight: value => { model.pageHeight = value; return api; },
    setMarginTop: value => { model.margins.top = value; return api; },
    setMarginBottom: value => { model.margins.bottom = value; return api; },
    setMarginLeft: value => { model.margins.left = value; return api; },
    setMarginRight: value => { model.margins.right = value; return api; },
    getNumChildren: () => model.children.length,
    getChild: index => childApi(model.children[index]),
    removeChild: element => {
      const at = model.children.indexOf(element[MODEL]);
      if (at < 0) throw new Error('removeChild: that element is not a child of the body');
      model.children.splice(at, 1);
      return api;
    },
    appendParagraph: text => {
      const paragraph = paragraphModel(text);
      model.children.push(paragraph);
      return paragraphApi(paragraph);
    },
    appendTable: cells => {
      const table = {
        kind: 'table',
        borderWidth: null,
        rows: cells.map(row => ({ kind: 'row', cells: row.map(cellModel) })),
      };
      model.children.push(table);
      return tableApi(table);
    },
    appendImage: blob => {
      const image = { kind: 'image', width: null, height: null, blob: blob };
      model.children.push(image);
      return imageApi(image);
    },
  };
  return api;
}

/**
 * A document, plus the `model` its tests read.
 *
 * `footer` starts as `null` — no footer — which is the state `ensureFooter_` writes into. Pass
 * `{ footer: true }` for a document that already has one, the case its early return protects.
 */
function fakeDocument({ id = 'fake-doc-id', footer = false } = {}) {
  const model = {
    id: id,
    body: { children: [], margins: {} },
    footer: footer ? { kind: 'footer', children: [], preexisting: true } : null,
    saved: 0,
  };

  const footerApi = footerModel => ({
    appendParagraph: text => {
      const paragraph = paragraphModel(text);
      footerModel.children.push(paragraph);
      return paragraphApi(paragraph);
    },
  });

  return {
    model: model,
    getId: () => model.id,
    getBody: () => bodyApi(model.body),
    getFooter: () => (model.footer ? footerApi(model.footer) : null),
    addFooter: () => {
      // Docs refuses a second footer. Left as a throw so a broken `ensureFooter_` guard fails here
      // rather than quietly producing a document with two.
      if (model.footer) throw new Error('addFooter: this document already has a footer');
      model.footer = { kind: 'footer', children: [] };
      return footerApi(model.footer);
    },
    saveAndClose: () => { model.saved++; },
  };
}

/** The `DocumentApp` namespace: the enums always, and `openById` only for the document given. */
function documentApp(document) {
  return {
    ElementType: ElementType,
    ParagraphHeading: ParagraphHeading,
    HorizontalAlignment: HorizontalAlignment,
    /**
     * The one-time setup creates the document when the folder has none to reuse.
     *
     * The fake handed to the test *is* the document this creates — there is only one — so the id it
     * returns is one `openById` will accept, and `model.createdAs` records that the run went down
     * the create path rather than the reuse path. Without a fake document there is nothing to
     * create, and saying so is better than inventing an id nothing can open.
     */
    create: name => {
      if (!document) throw new Error('DocumentApp.create: no fake document given');
      document.model.createdAs = name;
      return { getId: () => document.model.id };
    },
    openById: id => {
      if (!document) throw new Error('DocumentApp.openById: no fake document given');
      if (id !== document.model.id) {
        throw new Error(`DocumentApp.openById: asked for "${id}", the fake document is ` +
          `"${document.model.id}"`);
      }
      return document;
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────── reading it back ─── */

/** Every paragraph in the body, in reading order, including the ones inside table cells. */
function paragraphsIn(bodyModel) {
  const found = [];
  const walk = children => children.forEach(child => {
    if (child.kind === 'paragraph') found.push(child);
    else if (child.kind === 'table') child.rows.forEach(row => row.cells.forEach(cell => {
      walk(cell.children);
    }));
  });
  walk(bodyModel.children);
  return found;
}

/**
 * The document as a reader would see it — every paragraph's text, in order, one per line.
 *
 * This is what the privacy assertion is made against: the `(private)` column rule is about what
 * reaches a reader, and a check that inspected only the paragraphs it expected to find would miss a
 * leak anywhere else.
 */
function documentText(model) {
  const body = paragraphsIn(model.body).map(paragraph => paragraph.text);
  const footer = model.footer ? model.footer.children.map(paragraph => paragraph.text) : [];
  return body.concat(footer).join('\n');
}

/** The body's tables, in order — one per month heading, plus the rules. */
const tablesIn = bodyModel => bodyModel.children.filter(child => child.kind === 'table');

module.exports = {
  fakeDocument, documentApp, paragraphsIn, documentText, tablesIn,
  ElementType, ParagraphHeading, HorizontalAlignment,
};
