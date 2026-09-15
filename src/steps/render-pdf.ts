import { ConversionContext } from '../types';
import { buildMdToPdfArgs } from './md-to-pdf-args';
import { runTool } from './run-tool';

/**
 * Converts the Mermaid-processed Markdown file to PDF through md-to-pdf.
 *
 * The arguments come from `buildMdToPdfArgs`, which `renderHtml` shares, so
 * the two outputs cannot be configured differently. The document's own assets
 * reach the renderer through `inlineAssets`, which embeds them before this
 * step runs.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderPdf(context: ConversionContext): void {
  runTool('mdToPdf', buildMdToPdfArgs(context), context.options);
}
