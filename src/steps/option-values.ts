/**
 * Validation and normalisation of the CLI option values that carry more than
 * a boolean: `--css-var name=value` and `--merge <name>`. Kept separate from
 * `resolve-options.ts`, which also touches the filesystem to locate the
 * default stylesheet, so the validation rules can be exercised directly.
 */

import { CssVarOverride } from '../types';

/**
 * Normalizes the `--merge <name>` value into a plain PDF base name.
 *
 * The value is a name, not a path: the merged PDF always lands in the
 * resolved target directory, so anything that looks like a path is rejected
 * rather than silently reinterpreted. A trailing `.pdf` suffix is accepted
 * and removed, so both `report` and `report.pdf` produce `report.pdf`.
 *
 * @param value - Raw `--merge` value from the CLI.
 * @returns The validated PDF base name without extension.
 */
export function parseMergeName(value: string): string {
  const trimmed = value.trim();
  const name = /\.pdf$/i.test(trimmed) ? trimmed.slice(0, -4) : trimmed;

  if (!name || name === '.' || name === '..') {
    throw new Error(`Invalid --merge name: ${value}. Expected a PDF base name.`);
  }

  if (/[<>:"/\\|?*]/.test(name)) {
    throw new Error(`Invalid --merge name: ${value}. Expected a plain file name without path separators.`);
  }

  return name;
}

/**
 * Parses `--css-var name=value` entries into normalized CSS custom properties.
 *
 * @param values - Raw CLI values collected from `--css-var`.
 * @returns Validated CSS variable overrides.
 */
export function parseCssVars(values: string[]): CssVarOverride[] {
  return values.map((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid CSS variable override: ${entry}. Expected name=value.`);
    }

    const rawName = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    const name = rawName.startsWith('--') ? rawName.slice(2) : rawName;

    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid CSS variable name: ${rawName}`);
    }

    if (!value || /[{};]/.test(value)) {
      throw new Error(`Invalid CSS variable value for ${rawName}: ${value}`);
    }

    return { name: `--${name}`, value };
  });
}
