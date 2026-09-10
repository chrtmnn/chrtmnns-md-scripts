import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { ConverterOptions } from '../types';
import { parseCssVars, parseMergeName } from './option-values';
import { configDirectory, findStylesheet, INVOCATION_DIR_ENV } from './stylesheet-lookup';

/**
 * Reports whether a path is an existing file. A directory that happens to
 * carry the stylesheet's name does not count, so the lookup moves on.
 *
 * @param file - Absolute path to check.
 * @returns True when `file` exists and is a regular file.
 */
function isFile(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

type RawOptions = {
  stylesheet?: string;
  cssVar: string[];
  outputDir?: string;
  tempRoot?: string;
  tempInOutput?: boolean;
  forceDoctoc?: boolean;
  updateMdToc?: boolean;
  keepTemp?: boolean;
  verbose?: boolean;
  debug?: boolean;
  png?: boolean;
  recursive?: boolean;
  merge?: string;
};

/**
 * Commander collector for repeatable CLI options.
 *
 * @param value - Newly parsed option value.
 * @param previous - Previously collected values for the same option.
 * @returns A new array containing all collected values.
 */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Resolves and validates raw Commander options into the internal options shape.
 *
 * @param program - Parsed Commander program instance.
 * @returns Converter options with defaults, package selectors, and CSS overrides resolved.
 */
export function resolveOptions(program: Command): ConverterOptions {
  const rawOptions = program.opts<RawOptions>();
  let stylesheet: string | undefined;

  if (rawOptions.stylesheet) {
    // Relative values and bare names refer to the caller's directory, which
    // the global wrapper passes in because it runs pnpm from the repo root.
    stylesheet = findStylesheet(
      rawOptions.stylesheet,
      process.env[INVOCATION_DIR_ENV] || process.cwd(),
      configDirectory(process.env, os.homedir()),
      isFile,
    );
  } else {
    const defaultStylesheet = path.resolve(__dirname, '..', 'css', 'default.css');
    if (fs.existsSync(defaultStylesheet)) {
      stylesheet = defaultStylesheet;
    }
  }

  return {
    stylesheet,
    cssVars: parseCssVars(rawOptions.cssVar),
    outputDir: rawOptions.outputDir,
    tempRoot: rawOptions.tempRoot,
    tempInOutput: Boolean(rawOptions.tempInOutput),
    forceDoctoc: Boolean(rawOptions.forceDoctoc),
    updateMdToc: Boolean(rawOptions.updateMdToc),
    keepTemp: Boolean(rawOptions.keepTemp),
    verbose: Boolean(rawOptions.verbose),
    debug: Boolean(rawOptions.debug),
    png: Boolean(rawOptions.png),
    recursive: Boolean(rawOptions.recursive),
    merge: rawOptions.merge === undefined ? undefined : parseMergeName(rawOptions.merge),
    packages: {
      doctoc: process.env.DOCTOC_PKG || 'doctoc@2.3.0',
      mermaidCli: process.env.MERMAID_CLI_PKG || '@mermaid-js/mermaid-cli@11.12.0',
      mdToPdf: process.env.MD_TO_PDF_PKG || 'md-to-pdf@5.2.5',
    },
  };
}
