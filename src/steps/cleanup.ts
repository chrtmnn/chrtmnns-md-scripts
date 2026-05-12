import fs from 'fs';
import { ConversionContext } from '../types';

/**
 * Removes the temporary work directory unless the caller requested to keep it.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function cleanup(context: ConversionContext): void {
  if (context.options.keepTemp) {
    console.log(`Temp kept at: ${context.workdir}`);
    return;
  }

  fs.rmSync(context.workdir, { recursive: true, force: true });
}
