import path from 'path';
import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

/**
 * md-to-pdf config file that sets `pdf_options.preferCSSPageSize`, so the
 * stylesheet's `@page { size }` decides the paper size instead of Puppeteer's
 * `format: 'a4'` default.
 *
 * Passed through `--config-file` rather than `--pdf-options`: md-to-pdf assigns
 * `--pdf-options` over `pdf_options` wholesale, which would drop its
 * `printBackground` / `format` / `margin` defaults and any front-matter
 * `pdf_options`. A config file is merged onto the defaults instead, and front
 * matter still takes precedence over it.
 */
const MD_TO_PDF_CONFIG = path.resolve(__dirname, '..', 'config', 'md-to-pdf.config.json');

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
    '--config-file',
    MD_TO_PDF_CONFIG,
  ];

  if (context.effectiveStylesheet) {
    args.push('--stylesheet', context.effectiveStylesheet);
  }

  runNpx(args, { verbose: context.options.verbose });
}
