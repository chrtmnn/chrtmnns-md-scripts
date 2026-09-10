/**
 * How npx is spawned without a shell, and how a failed run is reported.
 *
 * The platform and the existence check are passed in, so the Windows lookup is
 * exercised on every platform and no test touches the real Node installation.
 */

import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatExecError, locateNpxInvocation } from '../steps/npx-invocation';

const execPath = path.join(path.sep, 'nodejs', 'node.exe');
const besideNode = path.join(path.sep, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js');
const libLayout = path.join(path.sep, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');

test('locateNpxInvocation spawns npx by name outside Windows', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    const invocation = locateNpxInvocation(platform, execPath, () => {
      throw new Error('the filesystem must not be consulted');
    });

    assert.deepEqual(invocation, { file: 'npx', leadingArgs: [] });
  }
});

test('locateNpxInvocation runs npx-cli.js next to node.exe with the current Node binary on Windows', () => {
  const invocation = locateNpxInvocation('win32', execPath, (candidate) => candidate === besideNode);

  assert.deepEqual(invocation, { file: execPath, leadingArgs: [besideNode] });
});

test('locateNpxInvocation falls back to the ../lib/node_modules layout', () => {
  const invocation = locateNpxInvocation('win32', execPath, (candidate) => candidate === libLayout);

  assert.deepEqual(invocation, { file: execPath, leadingArgs: [libLayout] });
});

test('locateNpxInvocation prefers the copy next to node.exe when both layouts exist', () => {
  const invocation = locateNpxInvocation('win32', execPath, () => true);

  assert.deepEqual(invocation.leadingArgs, [besideNode]);
});

test('locateNpxInvocation names the Node binary and every candidate when npx-cli.js is missing', () => {
  assert.throws(
    () => locateNpxInvocation('win32', execPath, () => false),
    (error: Error) => {
      assert.match(error.message, /Could not locate npm's npx-cli\.js/);
      assert.ok(error.message.includes(execPath), 'names the Node binary');
      assert.ok(error.message.includes(besideNode), 'names the first candidate');
      assert.ok(error.message.includes(libLayout), 'names the second candidate');
      return true;
    },
  );
});

test('formatExecError reports the tool output, stderr before stdout', () => {
  assert.equal(formatExecError({ stderr: 'boom\n', stdout: '' }, 'doctoc@2.3.0'), 'boom');
  assert.equal(formatExecError({ stdout: 'only stdout\n' }, 'doctoc@2.3.0'), 'only stdout');
  assert.equal(formatExecError({ stderr: 'err', stdout: 'out' }, 'doctoc@2.3.0'), 'err\nout');
});

test('formatExecError reads Buffer output as well as strings', () => {
  const error = { stderr: Buffer.from('from a buffer\n'), stdout: Buffer.alloc(0) };

  assert.equal(formatExecError(error, 'md-to-pdf@5.2.5'), 'from a buffer');
});

test('formatExecError names the package when the tool printed nothing', () => {
  assert.equal(formatExecError({ stderr: '', stdout: '' }, 'md-to-pdf@5.2.5'), 'npx md-to-pdf@5.2.5 failed');
  assert.equal(formatExecError({ stderr: '  \n', stdout: '\n' }, 'md-to-pdf@5.2.5'), 'npx md-to-pdf@5.2.5 failed');
});

test('formatExecError falls back to the message of an error without tool output', () => {
  assert.equal(formatExecError(new Error('spawn EINVAL'), 'doctoc@2.3.0'), 'spawn EINVAL');
  assert.equal(formatExecError('plain string', 'doctoc@2.3.0'), 'plain string');
  assert.equal(formatExecError(null, 'doctoc@2.3.0'), 'null');
});
