/**
 * Structural scanning of a CSS file: which characters are live code, and how
 * deep inside `{}` blocks they sit.
 *
 * `resolve-stylesheet.ts` rewrites `@import` and `url()` with global regexes.
 * Splitting only on block comments was not enough (#46): a match found inside
 * a **string literal** turned document text into an at-rule or a missing-file
 * error, and a match found inside a **block** was hoisted out of the block,
 * silently dropping the `@layer`/`@media`/`@supports` condition it sat under.
 * Both mistakes come from the same missing information, so both are answered
 * here — next to `css-import-conditions.ts`, which already reads strings
 * correctly when it splits an `@import` tail.
 *
 * This is a lexical scan, not a CSS parser: it knows comments, string
 * literals with backslash escapes, and braces. That is exactly what the two
 * rewrite passes need to decide whether a match is live.
 */

/** Per-character structural view of a CSS file, produced by {@link scanCssStructure}. */
export type CssStructure = {
  /** `true` where the character is live code (outside comments and strings). */
  live: boolean[];
  /** Number of enclosing `{}` blocks at that character. */
  depth: number[];
};

/**
 * Scans a CSS file character by character.
 *
 * A string literal ends at its matching unescaped quote, or at an unescaped
 * newline: CSS does not allow a raw newline inside a string, and stopping
 * there keeps one stray quote from swallowing the rest of the file.
 *
 * @param css - CSS text to scan.
 * @returns Liveness and brace depth for every character of `css`.
 */
export function scanCssStructure(css: string): CssStructure {
  const live: boolean[] = new Array<boolean>(css.length);
  const depth: number[] = new Array<number>(css.length);

  let inComment = false;
  let quote: string | undefined;
  let braces = 0;

  for (let index = 0; index < css.length; index++) {
    const char = css[index];

    if (inComment) {
      live[index] = false;
      depth[index] = braces;
      if (char === '*' && css[index + 1] === '/') {
        live[++index] = false;
        depth[index] = braces;
        inComment = false;
      }
      continue;
    }

    if (quote) {
      live[index] = false;
      depth[index] = braces;
      if (char === '\\' && index + 1 < css.length) {
        live[++index] = false;
        depth[index] = braces;
      } else if (char === quote || char === '\n') {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && css[index + 1] === '*') {
      inComment = true;
      live[index] = false;
      depth[index] = braces;
      live[++index] = false;
      depth[index] = braces;
      continue;
    }

    // The opening quote counts as live: a rewrite pass matches `@import "x"`
    // and `url("x")` as a whole, starting outside the literal.
    live[index] = true;
    depth[index] = braces;

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      braces++;
    } else if (char === '}') {
      braces = Math.max(0, braces - 1);
    }
  }

  return { live, depth };
}

/**
 * Replaces every match of `pattern` that begins in live code, telling the
 * replacer how deep inside `{}` blocks the match sits.
 *
 * A match beginning inside a comment or a string literal is left exactly as
 * written — the text is not CSS, and rewriting it would either destroy
 * document content or invent an at-rule (#46).
 *
 * @param css - CSS text to rewrite.
 * @param pattern - Global pattern to replace.
 * @param replacer - Replacement callback; receives the brace depth at the
 *   match position alongside the match and its capture groups.
 * @returns The rewritten CSS text.
 */
export function replaceInLiveCss(
  css: string,
  pattern: RegExp,
  replacer: (depth: number, match: string, ...groups: string[]) => string,
): string {
  const { live, depth } = scanCssStructure(css);
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

  let result = '';
  let copiedUpTo = 0;
  let match: RegExpExecArray | null;

  while ((match = global.exec(css)) !== null) {
    if (match[0].length === 0) {
      global.lastIndex++;
      continue;
    }

    if (!live[match.index]) {
      continue;
    }

    const groups = match.slice(1).map((group) => group as string);
    result += css.slice(copiedUpTo, match.index) + replacer(depth[match.index], match[0], ...groups);
    copiedUpTo = match.index + match[0].length;
  }

  return result + css.slice(copiedUpTo);
}
