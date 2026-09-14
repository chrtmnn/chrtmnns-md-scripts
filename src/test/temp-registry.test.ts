/**
 * Behaviour of the temp-directory bookkeeping behind the signal cleanup from
 * #51: what a Ctrl-C removes, what `-k` keeps, and what a finished step has
 * already taken care of.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempRegistry } from '../steps/temp-registry';

/** Builds a registry over a removal function that only records its calls. */
function recording(keepTemp = false): { removed: string[]; registry: ReturnType<typeof createTempRegistry> } {
  const removed: string[] = [];
  return { removed, registry: createTempRegistry((directory) => removed.push(directory), keepTemp) };
}

test('removeAll removes every live directory in registration order', () => {
  const { removed, registry } = recording();
  registry.register('/tmp/css');
  registry.register('/tmp/merge');
  registry.register('/tmp/work');

  assert.deepEqual(registry.removeAll(), ['/tmp/css', '/tmp/merge', '/tmp/work']);
  assert.deepEqual(removed, ['/tmp/css', '/tmp/merge', '/tmp/work']);
});

test('an unregistered directory is left alone', () => {
  const { removed, registry } = recording();
  registry.register('/tmp/work');
  registry.register('/tmp/css');
  registry.unregister('/tmp/work');

  registry.removeAll();

  assert.deepEqual(removed, ['/tmp/css'], 'the work directory was already cleaned up by its own finally');
});

test('registering the same directory twice removes it once', () => {
  const { removed, registry } = recording();
  registry.register('/tmp/work');
  registry.register('/tmp/work');

  registry.removeAll();

  assert.deepEqual(removed, ['/tmp/work']);
});

test('--keep-temp keeps everything', () => {
  const { removed, registry } = recording(true);
  registry.register('/tmp/work');

  assert.deepEqual(registry.removeAll(), []);
  assert.deepEqual(removed, []);
  assert.deepEqual(registry.live(), ['/tmp/work'], 'the directory stays on disk and in the registry');
});

test('a removal that throws does not stop the others', () => {
  const removed: string[] = [];
  const registry = createTempRegistry((directory) => {
    if (directory === '/tmp/locked') {
      throw new Error('EBUSY');
    }
    removed.push(directory);
  });
  registry.register('/tmp/locked');
  registry.register('/tmp/work');

  assert.deepEqual(registry.removeAll(), ['/tmp/work']);
  assert.deepEqual(removed, ['/tmp/work']);
});

test('removeAll empties the registry, so a second call does nothing', () => {
  const { removed, registry } = recording();
  registry.register('/tmp/work');

  registry.removeAll();
  registry.removeAll();

  assert.deepEqual(removed, ['/tmp/work']);
  assert.deepEqual(registry.live(), []);
});
