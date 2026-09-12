/**
 * Parsing of the conditions that may follow the target of a CSS `@import` —
 * `layer` / `layer(<name>)`, `supports(<condition>)` and a media query list —
 * the block wrapper that keeps their meaning when the imported file is
 * inlined, and the composition that keeps them when a *remote* `@import` has
 * to be hoisted out of that chain instead (#38). Kept separate from
 * `resolve-stylesheet.ts`, which does the file work, so the rules can be
 * exercised directly.
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
 * Composes the conditions of a whole `@import` chain into the single set a
 * hoisted `@import` must carry.
 *
 * A remote `@import` only applies where it precedes every other rule and sits
 * outside any block, so inlining cannot leave it wrapped in the
 * `@layer` / `@supports` / `@media` blocks that
 * {@link wrapInImportConditions} produces — it has to be lifted to the top of
 * the stylesheet with the chain's conditions folded into its own tail (#38).
 *
 * - Layer names nest, so they join with `.`: `layer(outer)` around
 *   `layer(inner)` becomes `layer(outer.inner)`.
 * - `supports()` conditions combine with `and`, each parenthesised.
 * - Media query lists combine as a cross product, the inner list's queries
 *   first: `print, screen` inside `(min-width: 10cm)` becomes
 *   `print and (min-width: 10cm), screen and (min-width: 10cm)`.
 *
 * Where a faithful composition is impossible this throws rather than emit an
 * `@import` the browser would silently drop again: an anonymous layer has no
 * name to nest (so it cannot be combined with another layer), two different
 * media *types* cannot both hold, and a `not` / `only` query cannot be
 * narrowed by `and`.
 *
 * @param chain - Conditions of each `@import` from the outermost inwards, the
 *   remote import's own conditions last.
 * @returns The composed conditions for the hoisted `@import`.
 * @throws When the conditions cannot be composed into a single equivalent tail.
 */
export function composeImportConditions(chain: ImportConditions[]): ImportConditions {
  const composed: ImportConditions = {};

  const layers = chain
    .map((conditions) => conditions.layer)
    .filter((layer): layer is string => layer !== undefined);
  if (layers.length === 1) {
    composed.layer = layers[0];
  } else if (layers.length > 1) {
    const anonymous = layers.find((layer) => layer === '');
    if (anonymous !== undefined) {
      throw new Error(
        `Cannot hoist a remote @import out of an anonymous cascade layer nested with layer(${layers.filter((layer) => layer !== '').join('.')})`,
      );
    }
    composed.layer = layers.join('.');
  }

  const supports = chain
    .map((conditions) => conditions.supports)
    .filter((value): value is string => value !== undefined);
  if (supports.length === 1) {
    composed.supports = supports[0];
  } else if (supports.length > 1) {
    composed.supports = supports.map((value) => `(${value})`).join(' and ');
  }

  const medias = chain
    .map((conditions) => conditions.media)
    .filter((value): value is string => value !== undefined);
  if (medias.length > 0) {
    composed.media = medias.reduceRight((inner, outer) => combineMediaLists(inner, outer));
  }

  return composed;
}

/**
 * Renders conditions back into the tail text of an `@import`, in grammar
 * order, as the inverse of {@link parseImportConditions}.
 *
 * @param conditions - Conditions to render.
 * @returns The tail text without a leading space or a trailing `;`, empty when
 *   there are no conditions.
 */
export function formatImportConditions(conditions: ImportConditions): string {
  const parts: string[] = [];

  if (conditions.layer !== undefined) {
    parts.push(conditions.layer ? `layer(${conditions.layer})` : 'layer');
  }
  if (conditions.supports !== undefined) {
    parts.push(`supports(${conditions.supports})`);
  }
  if (conditions.media) {
    parts.push(conditions.media);
  }

  return parts.join(' ');
}

/**
 * A media query reduced to the parts that can be recombined: at most one media
 * type, plus the parenthesised feature conditions `and`-ed onto it.
 */
type MediaQuery = { type?: string; conditions: string[] };

/**
 * Combines two media query lists into the list that matches where both hold,
 * as a cross product with the inner list's queries leading each pair.
 *
 * A pair that cannot hold at once contributes nothing and is dropped, so
 * `print` inside `print, screen` composes to `print` rather than failing on
 * the `screen`/`print` pair. Only when *no* pair survives is there nothing
 * left to express, and the composition fails.
 *
 * @param inner - Media query list of the inner `@import`.
 * @param outer - Media query list of the enclosing `@import`.
 * @returns The combined media query list.
 * @throws When the two lists have no combinable pair at all.
 */
function combineMediaLists(inner: string, outer: string): string {
  const inners = splitMediaQueryList(inner);
  const outers = splitMediaQueryList(outer);

  if (inners.length === 0 || outers.length === 0) {
    throw new Error(
      `Cannot combine the media query lists "${inner.trim()}" and "${outer.trim()}" of a hoisted remote @import`,
    );
  }

  const combined: string[] = [];
  for (const innerQuery of inners) {
    for (const outerQuery of outers) {
      const pair = combineMediaQueries(innerQuery, outerQuery);
      if (pair !== null) {
        combined.push(pair);
      }
    }
  }

  if (combined.length === 0) {
    throw new Error(
      `Cannot combine the media queries "${inners.join(', ')}" and "${outers.join(', ')}" of a hoisted remote @import`,
    );
  }

  return combined.join(', ');
}

/**
 * Combines two single media queries into one that matches where both hold.
 *
 * @param inner - Media query of the inner `@import`.
 * @param outer - Media query of the enclosing `@import`.
 * @returns The combined query, or `null` when the two cannot be combined.
 */
function combineMediaQueries(inner: string, outer: string): string | null {
  // `all` on its own adds no constraint, so the other side stands as written —
  // checked before parsing, so it also works against a `not` / `only` query
  // that could not be combined with anything narrower.
  if (inner.trim().toLowerCase() === 'all') {
    return outer.trim();
  }
  if (outer.trim().toLowerCase() === 'all') {
    return inner.trim();
  }

  const first = parseMediaQuery(inner);
  const second = parseMediaQuery(outer);
  if (!first || !second) {
    return null;
  }

  // `all` matches everywhere, so it never conflicts and never needs to be
  // carried when the other query names a type.
  const named = [first.type, second.type].filter(
    (type): type is string => type !== undefined && type.toLowerCase() !== 'all',
  );
  if (named.length === 2 && named[0].toLowerCase() !== named[1].toLowerCase()) {
    return null;
  }

  const type = named[0] ?? first.type ?? second.type;
  const parts = [...(type ? [type] : []), ...first.conditions, ...second.conditions];

  return parts.join(' and ');
}

/**
 * Splits a media query into its optional leading media type and its
 * `and`-joined conditions.
 *
 * @param query - A single media query.
 * @returns The parsed query, or `null` when it is not of a shape that can be
 *   narrowed by `and` — a `not` / `only` query, or one with a bare identifier
 *   anywhere but first.
 */
function parseMediaQuery(query: string): MediaQuery | null {
  const trimmed = query.trim();
  if (!trimmed || /^(?:not|only)(?![\w-])/i.test(trimmed)) {
    return null;
  }

  const parts = splitTopLevel(trimmed, (rest) => {
    const separator = /^\s+and(?![\w-])\s*/i.exec(rest);
    return separator ? separator[0].length : 0;
  })
    .map((part) => part.trim())
    .filter((part) => part !== '');

  // Defensive, and currently unreachable: `trimmed` is non-empty and has no
  // leading whitespace, while the separator requires some, so the first part is
  // always non-empty. Kept because an empty parse would render as an empty
  // query and silently widen the condition instead of failing.
  if (parts.length === 0) {
    return null;
  }

  const parsed: MediaQuery = { conditions: [] };
  for (const [index, part] of parts.entries()) {
    if (index === 0 && /^[a-z][\w-]*$/i.test(part)) {
      parsed.type = part;
      continue;
    }
    // Anything else has to be a parenthesised feature query, optionally negated
    // (`screen and not (hover)` is valid Media Queries 4). A bare word here is
    // a second media type or a malformed query, and `and`-ing it would produce
    // an `@import` the browser drops again.
    if (part.startsWith('(')) {
      parsed.conditions.push(part);
      continue;
    }
    if (/^not\s*\(/i.test(part)) {
      // A bare `not (...)` may not be followed by another `and`, so wrap it as
      // a parenthesised condition to keep it combinable in any position.
      parsed.conditions.push(`(${part})`);
      continue;
    }

    return null;
  }

  return parsed;
}

/**
 * Splits a media query list at its top-level commas.
 *
 * @param list - A media query list.
 * @returns The individual queries, trimmed, without empty entries.
 */
function splitMediaQueryList(list: string): string[] {
  return splitTopLevel(list, (rest) => (rest.startsWith(',') ? 1 : 0))
    .map((query) => query.trim())
    .filter((query) => query !== '');
}

/**
 * Splits text at separators that appear outside parentheses and quoted
 * strings, so a comma or `and` inside `(...)` does not split the text.
 *
 * @param text - Text to split.
 * @param matchSeparator - Returns the length of the separator at the start of
 *   the given remainder, or `0` when there is none.
 * @returns The parts between the separators, which may include empty strings.
 */
function splitTopLevel(text: string, matchSeparator: (rest: string) => number): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quote) {
      current += char;
      if (char === '\\' && index + 1 < text.length) {
        current += text[++index];
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
    } else if (depth === 0) {
      const length = matchSeparator(text.slice(index));
      if (length > 0) {
        parts.push(current);
        current = '';
        index += length - 1;
        continue;
      }
    }

    current += char;
  }

  parts.push(current);
  return parts;
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
