import { execSync } from 'child_process';
import { ConversionContext } from '../types';

export function renderPdf(context: ConversionContext): void {
  console.log(`Running md-to-pdf on ${context.convertedMarkdown}...`);

  let command = `npx ${context.options.packages.mdToPdf} "${context.convertedMarkdown}" --basedir "${context.workdir}" --document-title "${context.docTitle}"`;
  if (context.effectiveStylesheet) {
    command += ` --stylesheet "${context.effectiveStylesheet}"`;
  }

  execSync(command, { stdio: 'inherit' });
}
