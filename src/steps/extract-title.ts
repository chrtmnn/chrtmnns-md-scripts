import fs from 'fs';
import { ConversionContext } from '../types';

/**
 * Extracts the first Markdown heading and stores it as the document title.
 *
 * Leaves the existing fallback title unchanged when no heading is present.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function extractTitle(context: ConversionContext): void {
  const content = fs.readFileSync(context.inputMarkdown, 'utf8');
  const headingMatch = content.match(/^\s*#+\s*(.*)/m);

  if (headingMatch) {
    context.docTitle = headingMatch[1].trim();
  }
}
