#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { program } from 'commander';

program
  .name('diagrams')
  .description('Render Mermaid diagrams in Markdown and write converted Markdown')
  .argument('<files...>', 'Markdown files to process')
  .option('-o, --output-dir <path>', 'Output directory for converted Markdown files')
  .parse(process.argv);

const mermaidCliPackage = process.env.MERMAID_CLI_PKG || '@mermaid-js/mermaid-cli@11.12.0';
const options = program.opts<{ outputDir?: string }>();

for (const file of program.args) {
  const outputPath = resolveOutputPath(file, options.outputDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  console.log(`Running mermaid-cli on ${file}...`);
  execSync(`npx ${mermaidCliPackage} -i "${file}" -o "${outputPath}"`, { stdio: 'inherit' });
}

function resolveOutputPath(file: string, outputDir?: string): string {
  const parsed = path.parse(file);
  const targetDir = outputDir ? path.resolve(outputDir) : parsed.dir || '.';
  return path.join(targetDir, `${parsed.name}_converted${parsed.ext}`);
}
