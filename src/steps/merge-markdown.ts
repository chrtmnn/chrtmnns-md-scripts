import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConverterOptions } from '../types';
import { absolutizeImageTargets } from './inline-assets';
import { commonAncestorDirectory, joinDocuments, stripBom } from './merge-assembly';

/**
 * Result of assembling the merged Markdown file.
 */
export type MergedInput = {
  /** Absolute path of the generated merged Markdown file. */
  mergedFile: string;
  /** Temporary directory holding the merged file; removed unless `--keep-temp` is set. */
  mergeDir: string;
  /** Directory the merged PDF should be written to. */
  targetDir: string;
  /** Number of source documents actually concatenated. */
  mergedCount: number;
  /** Positionals that did not exist and were left out of the merge. */
  skipped: string[];
  /** Non-fatal messages the caller should surface. */
  warnings: string[];
};

/**
 * Resolves the temporary directory that holds the merged Markdown file.
 *
 * Mirrors the placement rules of `prepareWorkdir` so `-r/--temp-root` and
 * `-p/--temp-in-output` behave the same for the merge scratch space as for
 * the conversion work directory.
 *
 * @param options - Resolved converter options for the current run.
 * @param targetDir - Directory the merged PDF will be written to.
 * @returns The created temporary directory.
 */
function createMergeDirectory(options: ConverterOptions, targetDir: string): string {
  let base: string;
  if (options.tempInOutput) {
    base = targetDir;
  } else if (options.tempRoot) {
    base = path.resolve(options.tempRoot);
  } else {
    base = os.tmpdir();
  }

  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'merge_'));
}

/**
 * Reads a source document and normalises it for concatenation.
 *
 * Strips a UTF-8 BOM (only the first document may keep one, and keeping none
 * is simplest) and trims trailing whitespace so the caller can guarantee a
 * blank line between documents even when a file does not end in a newline.
 *
 * Image targets are pinned to the document they came from: concatenation is
 * the last moment at which each section's own directory is still known, and
 * `inlineAssets` later embeds those absolute paths as `data:` URIs.
 *
 * @param file - Absolute path of the source Markdown file.
 * @returns The normalised document body without trailing whitespace.
 */
function readDocument(file: string): string {
  const raw = fs.readFileSync(file, 'utf8');
  return absolutizeImageTargets(stripBom(raw).trimEnd(), path.dirname(file));
}

/**
 * Concatenates the resolved Markdown files into a single temporary Markdown
 * file so the existing pipeline can run over it exactly once.
 *
 * No PDF-merging library is involved: merging before rendering keeps the
 * pipeline unchanged and lets `--force-doctoc` build one table of contents
 * spanning every document.
 *
 * Relative asset handling: image targets **are** rewritten, to the absolute
 * path they resolve to inside their own source document's directory. The
 * merged file lives in a temp directory and combines documents from possibly
 * several directories, so there is no single base left to resolve against
 * once the sections are joined; pinning each target while its origin is
 * still known is what lets `inlineAssets` embed it later. Targets that do not
 * resolve to an existing file are left exactly as written.
 *
 * Link targets are **not** rewritten. They are not fetched during rendering,
 * so rewriting them would only risk corrupting link text; a relative link
 * between merged documents stays relative and may not point anywhere useful
 * in the PDF.
 *
 * @param files - Resolved input paths, in conversion order.
 * @param options - Resolved converter options; `options.merge` supplies the output base name.
 * @returns The merged file, its temp directory, the default target directory, and any warnings.
 */
export function mergeMarkdown(files: string[], options: ConverterOptions): MergedInput {
  if (!options.merge) {
    throw new Error('mergeMarkdown called without --merge.');
  }

  const skipped: string[] = [];
  const existing: string[] = [];

  for (const file of files) {
    if (fs.existsSync(file)) {
      existing.push(path.resolve(file));
    } else {
      skipped.push(file);
    }
  }

  if (existing.length === 0) {
    throw new Error('Nothing to merge: no existing Markdown files were resolved.');
  }

  const warnings: string[] = [];
  const ancestor = commonAncestorDirectory(existing);
  const targetDir = options.outputDir ? path.resolve(options.outputDir) : ancestor;

  const distinctDirectories = new Set(
    existing.map((file) => {
      const directory = path.dirname(file);
      return process.platform === 'win32' ? directory.toLowerCase() : directory;
    }),
  );

  if (distinctDirectories.size > 1) {
    warnings.push(
      `Merging files from ${distinctDirectories.size} directories. Images are resolved per source document, but relative links are not rewritten and may not resolve in the merged PDF.`,
    );
  }

  const content = joinDocuments(existing.map(readDocument));

  fs.mkdirSync(targetDir, { recursive: true });
  const mergeDir = createMergeDirectory(options, targetDir);

  // The merged file is named after `--merge` so prepareWorkdir derives the
  // PDF name, the temp file names, and the fallback document title from it.
  const mergedFile = path.join(mergeDir, `${options.merge}.md`);
  fs.writeFileSync(mergedFile, content, 'utf8');

  return { mergedFile, mergeDir, targetDir, mergedCount: existing.length, skipped, warnings };
}
