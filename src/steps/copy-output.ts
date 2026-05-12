import fs from 'fs';
import { ConversionContext } from '../types';

/**
 * Copies the generated PDF from the temporary work directory to the target path.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function copyOutput(context: ConversionContext): void {
  if (fs.existsSync(context.tempPdf)) {
    fs.copyFileSync(context.tempPdf, context.outputPdf);
    return;
  }

  throw new Error(`PDF generation failed. Expected: ${context.tempPdf}`);
}
