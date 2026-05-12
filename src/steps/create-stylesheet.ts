import fs from 'fs';
import path from 'path';
import { ConversionContext } from '../types';

/**
 * Resolves the stylesheet that should be passed to md-to-pdf.
 *
 * If CSS variable overrides were provided, this step writes a merged stylesheet
 * into the work directory and stores that path on the context.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function createStylesheet(context: ConversionContext): void {
  if (context.options.cssVars.length === 0) {
    context.effectiveStylesheet = context.options.stylesheet;
    return;
  }

  const overrideStylesheet = path.join(context.workdir, 'style-overrides.css');
  const lines: string[] = [];

  if (context.options.stylesheet) {
    lines.push(fs.readFileSync(context.options.stylesheet, 'utf8'));
    lines.push('');
  }

  lines.push(':root {');
  context.options.cssVars.forEach(({ name, value }) => {
    lines.push(`  ${name}: ${value};`);
  });
  lines.push('}');
  lines.push('');

  fs.writeFileSync(overrideStylesheet, lines.join('\n'), 'utf8');
  context.effectiveStylesheet = overrideStylesheet;
}
