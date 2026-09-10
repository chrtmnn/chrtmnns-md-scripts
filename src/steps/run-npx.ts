import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { formatExecError, locateNpxInvocation, NpxInvocation } from './npx-invocation';

type RunNpxOptions = {
  verbose: boolean;
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
  cachedInvocation ??= locateNpxInvocation(process.platform, process.execPath, existsSync);
  const { file, leadingArgs } = cachedInvocation;

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
