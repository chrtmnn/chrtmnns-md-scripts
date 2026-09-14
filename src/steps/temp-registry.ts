/**
 * Bookkeeping for the temp directories a run creates, so an interrupt does
 * not leave them behind.
 *
 * `finally` covers a failure but not a signal: Ctrl-C during a conversion
 * killed the process outright and left the work directory on disk — with
 * `-p` that is a `doc_XXXXXX` folder in the user's own output directory
 * (#51). The registry keeps the live directories in one place so a signal
 * handler can remove exactly those, and `-k` is still honoured.
 *
 * The removal itself is injected, which keeps the rules testable without
 * touching the filesystem or installing process-wide signal handlers.
 */

/** A registry of temp directories that are alive right now. */
export type TempRegistry = {
  /** Records a directory as live. */
  register: (directory: string) => void;
  /** Drops a directory that has already been dealt with. */
  unregister: (directory: string) => void;
  /** The live directories, in registration order. */
  live: () => string[];
  /**
   * Removes every live directory and empties the registry.
   *
   * @returns The directories that were removed, in registration order.
   */
  removeAll: () => string[];
};

/**
 * Creates a registry over the given removal function.
 *
 * A removal that throws is swallowed: this runs while the process is already
 * on its way out, and a directory that cannot be removed must not stop the
 * others from being cleaned up.
 *
 * @param remove - Removes one directory recursively.
 * @param keepTemp - When true, `removeAll` keeps everything and reports nothing.
 * @returns The registry.
 */
export function createTempRegistry(remove: (directory: string) => void, keepTemp = false): TempRegistry {
  const directories = new Set<string>();

  return {
    register: (directory) => {
      directories.add(directory);
    },
    unregister: (directory) => {
      directories.delete(directory);
    },
    live: () => [...directories],
    removeAll: () => {
      if (keepTemp) {
        return [];
      }

      const removed: string[] = [];
      for (const directory of directories) {
        try {
          remove(directory);
          removed.push(directory);
        } catch {
          // Best effort: the process is terminating anyway.
        }
      }

      directories.clear();
      return removed;
    },
  };
}
