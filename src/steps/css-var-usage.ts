/**
 * Detection of `--css-var` overrides that the effective stylesheet never
 * reads (#60). A mistyped name is otherwise written into the `:root` block,
 * ignored by the browser and invisible in the PDF.
 */

import { CssVarOverride } from '../types';

/**
 * Returns the override names that no `var()` in the stylesheet refers to.
 *
 * The check is textual: `var(` (case-insensitive, like every CSS function
 * name), optional whitespace, then the exact name — custom property names are
 * case-sensitive — not followed by a further name character, so an override
 * `--heading-break` is not taken as used by `var(--heading-break-before)`.
 * The override values count as users too, since they end up in the same
 * `:root` block (`--css-var margin=var(--gap) --css-var gap=1cm`).
 *
 * Deliberately lenient: a `var()` inside a comment counts as a use, and a
 * variable read only by a remote `@import`, which is never fetched, is
 * reported although it may be used. The result is meant for a warning.
 *
 * @param css - Text of the effective stylesheet, overrides block included.
 * @param overrides - The `--css-var` overrides of the run.
 * @returns The unused names, with their leading `--`, each once and in order.
 */
export function findUnusedCssVars(css: string, overrides: CssVarOverride[]): string[] {
  const names = [...new Set(overrides.map(({ name }) => name))];

  return names.filter((name) => !referencePattern(name).test(css));
}

/**
 * Formats the warning for an override the stylesheet does not use.
 *
 * @param name - The override name, with its leading `--`.
 * @returns The warning text.
 */
export function describeUnusedCssVar(name: string): string {
  return `--css-var ${name.slice(2)}: the stylesheet does not use ${name}`;
}

function referencePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // A name continues with an ASCII name character, an escape or any
  // non-ASCII character.
  return new RegExp(`[vV][aA][rR]\\(\\s*${escaped}(?![A-Za-z0-9_\\-\\\\]|[^\\x00-\\x7F])`);
}
