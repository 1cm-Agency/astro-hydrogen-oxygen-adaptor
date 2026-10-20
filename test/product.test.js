import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getProductFormState, PRODUCT_FORM_FRAGMENT, productSelectionSearch } from '../dist/runtime/product.js';

const variant = (id, color, size, availableForSale = true) => ({
  id,
  title: `${color} / ${size}`,
  availableForSale,
  selectedOptions: [
    { name: 'Color', value: color },
    { name: 'Size', value: size },
  ],
  price: { amount: '10.0', currencyCode: 'USD' },
  product: { handle: 'shirt' },
});

function product(overrides = {}) {
  const redS = variant('v1', 'Red', 'S');
  const redM = variant('v2', 'Red', 'M', false);
  const blueS = variant('v3', 'Blue', 'S');
  return {
    id: 'p1',
    title: 'Shirt',
    handle: 'shirt',
    options: [
      { name: 'Color', optionValues: [{ name: 'Red', firstSelectableVariant: redS }, { name: 'Blue', firstSelectableVariant: blueS }] },
      { name: 'Size', optionValues: [{ name: 'S', firstSelectableVariant: redS }, { name: 'M', firstSelectableVariant: null }] },
    ],
    selectedOrFirstAvailableVariant: redS,
    adjacentVariants: [redM, blueS],
    ...overrides,
  };
}

describe('PRODUCT_FORM_FRAGMENT', () => {
  it('defines the fields the product form store reads', () => {
    for (const field of [
      'fragment ProductFormFields on Product',
      'fragment ProductFormVariant on ProductVariant',
      'encodedVariantExistence',
      'encodedVariantAvailability',
      'firstSelectableVariant',
      'selectedOrFirstAvailableVariant',
      'adjacentVariants',
      '$selectedOptions',
      'requiresSellingPlan',
    ]) {
      assert.ok(PRODUCT_FORM_FRAGMENT.includes(field), field);
    }
  });
});

describe('getProductFormState', () => {
  it('resolves the selected variant and marks selected values', () => {
    const state = getProductFormState(product(), new URLSearchParams('Color=Red&Size=S'));
    assert.equal(state.variant.id, 'v1');
    assert.deepEqual(state.selectedOptions, [
      { name: 'Color', value: 'Red' },
      { name: 'Size', value: 'S' },
    ]);
    assert.equal(state.canAddToCart, true);
    assert.equal(state.hasChoices, true);
    assert.deepEqual(state.options.map((option) => option.selected), ['Red', 'S']);
    assert.deepEqual(state.options[0].values.map((value) => value.selected), [true, false]);
  });

  it('builds option URLs that keep unrelated params and replace the option', () => {
    const state = getProductFormState(product(), new URLSearchParams('ref=ad&Color=Red&Size=S'));
    const blue = state.options[0].values.find((value) => value.name === 'Blue');
    assert.equal(new URLSearchParams(blue.search).get('Color'), 'Blue');
    assert.equal(new URLSearchParams(blue.search).get('Size'), 'S');
    assert.equal(new URLSearchParams(blue.search).get('ref'), 'ad');
    assert.equal(blue.handle, 'shirt');
  });

  it('marks sold-out values as existing but unavailable', () => {
    const state = getProductFormState(product());
    const medium = state.options[1].values.find((value) => value.name === 'M');
    assert.equal(medium.exists, true);
    assert.equal(medium.available, false);
  });

  it('cannot add a sold-out variant, a missing variant, or a selling-plan product', () => {
    const soldOut = variant('v2', 'Red', 'M', false);
    assert.equal(getProductFormState(product({ selectedOrFirstAvailableVariant: soldOut })).canAddToCart, false);
    const none = getProductFormState(product({ selectedOrFirstAvailableVariant: null }), new URLSearchParams('Color=Red&Bogus=1'));
    assert.equal(none.variant, null);
    assert.equal(none.canAddToCart, false);
    assert.deepEqual(none.selectedOptions, [{ name: 'Color', value: 'Red' }]);
    assert.equal(getProductFormState(product({ requiresSellingPlan: true })).canAddToCart, false);
  });

  it('reports no choices for a single-variant product', () => {
    const only = variant('v9', 'Red', 'S');
    const single = product({
      options: [{ name: 'Title', optionValues: [{ name: 'Default Title', firstSelectableVariant: only }] }],
      selectedOrFirstAvailableVariant: only,
      adjacentVariants: [],
    });
    assert.equal(getProductFormState(single).hasChoices, false);
  });
});

describe('productSelectionSearch', () => {
  it('builds a query string, and an empty string for no selection', () => {
    assert.equal(productSelectionSearch([{ name: 'Size', value: 'M' }], ['Size']), '?Size=M');
    assert.equal(productSelectionSearch([], ['Size']), '');
    const search = productSelectionSearch([{ name: 'Size', value: 'M' }], ['Size'], new URLSearchParams('ref=x&Size=S&variant=1'));
    assert.deepEqual([...new URLSearchParams(search)], [['ref', 'x'], ['Size', 'M']]);
  });
});
