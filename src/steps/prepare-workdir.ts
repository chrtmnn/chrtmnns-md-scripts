import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';
import { deriveOutputPaths } from './output-targets';

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
  const sourceDir = path.dirname(absSrc);
  const { stem, targetDir, outputPdf, outputHtml } = deriveOutputPaths(absSrc, options.outputDir);

  let workdir: string;
  if (options.tempInOutput) {
    const baseOut = options.outputDir ? path.resolve(options.outputDir) : sourceDir;
    fs.mkdirSync(baseOut, { recursive: true });
    workdir = fs.mkdtempSync(path.join(baseOut, `${stem}_`));
  } else if (options.tempRoot) {
    const tempRoot = path.resolve(options.tempRoot);
    fs.mkdirSync(tempRoot, { recursive: true });
    workdir = fs.mkdtempSync(path.join(tempRoot, `${stem}_`));
  } else {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), `${stem}_`));
  }

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
    outputPdf,
    tempPdf: path.join(workdir, `${stem}_converted.pdf`),
    outputHtml,
    tempHtml: path.join(workdir, `${stem}_converted.html`),
    docTitle: stem,
  };
}
