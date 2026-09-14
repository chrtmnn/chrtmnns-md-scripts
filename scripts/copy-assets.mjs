// tsc only emits the .ts modules. The bundled stylesheet and the md-to-pdf
// config are looked up relative to the compiled modules (`../css`,
// `../config`), so they are copied next to them.
import fs from 'node:fs';

for (const dir of ['css', 'config']) {
  fs.cpSync(new URL(`../src/${dir}`, import.meta.url), new URL(`../dist/${dir}`, import.meta.url), {
    recursive: true,
  });
}
