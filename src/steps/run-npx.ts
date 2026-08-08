import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

type RunNpxOptions = {
  verbose: boolean;
};

type NpxInvocation = {
  file: string;
  leadingArgs: string[];
};

let cachedInvocation: NpxInvocation | undefined;

/**
 * Runs an npx command with optional inherited stdio.
 *
 * Arguments are passed as an array and the child process is spawned without a
 * shell, so no value is ever reinterpreted by `cmd.exe` or `/bin/sh`.
 *
 * @param args - Package selector followed by arguments for the invoked CLI.
 * @param options - Output handling options for the external command.
 */
export function runNpx(args: string[], options: RunNpxOptions): void {
  const { file, leadingArgs } = resolveNpxInvocation();

  try {
    execFileSync(file, [...leadingArgs, ...args], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
  } catch (error) {
    throw new Error(formatExecError(error, args[0]));
  }
}

/**
 * Determines how to spawn npx without going through a shell.
 *
 * On Windows the `npx` on `PATH` is `npx.cmd`, a batch file that Node refuses
 * to spawn with `shell: false` (the CVE-2024-27980 hardening). Running the
 * bundled `npx-cli.js` with the current Node binary is the equivalent
 * invocation that needs no shell. Everywhere else `npx` is directly
 * executable.
 *
 * @returns The executable to spawn and the arguments that must precede the npx arguments.
 */
function resolveNpxInvocation(): NpxInvocation {
  if (cachedInvocation) {
    return cachedInvocation;
  }

  if (process.platform !== 'win32') {
    cachedInvocation = { file: 'npx', leadingArgs: [] };
    return cachedInvocation;
  }

  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  const npxCli = candidates.find((candidate) => existsSync(candidate));

  if (!npxCli) {
    throw new Error(
      `Could not locate npm's npx-cli.js next to ${process.execPath}. ` +
        `Looked in:\n${candidates.map((candidate) => `  ${candidate}`).join('\n')}`,
    );
  }

  cachedInvocation = { file: process.execPath, leadingArgs: [npxCli] };
  return cachedInvocation;
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
