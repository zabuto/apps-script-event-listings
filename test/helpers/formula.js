/**
 * Reading a generated formula as structure rather than as text.
 *
 * There is no Sheets engine offline, so a formula test can only inspect the string — but inspecting
 * the string and matching substrings in it are not the same thing. A label reading `"A2:A"` parses
 * as a range to anything that scans the text, and the privacy reader has to answer *which cells does
 * this refer to* without being fooled by one.
 *
 * Deliberately not an evaluator: whether a formula means what was intended is a question only a
 * sheet can answer, which is what the probes inside each setup step are for.
 */

/**
 * The formula with every string literal blanked out, so its text is never read as structure.
 *
 * Walked character by character rather than matched, because Sheets escapes a quote by doubling it.
 * The blanks are spaces, so every offset still lines up with the original.
 */
function withoutStrings(formula) {
  let out = '';
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const character = formula[i];
    if (character !== '"') { out += inString ? ' ' : character; continue; }
    if (inString && formula[i + 1] === '"') { out += '  '; i++; continue; }   // an escaped quote
    inString = !inString;
    out += ' ';
  }
  return out;
}

module.exports = { withoutStrings };
