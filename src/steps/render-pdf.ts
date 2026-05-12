import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

/**
 * Converts the Mermaid-processed Markdown file to PDF through md-to-pdf.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderPdf(context: ConversionContext): void {
  const args = [
    context.options.packages.mdToPdf,
    context.convertedMarkdown,
    '--basedir',
    context.workdir,
    '--document-title',
    context.docTitle,
  ];

  if (context.effectiveStylesheet) {
    args.push('--stylesheet', context.effectiveStylesheet);
  }

  runNpx(args, { verbose: context.options.verbose });
}
