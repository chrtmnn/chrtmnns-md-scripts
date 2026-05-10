import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ConversionContext } from '../types';

export function runDoctoc(context: ConversionContext): void {
  if (!context.options.runDoctoc) {
    return;
  }

  context.inputMarkdown = path.join(context.workdir, context.baseName);
  fs.copyFileSync(context.sourceFile, context.inputMarkdown);
  console.log(`Running doctoc on ${context.inputMarkdown}...`);
  execSync(`npx ${context.options.packages.doctoc} "${context.inputMarkdown}"`, { stdio: 'inherit' });
}
