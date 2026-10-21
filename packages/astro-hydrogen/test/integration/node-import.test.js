import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOnly } from '../helpers/fixture.js';

describe('node-import fixture', () => {
  it('fails the build and names the node: module the Worker imports statically', async () => {
    await assert.rejects(buildOnly('node-import', { logLevel: 'silent' }), (error) => {
      assert.match(error.message, /Oxygen has no Node\.js built-in modules/);
      assert.match(error.message, /node:fs/);
      return true;
    });
  });
});
