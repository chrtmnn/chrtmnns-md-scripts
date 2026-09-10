/**
 * Lookup rules for the `-s/--stylesheet` value: a path resolved against the
 * directory `md2pdf` was called from, or a bare name that falls back to the
 * per-user config directory (`~/.md2pdf`), where the `.css` extension is
 * optional. Kept separate from `resolve-options.ts`, which supplies the
 * environment and the filesystem, so the rules can be exercised directly.
 */

import path from 'path';

/** Overrides the per-user config directory, e.g. for tests. */
export const CONFIG_DIR_ENV = 'MD2PDF_CONFIG_DIR';

/**
 * Directory the user called `md2pdf` from. Set by the global wrapper, which
 * runs `pnpm` from the repository root, so `process.cwd()` is not the
 * caller's directory there.
 */
export const INVOCATION_DIR_ENV = 'MD2PDF_INVOCATION_DIR';

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
