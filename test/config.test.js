import assert from 'node:assert/strict';
import { it } from 'node:test';
import { defineHydrogenConfig } from '../dist/config.js';
import * as entry from '../dist/index.js';

it('defineHydrogenConfig returns its argument unchanged', () => {
  const config = { shopifyRoutes: false };
  assert.equal(defineHydrogenConfig(config), config);
});

it('keeps the public entry exports: default hydrogen() and defineHydrogenConfig', () => {
  assert.deepEqual(Object.keys(entry).sort(), ['default', 'defineHydrogenConfig']);
  assert.equal(entry.default.name, 'hydrogen');
});
