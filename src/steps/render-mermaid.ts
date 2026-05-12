import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

/**
 * Renders Mermaid fences to SVG assets and writes the converted Markdown file.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderMermaid(context: ConversionContext): void {
  console.log(`Running mermaid-cli on ${context.inputMarkdown}...`);
  runNpx([context.options.packages.mermaidCli, '-i', context.inputMarkdown, '-o', context.convertedMarkdown]);
}
