/**
 * Behaviour of the external-tool guard rails added for #51: how long a
 * mermaid-cli or md-to-pdf run may take before it is ended.
 *
 * The spawning itself is not covered — the suite must stay fast and must not
 * need Chromium. `pnpm pack:smoke` runs the real tools (#56).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToolTimeout } from '../steps/run-tool';

test('resolveToolTimeout defaults to ten minutes and honours the override (#51)', () => {
  assert.equal(resolveToolTimeout({}), 10 * 60 * 1000);
  assert.equal(resolveToolTimeout({ MD2PDF_TOOL_TIMEOUT: '' }), 10 * 60 * 1000);
  assert.equal(resolveToolTimeout({ MD2PDF_TOOL_TIMEOUT: '5000' }), 5000);
  assert.equal(resolveToolTimeout({ MD2PDF_TOOL_TIMEOUT: '0' }), undefined, 'zero disables the limit');
});

test('resolveToolTimeout rejects a value that is not a duration (#51)', () => {
  assert.throws(() => resolveToolTimeout({ MD2PDF_TOOL_TIMEOUT: 'soon' }), /Invalid MD2PDF_TOOL_TIMEOUT/);
  assert.throws(() => resolveToolTimeout({ MD2PDF_TOOL_TIMEOUT: '-1' }), /Invalid MD2PDF_TOOL_TIMEOUT/);
});
