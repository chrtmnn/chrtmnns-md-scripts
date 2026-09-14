import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { formatExecError, locateNpxInvocation, NpxInvocation } from './npx-invocation';

type RunNpxOptions = {
  verbose: boolean;
};

/**
 * Wall-clock limit for one external tool, overridable via `MD2PDF_TOOL_TIMEOUT`
 * (milliseconds; `0` disables it).
 *
 * mermaid-cli and md-to-pdf both drive a headless Chromium, which can hang
 * instead of exiting — without a limit the run blocks forever with a spinner
 * that never stops (#51). Ten minutes is far above a normal render of a large
 * document and still ends a wedged process.
 */
const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Output buffer for a piped run.
 *
 * The tools are chatty on failure — 10 MiB was reachable, and exceeding it
 * killed the child with `ENOBUFS`, reported as a tool failure (#51).
 */
const OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Resolves the tool timeout from the environment.
 *
 * @param env - Environment to read `MD2PDF_TOOL_TIMEOUT` from.
 * @returns The timeout in milliseconds, or `undefined` when disabled.
 */
export function resolveToolTimeout(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.MD2PDF_TOOL_TIMEOUT?.trim();
  if (!raw) {
    return DEFAULT_TOOL_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid MD2PDF_TOOL_TIMEOUT: ${raw}. Expected a number of milliseconds.`);
  }

  return parsed === 0 ? undefined : parsed;
}

let cachedInvocation: NpxInvocation | undefined;

/**
 * Runs an npx command with optional inherited stdio.
 *
 * Arguments are passed as an array and the child process is spawned without a
 * shell, so no value is ever reinterpreted by `cmd.exe` or `/bin/sh`.
 *
 * The child is given a wall-clock timeout and a generous output buffer, so a
 * wedged Chromium ends the run instead of blocking it forever and a chatty
 * failure is not turned into an `ENOBUFS` error (#51).
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
      maxBuffer: OUTPUT_BUFFER_BYTES,
      timeout: resolveToolTimeout(),
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
  } catch (error) {
    throw new Error(formatExecError(error, args[0]));
  }
}
