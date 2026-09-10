/**
 * Resolution of the parsed Commander options into `ConverterOptions`.
 *
 * `md2pdf.ts` parses `process.argv` as soon as it is imported, so the program
 * is rebuilt here with the same option definitions. Keep `parse` in step with
 * the `program` declaration in `md2pdf.ts`.
 */

import path from 'path';
import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { collect, resolveOptions } from '../steps/resolve-options';
import { comparablePath, tempDir, writeFile } from './helpers';

const PACKAGE_ENV_VARS = ['DOCTOC_PKG', 'MERMAID_CLI_PKG', 'MD_TO_PDF_PKG'] as const;

function parse(args: string[]): Command {
  return new Command()
    .exitOverride()
    .argument('[files...]')
    .option('-R, --recursive')
    .option('--merge <name>')
    .option('-s, --stylesheet <path>')
    .option('--css-var <name=value>', '', collect, [])
    .option('-o, --output-dir <path>')
    .option('-r, --temp-root <path>')
    .option('-p, --temp-in-output')
    .option('-f, --force-doctoc')
    .option('-u, --update-md-toc')
    .option('-k, --keep-temp')
    .option('--verbose')
    .option('--debug')
    .option('--png')
    .parse(args, { from: 'user' });
}

/**
 * Sets the package override variables for one test and restores the caller's
 * values afterwards, so a developer's own `DOCTOC_PKG` cannot leak in.
 */
function withPackageEnv(t: TestContext, values: Partial<Record<(typeof PACKAGE_ENV_VARS)[number], string>>): void {
  const saved = PACKAGE_ENV_VARS.map((name) => [name, process.env[name]] as const);

  t.after(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  for (const name of PACKAGE_ENV_VARS) {
    const value = values[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

test('collect appends without mutating the previous values', () => {
  const previous = ['a=1'];

  assert.deepEqual(collect('b=2', previous), ['a=1', 'b=2']);
  assert.deepEqual(previous, ['a=1']);
});

test('falls back to the bundled default stylesheet', () => {
  const options = resolveOptions(parse(['doc.md']));

  assert.equal(
    comparablePath(options.stylesheet!),
    comparablePath(path.resolve(__dirname, '..', 'css', 'default.css')),
  );
});

test('keeps an existing custom stylesheet as given', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'custom.css', 'body {}\n');

  assert.equal(resolveOptions(parse(['-s', stylesheet, 'doc.md'])).stylesheet, stylesheet);
});

test('rejects a stylesheet that does not exist', (t) => {
  const missing = path.join(tempDir(t), 'missing.css');

  assert.throws(() => resolveOptions(parse(['-s', missing, 'doc.md'])), {
    message: `Stylesheet not found: ${missing}`,
  });
});

test('defaults every flag to false and the optional values to undefined', () => {
  const options = resolveOptions(parse(['doc.md']));

  assert.deepEqual(
    [options.tempInOutput, options.forceDoctoc, options.updateMdToc, options.keepTemp],
    [false, false, false, false],
  );
  assert.deepEqual([options.verbose, options.debug, options.png, options.recursive], [false, false, false, false]);
  assert.equal(options.outputDir, undefined);
  assert.equal(options.tempRoot, undefined);
  assert.equal(options.merge, undefined);
  assert.deepEqual(options.cssVars, []);
});

test('turns every flag on when it is given', () => {
  const options = resolveOptions(parse(['-R', '-p', '-f', '-u', '-k', '--verbose', '--debug', '--png', 'doc.md']));

  assert.deepEqual(
    [options.tempInOutput, options.forceDoctoc, options.updateMdToc, options.keepTemp],
    [true, true, true, true],
  );
  assert.deepEqual([options.verbose, options.debug, options.png, options.recursive], [true, true, true, true]);
});

test('passes the directory options through unchanged', () => {
  const options = resolveOptions(parse(['-o', 'out', '-r', 'scratch', 'doc.md']));

  assert.equal(options.outputDir, 'out');
  assert.equal(options.tempRoot, 'scratch');
});

test('parses repeated --css-var values in order', () => {
  const options = resolveOptions(parse(['--css-var', 'font-text=Aptos', '--css-var', '--page-size=A5', 'doc.md']));

  assert.deepEqual(options.cssVars, [
    { name: '--font-text', value: 'Aptos' },
    { name: '--page-size', value: 'A5' },
  ]);
});

test('validates the option values while resolving', () => {
  assert.throws(() => resolveOptions(parse(['--css-var', 'no-separator', 'doc.md'])), /Expected name=value/);
  assert.throws(() => resolveOptions(parse(['--merge', 'out/report', 'doc.md'])), /without path separators/);
});

test('normalises the --merge name', () => {
  assert.equal(resolveOptions(parse(['--merge', 'report.pdf', 'doc.md'])).merge, 'report');
});

test('uses the pinned package versions without overrides', (t) => {
  withPackageEnv(t, {});

  assert.deepEqual(resolveOptions(parse(['doc.md'])).packages, {
    doctoc: 'doctoc@2.3.0',
    mermaidCli: '@mermaid-js/mermaid-cli@11.12.0',
    mdToPdf: 'md-to-pdf@5.2.5',
  });
});

test('takes package selectors from the environment', (t) => {
  withPackageEnv(t, {
    DOCTOC_PKG: 'doctoc@latest',
    MERMAID_CLI_PKG: '@mermaid-js/mermaid-cli@10.0.0',
    MD_TO_PDF_PKG: 'md-to-pdf@5.0.0',
  });

  assert.deepEqual(resolveOptions(parse(['doc.md'])).packages, {
    doctoc: 'doctoc@latest',
    mermaidCli: '@mermaid-js/mermaid-cli@10.0.0',
    mdToPdf: 'md-to-pdf@5.0.0',
  });
});

test('treats an empty package variable as unset', (t) => {
  withPackageEnv(t, { DOCTOC_PKG: '' });

  assert.equal(resolveOptions(parse(['doc.md'])).packages.doctoc, 'doctoc@2.3.0');
});
