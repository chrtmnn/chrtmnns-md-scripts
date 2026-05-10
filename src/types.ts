export type CssVarOverride = {
  name: string;
  value: string;
};

export type ConverterOptions = {
  stylesheet?: string;
  cssVars: CssVarOverride[];
  outputDir?: string;
  tempRoot?: string;
  tempInOutput: boolean;
  forceDoctoc: boolean;
  keepTemp: boolean;
  packages: {
    doctoc: string;
    mermaidCli: string;
    mdToPdf: string;
  };
};

export type ConversionContext = {
  options: ConverterOptions;
  sourceFile: string;
  sourceDir: string;
  baseName: string;
  stem: string;
  workdir: string;
  inputMarkdown: string;
  convertedMarkdown: string;
  targetDir: string;
  outputPdf: string;
  tempPdf: string;
  effectiveStylesheet?: string;
  docTitle: string;
};
