import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ConversionContext } from '../types';

const DOCTOC_MARKER = '<!-- START doctoc generated TOC';

function hasTocMarkers(filePath: string): boolean {
  return fs.readFileSync(filePath, 'utf8').includes(DOCTOC_MARKER);
}

export function runDoctoc(context: ConversionContext): void {
  const shouldRun = context.options.forceDoctoc || hasTocMarkers(context.sourceFile);
  if (!shouldRun) {
    return;
  }

  context.inputMarkdown = path.join(context.workdir, context.baseName);
  fs.copyFileSync(context.sourceFile, context.inputMarkdown);
  console.log(`Running doctoc on ${context.inputMarkdown}...`);
  execSync(`npx ${context.options.packages.doctoc} "${context.inputMarkdown}"`, { stdio: 'inherit' });
}
