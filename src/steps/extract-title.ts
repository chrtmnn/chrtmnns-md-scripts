import fs from 'fs';
import { ConversionContext } from '../types';

export function extractTitle(context: ConversionContext): void {
  const content = fs.readFileSync(context.inputMarkdown, 'utf8');
  const headingMatch = content.match(/^\s*#+\s*(.*)/m);

  if (headingMatch) {
    context.docTitle = headingMatch[1].trim();
  }
}
