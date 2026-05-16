import fs from 'fs';
import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

const MERMAID_FENCE_RE = /^[ \t]{0,3}(?:```|~~~)\s*mermaid\b/m;

/**
 * Detects whether a Markdown file contains at least one Mermaid code fence.
 *
 * Indented fences (up to three leading spaces) and both backtick and tilde
 * delimiters are recognised. Fences embedded inside HTML wrappers such as
 * `<pre><code>` are not matched because they do not begin at line start.
 *
 * @param filePath - Markdown file to inspect.
 */
export function hasMermaidFences(filePath: string): boolean {
  return MERMAID_FENCE_RE.test(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Renders Mermaid fences to SVG assets and writes the converted Markdown file.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function renderMermaid(context: ConversionContext): void {
  runNpx(
    [context.options.packages.mermaidCli, '-i', context.inputMarkdown, '-o', context.convertedMarkdown],
    { verbose: context.options.verbose },
  );
}
