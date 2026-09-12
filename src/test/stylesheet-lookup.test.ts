/**
 * Lookup rules for `-s/--stylesheet` (#34): the caller's directory first,
 * then bare names in the per-user config directory, where `.css` is optional.
 * Plus the choice made without `-s` (#40): a personal `default.css` in the
 * config directory, otherwise the bundled stylesheet. File existence is
 * injected, so these tests touch no filesystem at all.
 */

import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseStylesheet,
  configDirectory,
  describeStylesheet,
  findStylesheet,
  isBareName,
  stylesheetCandidates,
} from '../steps/stylesheet-lookup';

const CALLER = path.resolve('/work/notes');
const CONFIG = path.resolve('/home/me/.md2pdf');
const BUNDLED = path.resolve('/repo/src/css/default.css');
const USER_DEFAULT = path.join(CONFIG, 'default.css');
const LOCATIONS = { invocationDir: CALLER, configDir: CONFIG, bundledStylesheet: BUNDLED };

/**
 * Builds an `isFile` callback that only knows the given files.
 *
 * @param files - Absolute paths that should count as existing files.
 * @returns The callback for {@link findStylesheet}.
 */
function filesAt(...files: string[]): (file: string) => boolean {
  const existing = new Set(files);
  return (file) => existing.has(file);
}

test('uses MD2PDF_CONFIG_DIR when set and <home>/.md2pdf otherwise', () => {
  const home = path.resolve('/home/me');

  assert.equal(configDirectory({ MD2PDF_CONFIG_DIR: path.resolve('/custom') }, home), path.resolve('/custom'));
  assert.equal(configDirectory({}, home), path.join(home, '.md2pdf'));
  assert.equal(configDirectory({ MD2PDF_CONFIG_DIR: '' }, home), path.join(home, '.md2pdf'));
});

test('treats a name without any path part as bare', () => {
  for (const value of ['custom', 'custom.css', 'my.theme', 'letter-2024']) {
    assert.equal(isBareName(value), true, value);
  }
});

test('treats anything with a path part as a path', () => {
  for (const value of ['./local.css', 'themes/dark.css', 'themes\\dark.css', '/abs/x.css', 'C:\\x.css', 'C:x.css', '.', '..', '']) {
    assert.equal(isBareName(value), false, JSON.stringify(value));
  }
});

test('lists the caller directory first and the config directory after it', () => {
  assert.deepEqual(stylesheetCandidates('custom.css', CALLER, CONFIG), [
    path.join(CALLER, 'custom.css'),
    path.join(CONFIG, 'custom.css'),
  ]);
});

test('adds the .css short form only in the config directory', () => {
  assert.deepEqual(stylesheetCandidates('custom', CALLER, CONFIG), [
    path.join(CALLER, 'custom'),
    path.join(CONFIG, 'custom'),
    path.join(CONFIG, 'custom.css'),
  ]);
  assert.deepEqual(stylesheetCandidates('my.theme', CALLER, CONFIG), [
    path.join(CALLER, 'my.theme'),
    path.join(CONFIG, 'my.theme'),
    path.join(CONFIG, 'my.theme.css'),
  ]);
});

test('does not add .css to a name that already ends in it, in any case', () => {
  assert.deepEqual(stylesheetCandidates('Custom.CSS', CALLER, CONFIG), [
    path.join(CALLER, 'Custom.CSS'),
    path.join(CONFIG, 'Custom.CSS'),
  ]);
});

test('resolves a path value against the caller directory only', () => {
  assert.deepEqual(stylesheetCandidates('./local.css', CALLER, CONFIG), [path.join(CALLER, 'local.css')]);
  assert.deepEqual(stylesheetCandidates('themes/dark.css', CALLER, CONFIG), [path.join(CALLER, 'themes', 'dark.css')]);

  const absolute = path.resolve('/elsewhere/x.css');
  assert.deepEqual(stylesheetCandidates(absolute, CALLER, CONFIG), [absolute]);
});

test('prefers a file in the caller directory over the config directory', () => {
  const local = path.join(CALLER, 'local.css');
  const isFile = filesAt(local, path.join(CONFIG, 'local.css'));

  assert.equal(findStylesheet('local.css', CALLER, CONFIG, isFile), local);
});

test('falls back to the config directory when the caller directory has no such file', () => {
  const configured = path.join(CONFIG, 'custom.css');

  assert.equal(findStylesheet('custom.css', CALLER, CONFIG, filesAt(configured)), configured);
});

test('finds a config stylesheet by its name without .css', () => {
  const letter = path.join(CONFIG, 'letter.css');

  assert.equal(findStylesheet('letter', CALLER, CONFIG, filesAt(letter)), letter);
});

test('never applies the short form to the caller directory', () => {
  const local = path.join(CALLER, 'local.css');
  const configured = path.join(CONFIG, 'local.css');

  assert.equal(findStylesheet('local', CALLER, CONFIG, filesAt(local, configured)), configured);
  assert.throws(() => findStylesheet('local', CALLER, CONFIG, filesAt(local)), /Stylesheet not found: local/);
});

test('lists every location tried for an unknown name', () => {
  assert.throws(() => findStylesheet('missing', CALLER, CONFIG, filesAt()), {
    message: [
      'Stylesheet not found: missing',
      'Tried:',
      `  - ${path.join(CALLER, 'missing')}`,
      `  - ${path.join(CONFIG, 'missing')}`,
      `  - ${path.join(CONFIG, 'missing.css')}`,
    ].join('\n'),
  });
});

test('keeps the single-path message for a path value', () => {
  assert.throws(() => findStylesheet('./gone.css', CALLER, CONFIG, filesAt()), {
    message: `Stylesheet not found: ${path.join(CALLER, 'gone.css')}`,
  });
});

test('uses the personal default.css when no -s is given (#40)', () => {
  assert.deepEqual(chooseStylesheet(undefined, LOCATIONS, filesAt(USER_DEFAULT, BUNDLED)), {
    path: USER_DEFAULT,
    origin: 'user-default',
  });
});

test('falls back to the bundled stylesheet without a personal default (#40)', () => {
  assert.deepEqual(chooseStylesheet(undefined, LOCATIONS, filesAt(BUNDLED)), {
    path: BUNDLED,
    origin: 'bundled',
  });
});

test('ignores a personal default.css in the caller directory (#40)', () => {
  // Only the config directory holds the personal default; a default.css that
  // happens to sit next to the document must not change the default.
  assert.deepEqual(chooseStylesheet(undefined, LOCATIONS, filesAt(path.join(CALLER, 'default.css'), BUNDLED)), {
    path: BUNDLED,
    origin: 'bundled',
  });
});

test('reports no stylesheet when even the bundled one is missing (#40)', () => {
  assert.deepEqual(chooseStylesheet(undefined, LOCATIONS, filesAt()), { path: undefined, origin: 'bundled' });
});

test('-s default always means the bundled stylesheet (#40)', () => {
  const isFile = filesAt(USER_DEFAULT, BUNDLED, path.join(CALLER, 'default'), path.join(CONFIG, 'default'));

  assert.deepEqual(chooseStylesheet('default', LOCATIONS, isFile), { path: BUNDLED, origin: 'bundled' });
});

test('-s default.css still refers to the personal default (#40)', () => {
  assert.deepEqual(chooseStylesheet('default.css', LOCATIONS, filesAt(USER_DEFAULT, BUNDLED)), {
    path: USER_DEFAULT,
    origin: 'option',
  });
});

test('-s default fails when the bundled stylesheet is missing (#40)', () => {
  assert.throws(() => chooseStylesheet('default', LOCATIONS, filesAt(USER_DEFAULT)), {
    message: `Stylesheet not found: ${BUNDLED}`,
  });
});

test('an explicit -s keeps the #34 lookup and wins over the personal default (#40)', () => {
  const custom = path.join(CONFIG, 'custom.css');

  assert.deepEqual(chooseStylesheet('custom', LOCATIONS, filesAt(custom, USER_DEFAULT)), {
    path: custom,
    origin: 'option',
  });
  assert.throws(() => chooseStylesheet('missing', LOCATIONS, filesAt(USER_DEFAULT)), /Stylesheet not found: missing/);
});

test('describes which stylesheet was picked and why (#40)', () => {
  assert.match(describeStylesheet({ path: USER_DEFAULT, origin: 'user-default' }), /personal default/);
  assert.match(describeStylesheet({ path: BUNDLED, origin: 'bundled' }), /bundled default/);
  assert.match(describeStylesheet({ path: path.join(CALLER, 'x.css'), origin: 'option' }), /-s/);
  assert.match(describeStylesheet({ path: undefined, origin: 'bundled' }), /none/);
});

test('names the stylesheet file in every description (#40)', () => {
  for (const origin of ['option', 'user-default', 'bundled'] as const) {
    const described = describeStylesheet({ path: BUNDLED, origin });

    assert.ok(described.includes(BUNDLED), `${origin}: ${described}`);
  }
});
