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
  keepTemp?: boolean;
};

export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

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
    keepTemp: Boolean(rawOptions.keepTemp),
    packages: {
      doctoc: process.env.DOCTOC_PKG || 'doctoc@2.3.0',
      mermaidCli: process.env.MERMAID_CLI_PKG || '@mermaid-js/mermaid-cli@11.12.0',
      mdToPdf: process.env.MD_TO_PDF_PKG || 'md-to-pdf@5.2.5',
    },
  };
}

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
