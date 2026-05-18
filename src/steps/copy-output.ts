import fs from 'fs';
import { ConversionContext } from '../types';

/**
 * Copies the generated PDF (and the debug HTML, when `--debug` is set) from
 * the temporary work directory to the target paths.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function copyOutput(context: ConversionContext): void {
  if (!fs.existsSync(context.tempPdf)) {
    throw new Error(`PDF generation failed. Expected: ${context.tempPdf}`);
  }
  fs.copyFileSync(context.tempPdf, context.outputPdf);

  if (context.options.debug) {
    if (!fs.existsSync(context.tempHtml)) {
      throw new Error(`HTML generation failed. Expected: ${context.tempHtml}`);
    }
    fs.copyFileSync(context.tempHtml, context.outputHtml);
  }
}
