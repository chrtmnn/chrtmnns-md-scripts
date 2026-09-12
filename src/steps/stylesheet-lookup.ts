/**
 * Lookup rules for the `-s/--stylesheet` value: a path resolved against the
 * directory `md2pdf` was called from, or a bare name that falls back to the
 * per-user config directory (`~/.md2pdf`), where the `.css` extension is
 * optional. Also covers the choice made when no `-s` is given at all, where a
 * personal `<config dir>/default.css` takes the place of the bundled
 * stylesheet (#40). Kept separate from `resolve-options.ts`, which supplies
 * the environment and the filesystem, so the rules can be exercised directly.
 */

import path from 'path';
import { StylesheetOrigin } from '../types';

/** Overrides the per-user config directory, e.g. for tests. */
export const CONFIG_DIR_ENV = 'MD2PDF_CONFIG_DIR';

/**
 * Directory the user called `md2pdf` from. Set by the global wrapper, which
 * runs `pnpm` from the repository root, so `process.cwd()` is not the
 * caller's directory there.
 */
export const INVOCATION_DIR_ENV = 'MD2PDF_INVOCATION_DIR';

/**
 * Reserved `-s` value that always selects the bundled stylesheet, so a single
 * run can ignore a personal `<config dir>/default.css` without naming the
 * bundled file's path, which differs per machine. Matched exactly: neither
 * the invocation directory nor the config directory is consulted for it, and
 * `-s default.css` still refers to the personal file.
 */
export const BUNDLED_STYLESHEET_VALUE = 'default';

/**
 * Name of the personal default stylesheet inside the config directory, used
 * when no `-s` is given.
 */
export const USER_DEFAULT_STYLESHEET = 'default.css';

/** Directories a stylesheet can be resolved from. */
export type StylesheetLocations = {
  /** Directory `md2pdf` was called from. */
  invocationDir: string;
  /** Per-user config directory, see {@link configDirectory}. */
  configDir: string;
  /** Absolute path of the bundled `src/css/default.css`. */
  bundledStylesheet: string;
};

/** The stylesheet a run should use, and where it came from. */
export type StylesheetChoice = {
  /** Absolute path, or undefined when not even the bundled stylesheet exists. */
  path?: string;
  /** Why this stylesheet was picked. */
  origin: StylesheetOrigin;
};

/**
 * Returns the per-user config directory that holds named stylesheets.
 *
 * @param env - Environment to read {@link CONFIG_DIR_ENV} from.
 * @param homeDir - The user's home directory.
 * @returns `MD2PDF_CONFIG_DIR` when set and non-empty, otherwise `<home>/.md2pdf`.
 */
export function configDirectory(env: NodeJS.ProcessEnv, homeDir: string): string {
  return env[CONFIG_DIR_ENV] || path.join(homeDir, '.md2pdf');
}

/**
 * Decides whether a `-s` value is a bare stylesheet name, which may be looked
 * up in the config directory, rather than a path. Anything with a path
 * separator, a drive prefix, or a `.` / `..` segment is a path, so
 * subdirectories of the config directory are never searched.
 *
 * @param value - Raw `-s` value.
 * @returns True for a bare name such as `custom`, `custom.css` or `my.theme`.
 */
export function isBareName(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && !/[\\/]/.test(value) && !/^[a-z]:/i.test(value);
}

/**
 * Lists the files a `-s` value may refer to, in lookup order:
 *
 * 1. the value as a path, resolved against the invocation directory;
 * 2. for a bare name, `<config dir>/<value>`;
 * 3. for a bare name without a `.css` extension, `<config dir>/<value>.css`.
 *
 * The extension is never added in the invocation directory.
 *
 * @param value - Raw `-s` value.
 * @param invocationDir - Directory `md2pdf` was called from.
 * @param configDir - Per-user config directory.
 * @returns Absolute candidate paths, most specific first.
 */
export function stylesheetCandidates(value: string, invocationDir: string, configDir: string): string[] {
  const candidates = [path.resolve(invocationDir, value)];

  if (isBareName(value)) {
    candidates.push(path.join(configDir, value));
    if (!value.toLowerCase().endsWith('.css')) {
      candidates.push(path.join(configDir, `${value}.css`));
    }
  }

  return candidates;
}

/**
 * Resolves a `-s` value to the first candidate that exists.
 *
 * @param value - Raw `-s` value.
 * @param invocationDir - Directory `md2pdf` was called from.
 * @param configDir - Per-user config directory.
 * @param isFile - Reports whether a path is an existing file.
 * @returns Absolute path of the stylesheet to use.
 * @throws When no candidate exists; the message lists every location tried.
 */
export function findStylesheet(
  value: string,
  invocationDir: string,
  configDir: string,
  isFile: (file: string) => boolean,
): string {
  const candidates = stylesheetCandidates(value, invocationDir, configDir);
  const found = candidates.find(isFile);
  if (found) {
    return found;
  }

  if (candidates.length === 1) {
    throw new Error(`Stylesheet not found: ${candidates[0]}`);
  }

  const tried = candidates.map((candidate) => `  - ${candidate}`).join('\n');
  throw new Error(`Stylesheet not found: ${value}\nTried:\n${tried}`);
}

/**
 * Picks the stylesheet for a whole run:
 *
 * 1. `-s default` — the bundled stylesheet, never a lookup (#40);
 * 2. any other `-s <value>` — {@link findStylesheet};
 * 3. no `-s`, with `<config dir>/default.css` present — that file, which
 *    replaces the bundled stylesheet completely;
 * 4. no `-s` — the bundled stylesheet, or nothing when it is missing.
 *
 * @param value - Raw `-s` value, or undefined when the option was not given.
 * @param locations - Directories to resolve against.
 * @param isFile - Reports whether a path is an existing file.
 * @returns The chosen stylesheet and its origin.
 * @throws When an explicit `-s` value matches nothing, including `-s default`
 *   in a checkout whose bundled stylesheet is missing.
 */
export function chooseStylesheet(
  value: string | undefined,
  { invocationDir, configDir, bundledStylesheet }: StylesheetLocations,
  isFile: (file: string) => boolean,
): StylesheetChoice {
  if (value === BUNDLED_STYLESHEET_VALUE) {
    if (!isFile(bundledStylesheet)) {
      throw new Error(`Stylesheet not found: ${bundledStylesheet}`);
    }
    return { path: bundledStylesheet, origin: 'bundled' };
  }

  if (value) {
    return { path: findStylesheet(value, invocationDir, configDir, isFile), origin: 'option' };
  }

  const userDefault = path.join(configDir, USER_DEFAULT_STYLESHEET);
  if (isFile(userDefault)) {
    return { path: userDefault, origin: 'user-default' };
  }

  // A checkout without the bundled stylesheet still converts, just unstyled;
  // unlike an explicit `-s`, nothing was asked for that could be denied.
  return { path: isFile(bundledStylesheet) ? bundledStylesheet : undefined, origin: 'bundled' };
}

/**
 * Formats the `--verbose` line that names the stylesheet in use and why it
 * was picked, so a silently applied personal default is visible.
 *
 * @param choice - The chosen stylesheet, from {@link chooseStylesheet}.
 * @returns A single line of log output.
 */
export function describeStylesheet({ path: stylesheet, origin }: StylesheetChoice): string {
  if (!stylesheet) {
    return 'Stylesheet: none (the bundled default is missing from the checkout)';
  }

  const reasons: Record<StylesheetOrigin, string> = {
    option: '-s',
    'user-default': `personal default, overrides the bundled one; -s ${BUNDLED_STYLESHEET_VALUE} forces that one`,
    bundled: 'bundled default',
  };

  return `Stylesheet: ${stylesheet} (${reasons[origin]})`;
}
