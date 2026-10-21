import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPrice, resolveLocale } from '../dist/runtime/money.js';

describe('resolveLocale', () => {
  it('joins language and country as a BCP 47 tag', () => {
    assert.equal(resolveLocale({ language: 'EN', country: 'US' }), 'en-US');
    assert.equal(resolveLocale({ language: 'FR', country: 'CA' }), 'fr-CA');
  });

  it('falls back to en-US without a market', () => {
    assert.equal(resolveLocale(undefined), 'en-US');
    assert.equal(resolveLocale(null), 'en-US');
    assert.equal(resolveLocale({ language: 'EN' }), 'en-US');
  });
});

describe('formatPrice', () => {
  const money = { amount: '1299.00', currencyCode: 'USD' };

  it('formats for the market', () => {
    assert.equal(formatPrice(money, { i18n: { language: 'EN', country: 'US' } }), '$1,299.00');
    assert.equal(formatPrice(money), '$1,299.00');
    assert.match(formatPrice(money, { i18n: { language: 'DE', country: 'DE' } }), /^1\.299,00\s\$$/);
  });

  it('prefers an explicit locale', () => {
    assert.match(formatPrice(money, { locale: 'fr-FR', i18n: { language: 'EN', country: 'US' } }), /^1\s299,00\s\$US$/);
  });

  it('passes format options through', () => {
    assert.equal(formatPrice(money, { withoutTrailingZeros: true }), '$1,299');
    assert.equal(formatPrice(money, { withoutCurrency: true }), '1,299.00');
  });

  it('formats a range', () => {
    const range = [{ amount: '10.00', currencyCode: 'USD' }, { amount: '19.50', currencyCode: 'USD' }];
    assert.match(formatPrice(range), /\$10\.00.*\$19\.50/);
  });
});
