import fs from 'fs';
import path from 'path';
import { Command, Option } from 'commander';
import { collect } from './steps/resolve-options';

/**
 * Help sections, keyed by the long flag of every option that belongs in them.
 *
 * The flat list of 13 options named after the implementation was the first
 * complaint in #59. The grouped block is rendered here and appended to the
 * help; it predates Commander 14's `Option.helpGroup()`, which could replace it.
 * `cli-program.test.ts` asserts that every visible option appears in exactly
 * one group, which is what keeps the two from drifting apart.
 */
const HELP_GROUPS: { title: string; flags: string[] }[] = [
  { title: 'Input', flags: ['--recursive', '--merge'] },
  { title: 'Output', flags: ['--output-dir', '--title', '--html'] },
  { title: 'Styling', flags: ['--stylesheet', '--css-var'] },
  { title: 'TOC', flags: ['--toc', '--no-toc', '--write-toc'] },
  { title: 'Diagrams', flags: ['--png'] },
  {
    title: 'Diagnostics',
    flags: ['--verbose', '--debug', '--keep-temp', '--temp-root', '--temp-in-output', '--version', '--help'],
  },
];

/**
 * Reads the package version for `--version`.
 *
 * Resolved from disk rather than imported, because `package.json` sits outside
 * the TypeScript `rootDir`.
 *
 * @returns The version string, or `0.0.0` when the file cannot be read.
 */
export function packageVersion(): string {
  try {
    const manifest = fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Renders the grouped options block that replaces Commander's flat list.
 *
 * Hidden options — the previous names, kept working but no longer advertised
 * — are skipped, and every group column is aligned to the widest flag string
 * across all groups, so the sections read as one table.
 *
 * @param program - The declared program.
 * @returns The help text to append, without a trailing newline.
 */
export function formatOptionGroups(program: Command): string {
  const byFlag = new Map<string, { flags: string; description: string }>();
  for (const option of program.options) {
    if (!option.hidden) {
      byFlag.set(option.long ?? option.flags, { flags: option.flags, description: option.description });
    }
  }

  // Commander creates the help option lazily, so it is not in `program.options`.
  byFlag.set('--help', { flags: '-h, --help', description: 'Show this help' });

  const width = Math.max(...[...byFlag.values()].map((row) => row.flags.length));
  const lines: string[] = [''];

  for (const { title, flags } of HELP_GROUPS) {
    const rows = flags.map((flag) => byFlag.get(flag)).filter((row) => row !== undefined);
    if (rows.length === 0) {
      continue;
    }

    lines.push(`${title}:`);
    for (const row of rows) {
      lines.push(`  ${row.flags.padEnd(width)}  ${row.description}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Declares the md2pdf command line without parsing it.
 *
 * Kept out of `md2pdf.ts`, which parses `process.argv` as soon as it is
 * imported, so the tests parse against the very same declarations, option
 * conflicts included, instead of a hand-kept copy that could drift.
 *
 * The option names describe what the user wants, not how it is implemented
 * (#59). Every previous name is still accepted as a hidden alias, so existing
 * command lines and scripts keep working:
 *
 * | Name | Previous name |
 * |---|---|
 * | `--toc` | `-f`, `--force-doctoc` |
 * | `-u, --write-toc` | `--update-md-toc` |
 * | `--html` | `--debug` (which now also implies `--keep-temp --verbose`) |
 * | `--keep-temp` | `-k` |
 * | `--temp-root` | `-r` |
 * | `--temp-in-output` | `-p` |
 *
 * The three `*-alias` long names exist only because Commander cannot give one
 * option two long forms; the short flag is the form that was freed up here.
 *
 * @returns A fresh, unparsed Commander program.
 */
export function createProgram(): Command {
  const program = new Command()
    .name('md2pdf')
    .description('Render Mermaid diagrams and convert Markdown to PDF')
    .version(packageVersion(), '-V, --version', 'Print the version number')
    .argument('[files...]', 'Markdown files or directories to convert')
    .option('-R, --recursive', 'Expand directory arguments recursively')
    .option('--merge <name>', 'Merge all resolved Markdown files into a single PDF with this base name')
    .option('-o, --output-dir <dir>', 'Output directory for PDFs')
    .option('--title <text>', 'Document title, instead of the first heading (or the --merge name)')
    .option('--html', 'Also emit a standalone HTML file next to the PDF')
    .option(
      '-s, --stylesheet <name|path>',
      'Stylesheet path, or the name of a stylesheet in ~/.md2pdf (".css" optional); "default" forces the bundled one',
    )
    // The default is an empty array, which Commander would advertise as
    // "(default: [])"; the grouped help prints descriptions only (#59).
    .addOption(
      new Option('--css-var <name=value>', 'Override a CSS custom property, repeatable')
        .argParser(collect)
        .default([]),
    )
    .option('--toc', 'Build a table of contents even when the source has no doctoc markers')
    .option('--no-toc', 'Never build or refresh a table of contents')
    .option('-u, --write-toc', 'Write the refreshed table of contents back into the source Markdown')
    .option('--png', 'Render Mermaid diagrams as PNG instead of SVG')
    .option('-v, --verbose', 'Print output from external conversion tools')
    .option('--debug', 'Shorthand for --html --keep-temp --verbose')
    .option('--keep-temp', 'Keep the temp working directory')
    .option('--temp-root <dir>', 'Root directory for temp work dirs');

  // Both options place the temp directory, so a run given both would have to
  // drop one of them silently (#60). The aliases conflict the same way.
  const tempRootNames = ['tempRoot', 'tempRootAlias'];
  program
    .addOption(
      new Option('--temp-in-output', 'Place the temp dir inside the output directory').conflicts(tempRootNames),
    )
    .addOption(new Option('-p, --temp-in-output-alias').hideHelp().conflicts(tempRootNames))
    .addOption(new Option('-r, --temp-root-alias <dir>').hideHelp())
    .addOption(new Option('-k, --keep-temp-alias').hideHelp())
    .addOption(new Option('-f, --force-doctoc').hideHelp())
    .addOption(new Option('--update-md-toc').hideHelp());

  return program.configureHelp({ visibleOptions: () => [] }).addHelpText('after', () => formatOptionGroups(program));
}
