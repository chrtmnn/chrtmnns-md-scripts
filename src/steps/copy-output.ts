import fs from 'fs';
import { ConversionContext } from '../types';

export function copyOutput(context: ConversionContext): void {
  if (fs.existsSync(context.tempPdf)) {
    fs.copyFileSync(context.tempPdf, context.outputPdf);
    console.log(`Created: ${context.outputPdf}`);
    return;
  }

  console.error(`PDF generation failed. Expected: ${context.tempPdf}`);
}
