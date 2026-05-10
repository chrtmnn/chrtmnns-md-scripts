import { execSync } from 'child_process';
import { ConversionContext } from '../types';

export function renderMermaid(context: ConversionContext): void {
  console.log(`Running mermaid-cli on ${context.inputMarkdown}...`);
  execSync(
    `npx ${context.options.packages.mermaidCli} -i "${context.inputMarkdown}" -o "${context.convertedMarkdown}"`,
    { stdio: 'inherit' },
  );
}
