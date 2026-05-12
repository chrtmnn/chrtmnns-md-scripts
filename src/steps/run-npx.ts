import { execSync } from 'child_process';

type RunNpxOptions = {
  verbose: boolean;
};

/**
 * Runs an npx command with optional inherited stdio.
 *
 * @param args - Package selector followed by arguments for the invoked CLI.
 * @param options - Output handling options for the external command.
 */
export function runNpx(args: string[], options: RunNpxOptions): void {
  const command = ['npx', ...args].map(quoteShellArg).join(' ');

  try {
    execSync(command, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
  } catch (error) {
    throw new Error(formatExecError(error, args[0]));
  }
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

function formatExecError(error: unknown, commandName: string): string {
  if (!isExecError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const details = [error.stderr?.toString(), error.stdout?.toString()].filter(Boolean).join('\n').trim();
  return details || `npx ${commandName} failed`;
}

function isExecError(error: unknown): error is { stdout?: Buffer | string; stderr?: Buffer | string } {
  return typeof error === 'object' && error !== null && ('stdout' in error || 'stderr' in error);
}
