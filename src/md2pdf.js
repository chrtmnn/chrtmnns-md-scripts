#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { program } = require('commander');

// Default package versions
const DOCTOC_PKG = process.env.DOCTOC_PKG || 'doctoc@2.3.0';
const MERMAID_CLI_PKG = process.env.MERMAID_CLI_PKG || '@mermaid-js/mermaid-cli@11.12.0';
const MD_TO_PDF_PKG = process.env.MD_TO_PDF_PKG || 'md-to-pdf@5.2.5';

function collect(value, previous) {
  return previous.concat([value]);
}

program
  .name('md2pdf')
  .description('Render Mermaid diagrams and convert Markdown to PDF')
  .argument('<files...>', 'Markdown files to convert')
  .option('-s, --stylesheet <path>', 'Stylesheet passed to md-to-pdf')
  .option('--css-var <name=value>', 'Override a CSS custom property, repeatable', collect, [])
  .option('-o, --output-dir <path>', 'Output directory for PDFs')
  .option('-r, --temp-root <path>', 'Root directory for temp work dirs')
  .option('-p, --temp-in-output', 'Place temp dir inside the output directory')
  .option('-t, --run-doctoc', 'Run doctoc to inject Table of Contents')
  .option('-k, --keep-temp', 'Keep temp working directory')
  .parse(process.argv);

const options = program.opts();
const files = program.args;

// Resolve default stylesheet
let stylesheet = options.stylesheet;
if (!stylesheet) {
  const defaultStylesheet = path.resolve(__dirname, 'css', 'default.css');
  if (fs.existsSync(defaultStylesheet)) {
    stylesheet = defaultStylesheet;
  }
}

if (stylesheet && !fs.existsSync(stylesheet)) {
  console.error(`Stylesheet not found: ${stylesheet}`);
  process.exit(1);
}

function parseCssVars(values) {
  return values.map((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid CSS variable override: ${entry}. Expected name=value.`);
    }

    const rawName = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    const name = rawName.startsWith('--') ? rawName.slice(2) : rawName;

    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid CSS variable name: ${rawName}`);
    }

    if (!value || /[{};]/.test(value)) {
      throw new Error(`Invalid CSS variable value for ${rawName}: ${value}`);
    }

    return { name: `--${name}`, value };
  });
}

let cssVars;
try {
  cssVars = parseCssVars(options.cssVar);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function createStylesheet(workdir) {
  if (cssVars.length === 0) {
    return stylesheet;
  }

  const overrideStylesheet = path.join(workdir, 'style-overrides.css');
  const lines = [];
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

function convertMarkdownFile(src) {
  if (!fs.existsSync(src)) {
    console.warn(`File not found: ${src}`);
    return;
  }

  const absSrc = path.resolve(src);
  const baseName = path.basename(src);
  const stem = path.parse(baseName).name;
  const srcDir = path.dirname(absSrc);

  let workdir;
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const workdirName = `${stem}_${randomSuffix}`;

  if (options.tempInOutput) {
    const baseOut = options.outputDir ? path.resolve(options.outputDir) : srcDir;
    if (!fs.existsSync(baseOut)) fs.mkdirSync(baseOut, { recursive: true });
    workdir = path.join(baseOut, workdirName);
  } else if (options.tempRoot) {
    const tempRoot = path.resolve(options.tempRoot);
    if (!fs.existsSync(tempRoot)) fs.mkdirSync(tempRoot, { recursive: true });
    workdir = path.join(tempRoot, workdirName);
  } else {
    workdir = path.join(os.tmpdir(), workdirName);
  }

  if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive: true });

  const convertedMd = path.join(workdir, `${stem}_converted.md`);
  let inputMd = absSrc;

  if (options.runDoctoc) {
    inputMd = path.join(workdir, baseName);
    fs.copyFileSync(absSrc, inputMd);
    console.log(`Running doctoc on ${inputMd}...`);
    execSync(`npx ${DOCTOC_PKG} "${inputMd}"`, { stdio: 'inherit' });
  }

  // Extract title from first # heading
  let docTitle = stem;
  const content = fs.readFileSync(inputMd, 'utf8');
  const headingMatch = content.match(/^\s*#+\s*(.*)/m);
  if (headingMatch) {
    docTitle = headingMatch[1].trim();
  }

  // Mermaid CLI
  console.log(`Running mermaid-cli on ${inputMd}...`);
  execSync(`npx ${MERMAID_CLI_PKG} -i "${inputMd}" -o "${convertedMd}"`, { stdio: 'inherit' });

  const targetDir = options.outputDir ? path.resolve(options.outputDir) : srcDir;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const outPdf = path.join(targetDir, `${stem}.pdf`);
  const tempPdf = path.join(workdir, `${stem}_converted.pdf`);

  // md-to-pdf
  console.log(`Running md-to-pdf on ${convertedMd}...`);
  let cmd = `npx ${MD_TO_PDF_PKG} "${convertedMd}" --basedir "${workdir}" --document-title "${docTitle}"`;
  const effectiveStylesheet = createStylesheet(workdir);
  if (effectiveStylesheet) {
    cmd += ` --stylesheet "${effectiveStylesheet}"`;
  }
  
  execSync(cmd, { stdio: 'inherit' });

  if (fs.existsSync(tempPdf)) {
    fs.copyFileSync(tempPdf, outPdf);
    console.log(`Created: ${outPdf}`);
  } else {
    console.error(`PDF generation failed. Expected: ${tempPdf}`);
  }

  if (options.keepTemp) {
    console.log(`Temp kept at: ${workdir}`);
  } else {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

files.forEach(convertMarkdownFile);
