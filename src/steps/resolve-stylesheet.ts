import fs from 'fs';
import path from 'path';
import { ConverterOptions } from '../types';

/**
 * Resolves the stylesheet path for the entire run.
 *
 * When CSS variable overrides are present, writes a merged stylesheet into
 * the given directory and returns its path. Otherwise returns the base
 * stylesheet path unchanged.
 *
 * @param options - Converter options containing the base stylesheet and CSS variable overrides.
 * @param dir - Directory to write the merged stylesheet file into (only used when cssVars is non-empty).
 * @returns Absolute path of the stylesheet to use, or undefined if none is configured.
 */
export function resolveStylesheet(options: ConverterOptions, dir: string): string | undefined {
  if (options.cssVars.length === 0) {
    return options.stylesheet;
  }

  const overrideStylesheet = path.join(dir, 'style-overrides.css');
  const lines: string[] = [];

  if (options.stylesheet) {
    lines.push(fs.readFileSync(options.stylesheet, 'utf8'));
    lines.push('');
  }

  lines.push(':root {');
  options.cssVars.forEach(({ name, value }) => {
    lines.push(`  ${name}: ${value};`);
  });
  lines.push('}');
  lines.push('');

  fs.writeFileSync(overrideStylesheet, lines.join('\n'), 'utf8');
  return overrideStylesheet;
}
