import { execSync } from 'child_process';

/**
 * Runs an npx command with shell-quoted arguments and inherited stdio.
 *
 * @param args - Package selector followed by arguments for the invoked CLI.
 */
export function runNpx(args: string[]): void {
  execSync(['npx', ...args].map(quoteShellArg).join(' '), { stdio: 'inherit' });
}

/**
 * Quotes a single argument for the current platform's shell.
 *
 * @param value - Raw argument value.
 * @returns A shell-safe argument string.
 */
function quoteShellArg(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
