import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

/**
 * Renders the converted Markdown to a standalone HTML file for inspection.
 *
 * Uses md-to-pdf's `--as-html` flag so the embedded styles, document title,
 * and Mermaid SVGs match the PDF output exactly.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderHtml(context: ConversionContext): void {
  const args = [
    context.options.packages.mdToPdf,
    context.convertedMarkdown,
    '--basedir',
    context.workdir,
    '--document-title',
    context.docTitle,
    '--as-html',
  ];

  if (context.effectiveStylesheet) {
    args.push('--stylesheet', context.effectiveStylesheet);
  }

  runNpx(args, { verbose: context.options.verbose });
}
