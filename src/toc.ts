#!/usr/bin/env node

import { execSync } from 'child_process';
import { program } from 'commander';

program
  .name('toc')
  .description('Inject or update a Markdown table of contents via doctoc')
  .argument('<files...>', 'Markdown files to update')
  .parse(process.argv);

const doctocPackage = process.env.DOCTOC_PKG || 'doctoc@2.3.0';

for (const file of program.args) {
  console.log(`Running doctoc on ${file}...`);
  execSync(`npx ${doctocPackage} "${file}"`, { stdio: 'inherit' });
}
