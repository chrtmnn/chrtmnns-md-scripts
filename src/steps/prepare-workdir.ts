import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';

/**
 * Creates the per-file conversion context and temporary work directory.
 *
 * @param sourceFile - Markdown file path received from the CLI.
 * @param options - Resolved converter options for the current run.
 * @returns A populated conversion context, or `undefined` when the source file does not exist.
 */
export function prepareWorkdir(sourceFile: string, options: ConverterOptions): ConversionContext | undefined {
  if (!fs.existsSync(sourceFile)) {
    return undefined;
  }

  const absSrc = path.resolve(sourceFile);
  const baseName = path.basename(sourceFile);
  const stem = path.parse(baseName).name;
  const sourceDir = path.dirname(absSrc);
  const workdirName = `${stem}_${Math.random().toString(36).substring(2, 10)}`;

  let workdir: string;
  if (options.tempInOutput) {
    const baseOut = options.outputDir ? path.resolve(options.outputDir) : sourceDir;
    fs.mkdirSync(baseOut, { recursive: true });
    workdir = path.join(baseOut, workdirName);
  } else if (options.tempRoot) {
    const tempRoot = path.resolve(options.tempRoot);
    fs.mkdirSync(tempRoot, { recursive: true });
    workdir = path.join(tempRoot, workdirName);
  } else {
    workdir = path.join(os.tmpdir(), workdirName);
  }

  fs.mkdirSync(workdir, { recursive: true });

  const targetDir = options.outputDir ? path.resolve(options.outputDir) : sourceDir;
  fs.mkdirSync(targetDir, { recursive: true });

  return {
    options,
    sourceFile: absSrc,
    sourceDir,
    baseName,
    stem,
    workdir,
    inputMarkdown: absSrc,
    convertedMarkdown: path.join(workdir, `${stem}_converted.md`),
    targetDir,
    outputPdf: path.join(targetDir, `${stem}.pdf`),
    tempPdf: path.join(workdir, `${stem}_converted.pdf`),
    docTitle: stem,
  };
}
