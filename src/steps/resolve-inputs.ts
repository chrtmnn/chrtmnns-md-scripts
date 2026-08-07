import fs from 'fs';
import path from 'path';
import { ConverterOptions } from '../types';

/**
 * File extension recognised as Markdown during directory expansion.
 *
 * Deliberately limited to `.md`; `.markdown` and other variants are not
 * picked up. The comparison is case-insensitive so `.MD` works too, because
 * this is a Windows-first tool.
 */
const MARKDOWN_EXTENSION = '.md';

/**
 * Directory names never descended into while expanding directories with
 * `--recursive`. Any directory whose name starts with a dot is skipped as
 * well, which already covers `.git`; it is listed explicitly so the intent
 * stays readable and the list is easy to extend.
 */
export const SKIPPED_DIRECTORY_NAMES = ['node_modules', '.git'];

/**
 * Outcome of expanding the raw positional CLI arguments.
 */
export type ResolvedInputs = {
  /**
   * Markdown files to convert, in resolution order and deduplicated by
   * absolute path. Existing paths are absolute; positionals that do not
   * exist are passed through verbatim so the downstream "Skipped missing
   * file" path keeps reporting them exactly as the user typed them.
   */
  files: string[];
  /** Non-fatal messages the caller should surface, e.g. empty directories. */
  warnings: string[];
};

/**
 * Compares two names for deterministic ordering.
 *
 * Uses plain `<`/`>` on the raw strings (UTF-16 code-unit order) instead of
 * `localeCompare`, so the ordering can never shift with the machine's
 * locale, ICU build, or Node version.
 *
 * @param a - First name.
 * @param b - Second name.
 * @returns A negative number, zero, or a positive number for sort ordering.
 */
function compareNames(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Checks whether a directory should be descended into during recursive
 * expansion.
 *
 * @param name - Directory name (not a path).
 * @returns `true` when the directory may be descended into.
 */
function isDescendableDirectory(name: string): boolean {
  return !name.startsWith('.') && !SKIPPED_DIRECTORY_NAMES.includes(name);
}

/**
 * Checks whether a directory entry is a Markdown file that should be
 * collected.
 *
 * Symlinked entries are resolved with a `statSync` so a dangling link or a
 * directory symlink that happens to end in `.md` is skipped instead of being
 * handed to the conversion pipeline.
 *
 * @param entry - Directory entry produced by `readdirSync(..., { withFileTypes: true })`.
 * @param fullPath - Absolute path of the entry.
 * @returns `true` when the entry is a readable Markdown file.
 */
function isMarkdownFile(entry: fs.Dirent, fullPath: string): boolean {
  if (path.extname(entry.name).toLowerCase() !== MARKDOWN_EXTENSION) {
    return false;
  }

  if (entry.isFile()) {
    return true;
  }

  if (!entry.isSymbolicLink()) {
    return false;
  }

  try {
    return fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Collects the Markdown files of a single directory.
 *
 * Ordering is the directory's own files first (sorted), then its
 * subdirectories (sorted) each expanded recursively. Directory symlinks are
 * never followed: recursion only descends into entries for which
 * `Dirent.isDirectory()` is true, and that is false for symlinks. This is
 * the loop guard — no visited-realpath bookkeeping is needed because a cycle
 * can only be formed through a symlink.
 *
 * @param dir - Absolute directory path to expand.
 * @param recursive - Whether subdirectories should be expanded as well.
 * @param collected - Accumulator for the discovered Markdown file paths.
 */
function collectFromDirectory(dir: string, recursive: boolean, collected: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const files: string[] = [];
  const subdirectories: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (recursive && isDescendableDirectory(entry.name)) {
        subdirectories.push(entry.name);
      }
      continue;
    }

    if (isMarkdownFile(entry, fullPath)) {
      files.push(entry.name);
    }
  }

  files.sort(compareNames);
  subdirectories.sort(compareNames);

  for (const name of files) {
    collected.push(path.join(dir, name));
  }

  for (const name of subdirectories) {
    collectFromDirectory(path.join(dir, name), recursive, collected);
  }
}

/**
 * Expands the raw positional CLI arguments into the concrete list of
 * Markdown files to convert.
 *
 * File positionals are kept as they are, directory positionals contribute
 * the `*.md` files they contain at their own position in the list. The final
 * list is deduplicated by resolved absolute path, keeping the first
 * occurrence, so passing both a folder and a file inside it converts that
 * file once.
 *
 * @param positionals - Raw positional arguments as received from Commander.
 * @param options - Resolved converter options carrying the `--recursive` flag.
 * @returns The resolved Markdown file list plus any non-fatal warnings.
 */
export function resolveInputs(positionals: string[], options: ConverterOptions): ResolvedInputs {
  const files: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  /**
   * Adds a path to the result unless an equal absolute path was already
   * added. Windows paths are compared case-insensitively.
   */
  const add = (candidate: string): void => {
    const absolute = path.resolve(candidate);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    files.push(candidate);
  };

  for (const positional of positionals) {
    let stats: fs.Stats;
    try {
      // statSync follows symlinks on purpose: an explicitly passed symlink
      // is a deliberate choice by the user, unlike the ones encountered
      // while descending a tree.
      stats = fs.statSync(positional);
    } catch {
      // Non-existent positionals are forwarded verbatim so prepareWorkdir
      // keeps producing the established "Skipped missing file" warning.
      add(positional);
      continue;
    }

    if (!stats.isDirectory()) {
      add(path.resolve(positional));
      continue;
    }

    const directory = path.resolve(positional);
    const collected: string[] = [];
    collectFromDirectory(directory, options.recursive, collected);

    if (collected.length === 0) {
      warnings.push(
        options.recursive
          ? `No Markdown files found in ${directory} (searched recursively)`
          : `No Markdown files found in ${directory}`,
      );
      continue;
    }

    collected.forEach(add);
  }

  return { files, warnings };
}
