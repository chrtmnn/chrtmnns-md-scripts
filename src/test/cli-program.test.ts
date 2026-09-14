/**
 * Behaviour of the command-line declaration itself (#59): the grouped help
 * that replaces Commander's flat list, and the promise that every previous
 * option name still parses.
 *
 * The grouping is data in `cli-program.ts` rather than a Commander feature
 * (it predates Commander's `helpGroup`), so the test that matters is the one that catches a
 * new option nobody put in a group.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, formatOptionGroups, packageVersion } from '../cli-program';

test('every visible option appears in exactly one help group', () => {
  const program = createProgram();
  const help = formatOptionGroups(program);

  for (const option of program.options) {
    if (option.hidden) {
      continue;
    }

    // Counted per row rather than per substring: a description may well
    // mention another option, as `--debug` does with `--html`.
    const rows = help.split('\n').filter((line) => line.startsWith(`  ${option.flags} `));
    assert.equal(rows.length, 1, `${option.flags} should have one row in the grouped help, saw ${rows.length}`);
  }
});

test('the grouped help lists the sections in reading order', () => {
  const help = formatOptionGroups(createProgram());
  const titles = help
    .split('\n')
    .filter((line) => /^\w[\w ]*:$/.test(line))
    .map((line) => line.slice(0, -1));

  assert.deepEqual(titles, ['Input', 'Output', 'Styling', 'TOC', 'Diagrams', 'Diagnostics']);
});

test('the help documents --version, --help and --title (#59)', () => {
  const help = formatOptionGroups(createProgram());

  assert.match(help, /-V, --version/);
  assert.match(help, /-h, --help/);
  assert.match(help, /--title <text>/);
});

test('the help does not advertise the empty --css-var default (#59)', () => {
  const help = formatOptionGroups(createProgram());

  assert.match(help, /--css-var <name=value>/);
  assert.equal(help.includes('default: []'), false);
});

test('the previous option names are accepted but hidden (#59)', () => {
  const hidden = createProgram()
    .options.filter((option) => option.hidden)
    .map((option) => option.flags);

  assert.deepEqual(hidden, [
    '-p, --temp-in-output-alias',
    '-r, --temp-root-alias <dir>',
    '-k, --keep-temp-alias',
    '-f, --force-doctoc',
    '--update-md-toc',
  ]);
});

test('packageVersion reports the version from package.json', () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});
