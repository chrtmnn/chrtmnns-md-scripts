import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { ConverterOptions, CssVarOverride } from '../types';

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
    packages: {
      doctoc: process.env.DOCTOC_PKG || 'doctoc@2.3.0',
      mermaidCli: process.env.MERMAID_CLI_PKG || '@mermaid-js/mermaid-cli@11.12.0',
      mdToPdf: process.env.MD_TO_PDF_PKG || 'md-to-pdf@5.2.5',
    },
  };
}

/**
 * Parses `--css-var name=value` entries into normalized CSS custom properties.
 *
 * @param values - Raw CLI values collected from `--css-var`.
 * @returns Validated CSS variable overrides.
 */
function parseCssVars(values: string[]): CssVarOverride[] {
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
