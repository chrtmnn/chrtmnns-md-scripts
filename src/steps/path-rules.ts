/**
 * The two platform-dependent path rules this project cares about, as a value
 * that can be passed in rather than read from `process.platform`.
 *
 * Windows is the primary target, but CI runs on Linux, so every
 * `process.platform === 'win32'` branch used to be dead code there — the
 * tests that named a Windows rule were in fact exercising the POSIX one
 * (#50). Taking the rules as a parameter lets both branches run on any
 * runner; production code passes {@link NATIVE_PATH_RULES} and behaves
 * exactly as before.
 */

import path from 'path';

/** Path semantics of one platform. */
export type PathRules = {
  /** Path module whose separator and parsing rules apply. */
  path: typeof path.win32;
  /** Whether two paths differing only in case name the same file. */
  caseInsensitive: boolean;
};

/** Windows: backslash separators, drive letters, case-insensitive. */
export const WINDOWS_PATH_RULES: PathRules = { path: path.win32, caseInsensitive: true };

/** POSIX: slash separators, one root, case-sensitive. */
export const POSIX_PATH_RULES: PathRules = { path: path.posix, caseInsensitive: false };

/** The rules of the platform the process is running on. */
export const NATIVE_PATH_RULES: PathRules =
  process.platform === 'win32' ? WINDOWS_PATH_RULES : POSIX_PATH_RULES;

/**
 * Normalises a path for use as a map or set key, so two spellings of the same
 * file collapse into one entry.
 *
 * @param value - Absolute path.
 * @param rules - Path rules to apply.
 * @returns The comparable form of the path.
 */
export function comparisonKey(value: string, rules: PathRules = NATIVE_PATH_RULES): string {
  return rules.caseInsensitive ? value.toLowerCase() : value;
}
