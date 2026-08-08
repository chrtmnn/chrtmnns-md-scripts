/**
 * Shared fixture helpers for the `node:test` suite.
 *
 * Everything the tests write goes into a per-test directory under the OS temp
 * directory that is removed again when the test finishes, so a test run never
 * leaves files behind in the repository.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { TestContext } from 'node:test';
import { ConversionContext, ConverterOptions } from '../types';

/**
 * Creates an isolated temporary directory that is removed when the test ends.
 *
 * The returned path is passed through `realpathSync` because `os.tmpdir()` can
 * be an 8.3 short path on Windows (`C:\Users\RUNNER~1\...`), which would not
 * compare equal to the paths the production code produces via `path.resolve`.
 *
 * @param t - Active test context, used to register the cleanup hook.
 * @param prefix - Optional name prefix, useful when reading a failing run's leftovers.
 * @returns Absolute path of the created directory.
 */
export function tempDir(t: TestContext, prefix = 'md-scripts-test-'): string {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  t.after(() => {
    fs.rmSync(created, { recursive: true, force: true });
  });

  return fs.realpathSync(created);
}

/**
 * Writes a file inside a fixture directory, creating parent directories.
 *
 * @param dir - Fixture root directory.
 * @param relativePath - Path relative to `dir`, may contain `/` separators.
 * @param contents - File contents to write, verbatim (no newline is appended).
 * @returns The absolute path of the written file.
 */
export function writeFile(dir: string, relativePath: string, contents: string): string {
  const target = path.join(dir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
  return target;
}

/**
 * Writes a small but structurally valid binary PNG, for asset-embedding tests.
 *
 * @param dir - Fixture root directory.
 * @param relativePath - Path relative to `dir`.
 * @returns The absolute path of the written file.
 */
export function writePng(dir: string, relativePath: string): string {
  const target = path.join(dir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return target;
}

/**
 * Builds a complete {@link ConverterOptions} value with harmless defaults.
 *
 * The package selectors are set to the production defaults; no test in this
 * suite reaches a step that actually spawns `npx`.
 *
 * @param overrides - Fields to override.
 * @returns Converter options usable by any step under test.
 */
export function makeOptions(overrides: Partial<ConverterOptions> = {}): ConverterOptions {
  return {
    stylesheet: undefined,
    cssVars: [],
    outputDir: undefined,
    tempRoot: undefined,
    tempInOutput: false,
    forceDoctoc: false,
    updateMdToc: false,
    keepTemp: false,
    verbose: false,
    debug: false,
    png: false,
    recursive: false,
    merge: undefined,
    packages: {
      doctoc: 'doctoc@2.3.0',
      mermaidCli: '@mermaid-js/mermaid-cli@11.12.0',
      mdToPdf: 'md-to-pdf@5.2.5',
    },
    ...overrides,
  };
}

/**
 * Builds a {@link ConversionContext} for the steps that only read a couple of
 * its fields, without going through `prepareWorkdir` (which would create a
 * temp directory of its own).
 *
 * @param overrides - Fields to override; `sourceFile` drives the derived defaults.
 * @returns A fully populated conversion context.
 */
export function makeContext({
  sourceFile: rawSourceFile,
  ...overrides
}: Partial<ConversionContext> & { sourceFile: string }): ConversionContext {
  const sourceFile = path.resolve(rawSourceFile);
  const baseName = path.basename(sourceFile);
  const stem = path.parse(baseName).name;
  const sourceDir = path.dirname(sourceFile);
  const workdir = overrides.workdir ?? sourceDir;
  const targetDir = overrides.targetDir ?? sourceDir;

  return {
    options: makeOptions(),
    sourceFile,
    sourceDir,
    baseName,
    stem,
    workdir,
    inputMarkdown: sourceFile,
    convertedMarkdown: path.join(workdir, `${stem}_converted.md`),
    targetDir,
    outputPdf: path.join(targetDir, `${stem}.pdf`),
    tempPdf: path.join(workdir, `${stem}_converted.pdf`),
    outputHtml: path.join(targetDir, `${stem}.html`),
    tempHtml: path.join(workdir, `${stem}_converted.html`),
    docTitle: stem,
    ...overrides,
  };
}

/**
 * Creates a symbolic link, reporting whether the platform allowed it.
 *
 * Creating symlinks on Windows requires either Developer Mode or elevation,
 * so the symlink-related tests skip themselves instead of failing when this
 * returns `false`.
 *
 * @param target - Link target path.
 * @param linkPath - Path of the link to create.
 * @param type - Link type; `'dir'` is required for directory links on Windows.
 * @returns `true` when the link was created.
 */
export function trySymlink(target: string, linkPath: string, type: 'file' | 'dir'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a Windows directory junction, reporting whether it worked.
 *
 * Junctions need no special privileges on Windows, which makes them the case
 * users actually hit. On other platforms this always returns `false`.
 *
 * @param target - Directory the junction should point at.
 * @param linkPath - Path of the junction to create.
 * @returns `true` when the junction was created.
 */
export function tryJunction(target: string, linkPath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    fs.symlinkSync(target, linkPath, 'junction');
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalises a path for comparison in assertions: forward slashes everywhere,
 * and lowercased on Windows, where the filesystem is case-insensitive.
 *
 * @param value - Path to normalise.
 * @returns The comparable form of the path.
 */
export function comparablePath(value: string): string {
  const slashed = value.split(path.sep).join('/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * Maps a list of absolute paths to their file names, for order assertions.
 *
 * @param files - Absolute file paths.
 * @returns The base names in the same order.
 */
export function names(files: string[]): string[] {
  return files.map((file) => path.basename(file));
}
