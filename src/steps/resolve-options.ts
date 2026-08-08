import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { ConverterOptions } from '../types';
import { parseCssVars, parseMergeName } from './option-values';

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
  let stylesheet = rawOptions.stylesheet;

  if (!stylesheet) {
    const defaultStylesheet = path.resolve(__dirname, '..', 'css', 'default.css');
    if (fs.existsSync(defaultStylesheet)) {
      stylesheet = defaultStylesheet;
    }
  }

  if (stylesheet && !fs.existsSync(stylesheet)) {
    throw new Error(`Stylesheet not found: ${stylesheet}`);
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
