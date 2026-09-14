import fs from 'fs';
import { ConversionContext } from '../types';
import { stampGeneratedHtml } from './output-targets';
import { runTool } from './run-tool';

/**
 * Renders the converted Markdown to a standalone HTML file for inspection.
 *
 * Uses md-to-pdf's `--as-html` flag so the embedded styles, document title,
 * and Mermaid SVGs match the PDF output exactly. `--basedir` is the work
 * directory for the same reason as in `render-pdf.ts`; document assets are
 * already embedded by `inlineAssets`, which also makes the emitted HTML
 * self-contained once it is copied next to the PDF.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderHtml(context: ConversionContext): void {
  const args = [
    context.convertedMarkdown,
    '--basedir',
    context.workdir,
    // Inline, not two argv elements: md-to-pdf's parser takes the following
    // token for a flag when the title starts with `--`, so a first heading of
    // `# --version` aborted the run with a raw Node stack trace (#51).
    `--document-title=${context.docTitle}`,
    '--as-html',
  ];

  if (context.effectiveStylesheet) {
    args.push('--stylesheet', context.effectiveStylesheet);
  }

  runTool('mdToPdf', args, context.options);

  // The marker lets a later run tell its own HTML apart from a hand-written
  // file at the same path. A missing file is reported by copyOutput.
  if (fs.existsSync(context.tempHtml)) {
    fs.writeFileSync(context.tempHtml, stampGeneratedHtml(fs.readFileSync(context.tempHtml, 'utf8')), 'utf8');
  }
}
