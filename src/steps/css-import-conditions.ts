/**
 * Parsing of the conditions that may follow the target of a CSS `@import` —
 * `layer` / `layer(<name>)`, `supports(<condition>)` and a media query list —
 * and the block wrapper that keeps their meaning when the imported file is
 * inlined. Kept separate from `resolve-stylesheet.ts`, which does the file
 * work, so the rules can be exercised directly.
 */

/** The conditions of one `@import`, split into the parts the grammar allows. */
export type ImportConditions = {
  /** Cascade layer name; `''` for an anonymous `layer`, absent when there is none. */
  layer?: string;
  /** Content of `supports(...)`, absent when there is none. */
  supports?: string;
  /** Media query list, absent when there is none. */
  media?: string;
};

/**
 * Splits the text between an `@import` target and its `;` into its parts.
 *
 * The grammar fixes the order: an optional `layer` / `layer(<name>)`, then an
 * optional `supports(...)`, then an optional media query list. Whatever
 * follows the first two is taken as the media query list unchanged, which is
 * how the whole tail was treated before layers and supports were recognised.
 *
 * @param tail - Raw text after the import target, without the trailing `;`.
 * @returns The parsed conditions.
 * @throws When `layer(...)` or `supports(...)` is empty or has unbalanced parentheses.
 */
export function parseImportConditions(tail: string): ImportConditions {
  const conditions: ImportConditions = {};
  let rest = tail.trim();

  // `layer` must be the whole identifier, so `layered` stays a media query.
  const layer = /^layer(?![\w-])/i.exec(rest);
  if (layer) {
    rest = rest.slice(layer[0].length);
    if (rest.startsWith('(')) {
      const group = readParenthesized(rest, tail);
      conditions.layer = nonEmpty(group.content, 'layer()', tail);
      rest = rest.slice(group.end);
    } else {
      conditions.layer = '';
    }
    rest = rest.trim();
  }

  const supports = /^supports(?=\()/i.exec(rest);
  if (supports) {
    rest = rest.slice(supports[0].length);
    const group = readParenthesized(rest, tail);
    conditions.supports = nonEmpty(group.content, 'supports()', tail);
    rest = rest.slice(group.end).trim();
  }

  if (rest) {
    conditions.media = rest;
  }

  return conditions;
}

/**
 * Wraps inlined CSS in the blocks equivalent to the given `@import`
 * conditions, nested in grammar order: `@layer` outermost, then `@supports`,
 * then `@media`. `supports(<x>)` becomes `@supports (<x>)`, which is valid
 * both for a bare declaration and for a full condition.
 *
 * @param css - The imported file's CSS text.
 * @param conditions - Conditions parsed by {@link parseImportConditions}.
 * @returns The wrapped CSS, or `css` unchanged when there are no conditions.
 */
export function wrapInImportConditions(css: string, conditions: ImportConditions): string {
  let wrapped = css;

  if (conditions.media) {
    wrapped = `@media ${conditions.media} {\n${wrapped}\n}`;
  }
  if (conditions.supports !== undefined) {
    wrapped = `@supports (${conditions.supports}) {\n${wrapped}\n}`;
  }
  if (conditions.layer !== undefined) {
    wrapped = conditions.layer ? `@layer ${conditions.layer} {\n${wrapped}\n}` : `@layer {\n${wrapped}\n}`;
  }

  return wrapped;
}

/**
 * Reads a parenthesised group from the start of `text`, honouring nested
 * parentheses and ignoring parentheses inside quoted strings.
 *
 * @param text - Text starting with `(`.
 * @param tail - The full condition text, for the error message.
 * @returns The content between the outer parentheses and the index just past the closing one.
 * @throws When the group is never closed.
 */
function readParenthesized(text: string, tail: string): { content: string; end: number } {
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quote) {
      if (char === '\\') {
        index++;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return { content: text.slice(1, index), end: index + 1 };
      }
    }
  }

  throw new Error(`Unbalanced parentheses in @import conditions "${tail.trim()}"`);
}

/**
 * Trims the content of a `layer(...)` / `supports(...)` group and rejects an
 * empty one, which the browser would treat as an invalid `@import`.
 *
 * @param content - Raw content between the parentheses.
 * @param name - Function name for the error message, e.g. `layer()`.
 * @param tail - The full condition text, for the error message.
 * @returns The trimmed content.
 * @throws When the content is empty.
 */
function nonEmpty(content: string, name: string, tail: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`Empty ${name} in @import conditions "${tail.trim()}"`);
  }
  return trimmed;
}
