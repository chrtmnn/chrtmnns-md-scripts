/**
 * A single terminal line that is rewritten in place while a step runs.
 *
 * The progress UI from #59 asked for one line per file whose message names the
 * running step. A `@clack/prompts` spinner cannot do that here: its `start()`
 * only arms a `setInterval` and its `message()` merely stores the text — every
 * frame is painted from that timer. The whole conversion pipeline is
 * synchronous (`execFileSync` for doctoc, mermaid-cli and md-to-pdf, sync `fs`
 * everywhere else), so the event loop never runs between `start()` and
 * `stop()`, no frame is ever painted, and the terminal keeps showing the
 * previous step's finished line until the file is done (#65).
 *
 * Writing the line ourselves sidesteps the event loop entirely: every update
 * is one synchronous `write`.
 */

/** Carriage return plus "erase to end of line": parks the cursor and blanks the line. */
export const CLEAR_STATUS_LINE = '\r[K';

/** Appended to a line that had to be cut to fit the terminal. */
const ELLIPSIS = '…';

/**
 * Width assumed when the terminal does not report a usable one.
 *
 * `process.stdout.columns` is `undefined` off a TTY and **0** on a pty that
 * carries no window size (a `script`-wrapped run, some CI terminals), which
 * would otherwise truncate every line away to a lone ellipsis.
 */
const FALLBACK_COLUMNS = 80;

/**
 * Builds the escape sequence that replaces the current line with `text`.
 *
 * The text is truncated to one column less than the terminal width: a line
 * that wraps occupies two terminal rows, and `\r` + erase-to-end-of-line only
 * clears the last of them, which would leave the first half on screen forever.
 *
 * @param text - Line content, without a trailing newline.
 * @param columns - Terminal width in columns; a missing or non-positive value
 *   falls back to {@link FALLBACK_COLUMNS}.
 * @returns The bytes to write, leaving the cursor on the same line.
 */
export function formatStatusLine(text: string, columns: number | undefined): string {
  const width = Number.isInteger(columns) && (columns as number) > 0 ? (columns as number) : FALLBACK_COLUMNS;
  const limit = Math.max(1, width - 1);

  if (text.length <= limit) {
    return `${CLEAR_STATUS_LINE}${text}`;
  }

  return `${CLEAR_STATUS_LINE}${text.slice(0, limit - ELLIPSIS.length)}${ELLIPSIS}`;
}

/** The transient line, or a no-op when the output is not an interactive terminal. */
export type StatusLine = {
  /** Replaces the line with `text`. */
  show: (text: string) => void;
  /** Blanks the line, so ordinary output can follow without colliding with it. */
  hide: () => void;
};

/**
 * Creates a status line on `output`.
 *
 * @param output - Stream to write to, normally `process.stdout`.
 * @param enabled - Whether anything should be written at all; `false` yields a
 *   no-op, which is what a piped run or `--verbose` wants.
 * @returns The status line handle.
 */
export function createStatusLine(output: NodeJS.WriteStream, enabled: boolean): StatusLine {
  if (!enabled) {
    return { show: () => {}, hide: () => {} };
  }

  let visible = false;

  return {
    show: (text) => {
      visible = true;
      output.write(formatStatusLine(text, output.columns));
    },
    hide: () => {
      if (visible) {
        visible = false;
        output.write(CLEAR_STATUS_LINE);
      }
    },
  };
}
