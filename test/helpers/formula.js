/**
 * Reading a generated formula as structure rather than as text.
 *
 * There is no Sheets engine offline, so a formula test can only inspect the string — but inspecting
 * the string and matching substrings in it are not the same thing. `includes('LAMBDA(')` is
 * satisfied by a formula with one `LAMBDA` and four bare `XLOOKUP`s, which is the shape that
 * returns `#VALUE!` in every looked-up column.
 *
 * So: blank the string literals, then walk the parentheses. Enough to answer the questions that
 * matter here — which cells does this refer to, what is this function being handed, is this
 * argument a single value or an array.
 *
 * Deliberately *not* a formula evaluator, nor a parser of anything beyond calls and their
 * arguments. Whether a formula means what was intended is a question only a sheet can answer, which
 * is what the probes inside each setup step are for.
 */

/**
 * The formula with every string literal blanked out, so its text is never read as structure.
 *
 * A label reading `"A2:A"` would otherwise parse as a range and a comma inside `", Netherlands"` as
 * an argument separator. Walked character by character rather than matched, because Sheets escapes
 * a quote by doubling it. The blanks are spaces, so every offset still lines up with the original.
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

/**
 * The comma-separated arguments of the call whose `(` sits at `open`, and where that call ends.
 *
 * Only commas at the call's own depth split an argument, so a nested call keeps its own commas —
 * `MAP(FILTER(a, c), LAMBDA(v, v))` has two arguments, not four. Pass text that has already been
 * through `withoutStrings`, or a comma inside a string literal splits an argument in two.
 */
function argumentsOf(text, open) {
  if (text[open] !== '(') throw new Error(`argumentsOf: offset ${open} is not a "("`);
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const character = text[i];
    if (character === '(') { depth++; continue; }
    if (character === ')') {
      depth--;
      if (depth) continue;
      args.push({ text: text.slice(start, i).trim(), from: start, to: i });
      return { args: args, end: i };
    }
    if (character === ',' && depth === 1) {
      args.push({ text: text.slice(start, i).trim(), from: start, to: i });
      start = i + 1;
    }
  }
  throw new Error(`argumentsOf: the call at offset ${open} is never closed`);
}

/**
 * Every call to `name` in the formula, with its arguments and the span it covers.
 *
 * The span is what makes scope answerable: a name bound by `LAMBDA` is in scope for exactly the
 * offsets between that call's `(` and its `)`, so "is this `XLOOKUP` inside that `LAMBDA`" is a
 * comparison of two numbers.
 */
function callsOf(text, name) {
  const found = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'gi');
  let match;
  while ((match = pattern.exec(text))) {
    const open = match.index + match[0].length - 1;
    const { args, end } = argumentsOf(text, open);
    found.push({ name: name, at: match.index, open: open, end: end, args: args });
  }
  return found;
}

/** A single value: a bare name, as opposed to a range, a call or any other expression. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The parameter names a `LAMBDA` binds — its leading arguments, all of which are bare names.
 *
 * The last argument is the body and is never a parameter, so it is dropped before reading; anything
 * that is not a bare name ends the list, because `LAMBDA` takes its parameters first and its body
 * last with nothing else in between.
 */
function lambdaParams(call) {
  const params = [];
  for (const argument of call.args.slice(0, -1)) {
    if (!IDENTIFIER.test(argument.text)) break;
    params.push(argument.text);
  }
  return params;
}

/** Every name bound by a `LAMBDA` enclosing `offset` — what a single value could be called there. */
function boundNamesAt(lambdaCalls, offset) {
  const names = new Set();
  for (const call of lambdaCalls) {
    if (call.open < offset && offset < call.end) {
      for (const param of lambdaParams(call)) names.add(param);
    }
  }
  return names;
}

module.exports = {
  withoutStrings, argumentsOf, callsOf, lambdaParams, boundNamesAt, IDENTIFIER,
};
