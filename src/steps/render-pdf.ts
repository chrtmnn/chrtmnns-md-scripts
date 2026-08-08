import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

/**
 * Converts the Mermaid-processed Markdown file to PDF through md-to-pdf.
 *
 * `--basedir` is the work directory rather than the source directory: md-to-pdf
 * serves that directory over HTTP and loads the document from it, so it has to
 * be the directory holding the converted Markdown and the generated Mermaid
 * assets. The document's own assets reach the renderer through `inlineAssets`
 * instead, which embeds them before this step runs.
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
