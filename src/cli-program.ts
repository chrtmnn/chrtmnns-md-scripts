import { Command, Option } from 'commander';
import { collect } from './steps/resolve-options';

/**
 * Declares the md2pdf command line without parsing it.
 *
 * Kept out of `md2pdf.ts`, which parses `process.argv` as soon as it is
 * imported, so the tests parse against the very same declarations, option
 * conflicts included, instead of a hand-kept copy that could drift.
 *
 * @returns A fresh, unparsed Commander program.
 */
export function createProgram(): Command {
  return new Command()
    .name('md2pdf')
    .description('Render Mermaid diagrams and convert Markdown to PDF')
    .argument('[files...]', 'Markdown files or directories to convert')
    .option('-R, --recursive', 'Expand directory arguments recursively')
    .option('--merge <name>', 'Merge all resolved Markdown files into a single PDF with this base name')
    .option(
      '-s, --stylesheet <path>',
      'Stylesheet path, or the name of a stylesheet in ~/.md2pdf (".css" optional); "default" forces the bundled one',
    )
    .option('--css-var <name=value>', 'Override a CSS custom property, repeatable', collect, [])
    .option('-o, --output-dir <path>', 'Output directory for PDFs')
    .option('-r, --temp-root <path>', 'Root directory for temp work dirs')
    // Both options place the temp directory, so a run given both would have
    // to drop one of them silently (#60).
    .addOption(new Option('-p, --temp-in-output', 'Place temp dir inside the output directory').conflicts('tempRoot'))
    .option('-f, --force-doctoc', 'Force doctoc even when no TOC markers are present')
    .option('-u, --update-md-toc', 'Update an existing doctoc table of contents in the source Markdown')
    .option('-k, --keep-temp', 'Keep temp working directory')
    .option('--verbose', 'Print output from external conversion tools')
    .option('--debug', 'Also emit a standalone HTML file next to the PDF')
    .option('--png', 'Render Mermaid diagrams as PNG instead of SVG');
}
