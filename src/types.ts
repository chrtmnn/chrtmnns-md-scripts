/**
 * A single CSS custom property override passed from the CLI.
 */
export type CssVarOverride = {
  /** CSS custom property name, always normalized with the leading `--`. */
  name: string;
  /** Raw CSS value to write into the generated `:root` block. */
  value: string;
};

/**
 * Resolved CLI options shared by every conversion step.
 */
export type ConverterOptions = {
  /** Stylesheet passed to md-to-pdf, either user-provided or the default stylesheet. */
  stylesheet?: string;
  /** CSS custom property overrides appended to the effective stylesheet. */
  cssVars: CssVarOverride[];
  /** Target directory for generated PDFs. Defaults to each source file's directory. */
  outputDir?: string;
  /** Root directory for temporary work directories. Defaults to the OS temp directory. */
  tempRoot?: string;
  /** Whether temporary work directories should be created inside the output directory. */
  tempInOutput: boolean;
  /** Whether doctoc should run even when the source file has no existing TOC markers. */
  forceDoctoc: boolean;
  /** Whether an existing doctoc table of contents should be updated in the source Markdown. */
  updateMdToc: boolean;
  /** Whether temporary work directories should be preserved after conversion. */
  keepTemp: boolean;
  /** Whether external tool output should be printed while commands run. */
  verbose: boolean;
  /** Package selectors used for external npx invocations. */
  packages: {
    doctoc: string;
    mermaidCli: string;
    mdToPdf: string;
  };
};

/**
 * Mutable per-file state passed through the conversion pipeline.
 */
export type ConversionContext = {
  /** Resolved options for this conversion run. */
  options: ConverterOptions;
  /** Absolute path to the original Markdown source file. */
  sourceFile: string;
  /** Directory containing the original Markdown source file. */
  sourceDir: string;
  /** Original source filename including extension. */
  baseName: string;
  /** Original source filename without extension. */
  stem: string;
  /** Isolated temporary directory for intermediate files. */
  workdir: string;
  /** Markdown file consumed by mermaid-cli, updated when doctoc creates a temp copy. */
  inputMarkdown: string;
  /** Markdown file emitted by mermaid-cli and consumed by md-to-pdf. */
  convertedMarkdown: string;
  /** Directory where the final PDF should be written. */
  targetDir: string;
  /** Final PDF path visible to the caller. */
  outputPdf: string;
  /** PDF path expected from md-to-pdf inside the temporary work directory. */
  tempPdf: string;
  /** Stylesheet path actually passed to md-to-pdf after applying overrides. */
  effectiveStylesheet?: string;
  /** Document title passed to md-to-pdf. */
  docTitle: string;
};
