#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { program } from 'commander';
import { collect, resolveOptions } from './steps/resolve-options';

program
  .name('pdf')
  .description('Convert Markdown files to PDF via md-to-pdf')
  .argument('<files...>', 'Markdown files to convert')
  .option('-s, --stylesheet <path>', 'Stylesheet passed to md-to-pdf')
  .option('--css-var <name=value>', 'Override a CSS custom property, repeatable', collect, [])
  .option('-o, --output-dir <path>', 'Output directory for PDFs')
  .parse(process.argv);

const options = resolveOptions(program);

for (const file of program.args) {
  if (!fs.existsSync(file)) {
    console.warn(`File not found: ${file}`);
    continue;
  }

  const sourceFile = path.resolve(file);
  const stem = path.parse(sourceFile).name;
  const sourceDir = path.dirname(sourceFile);
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : sourceDir;
  const outputPdf = path.join(outputDir, `${stem}.pdf`);
  const generatedPdf = path.join(sourceDir, `${stem}.pdf`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${stem}_`));
  const stylesheet = createEffectiveStylesheet(tempDir, options.stylesheet, options.cssVars);

  fs.mkdirSync(outputDir, { recursive: true });

  try {
    let command = `npx ${options.packages.mdToPdf} "${sourceFile}" --basedir "${sourceDir}" --document-title "${extractTitle(sourceFile, stem)}"`;
    if (stylesheet) {
      command += ` --stylesheet "${stylesheet}"`;
    }

    console.log(`Running md-to-pdf on ${sourceFile}...`);
    execSync(command, { stdio: 'inherit' });
    if (generatedPdf !== outputPdf) {
      fs.copyFileSync(generatedPdf, outputPdf);
    }
    console.log(`Created: ${outputPdf}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractTitle(file: string, fallback: string): string {
  const content = fs.readFileSync(file, 'utf8');
  const headingMatch = content.match(/^\s*#+\s*(.*)/m);
  return headingMatch ? headingMatch[1].trim() : fallback;
}

function createEffectiveStylesheet(
  tempDir: string,
  stylesheet: string | undefined,
  cssVars: { name: string; value: string }[],
): string | undefined {
  if (cssVars.length === 0) {
    return stylesheet;
  }

  const overrideStylesheet = path.join(tempDir, 'style-overrides.css');
  const lines: string[] = [];

  if (stylesheet) {
    lines.push(fs.readFileSync(stylesheet, 'utf8'));
    lines.push('');
  }

  lines.push(':root {');
  cssVars.forEach(({ name, value }) => {
    lines.push(`  ${name}: ${value};`);
  });
  lines.push('}');
  lines.push('');

  fs.writeFileSync(overrideStylesheet, lines.join('\n'), 'utf8');
  return overrideStylesheet;
}
