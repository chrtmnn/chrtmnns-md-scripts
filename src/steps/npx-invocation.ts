/**
 * Rules for spawning npx without a shell and for turning a failed run into a
 * readable error message. Kept separate from `run-npx.ts`, which spawns the
 * child process, so the platform lookup and the error formatting can be
 * exercised directly on any platform.
 */

import path from 'path';

export type NpxInvocation = {
  file: string;
  leadingArgs: string[];
};

/**
 * Determines how to spawn npx without going through a shell.
 *
 * On Windows the `npx` on `PATH` is `npx.cmd`, a batch file that Node refuses
 * to spawn with `shell: false` (the CVE-2024-27980 hardening). Running the
 * bundled `npx-cli.js` with the current Node binary is the equivalent
 * invocation that needs no shell. Everywhere else `npx` is directly
 * executable.
 *
 * @param platform - Platform to resolve for, normally `process.platform`.
 * @param execPath - Path of the running Node binary, normally `process.execPath`.
 * @param exists - Existence check for candidate paths, normally `fs.existsSync`.
 * @returns The executable to spawn and the arguments that must precede the npx arguments.
 */
export function locateNpxInvocation(
  platform: NodeJS.Platform,
  execPath: string,
  exists: (candidate: string) => boolean,
): NpxInvocation {
  if (platform !== 'win32') {
    return { file: 'npx', leadingArgs: [] };
  }

  const nodeDir = path.dirname(execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  const npxCli = candidates.find((candidate) => exists(candidate));

  if (!npxCli) {
    throw new Error(
      `Could not locate npm's npx-cli.js next to ${execPath}. ` +
        `Looked in:\n${candidates.map((candidate) => `  ${candidate}`).join('\n')}`,
    );
  }

  return { file: execPath, leadingArgs: [npxCli] };
}

/**
 * Builds the message for a failed npx run.
 *
 * The tool's own output is the most useful explanation, so stderr and stdout
 * are preferred over the generic message `execFileSync` attaches.
 *
 * @param error - Value thrown by `execFileSync`.
 * @param commandName - Package selector of the failed run, used when the tool printed nothing.
 * @returns The message to re-throw.
 */
export function formatExecError(error: unknown, commandName: string): string {
  if (!isExecError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const details = [error.stderr?.toString(), error.stdout?.toString()].filter(Boolean).join('\n').trim();
  return details || `npx ${commandName} failed`;
}

function isExecError(error: unknown): error is { stdout?: Buffer | string; stderr?: Buffer | string } {
  return typeof error === 'object' && error !== null && ('stdout' in error || 'stderr' in error);
}
