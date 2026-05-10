import fs from 'fs';
import { ConversionContext } from '../types';

export function cleanup(context: ConversionContext): void {
  if (context.options.keepTemp) {
    console.log(`Temp kept at: ${context.workdir}`);
    return;
  }

  fs.rmSync(context.workdir, { recursive: true, force: true });
}
