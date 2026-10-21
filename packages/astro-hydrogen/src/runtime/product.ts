/**
 * Server helpers for `<ProductForm />`: the GraphQL fragment it needs and the function that turns a
 * product plus the page's query string into the selected variant and the option grid.
 */
import {
  buildProductSelectionSearchParams,
  canAddToCart,
  createCartStore,
  createProductFormStore,
  getSelectedProductOptions,
  type ProductInput,
  type ProductVariantInput,
  type SelectedOption,
} from '@shopify/hydrogen';

/**
 * The product fields `<ProductForm />` reads. Spread it into the `product` selection of your query.
 * The query must declare `$selectedOptions: [SelectedOptionInput!]!` and pass it from the URL with
 * `getSelectedProductOptions({ searchParams })`.
 *
 * ```graphql
 * query Product($handle: String!, $selectedOptions: [SelectedOptionInput!]!) {
 *   product(handle: $handle) { ...ProductFormFields }
 * }
 * ```
 */
export const PRODUCT_FORM_FRAGMENT = /* GraphQL */ `#graphql
  fragment ProductFormVariant on ProductVariant {
    id
    title
    sku
    availableForSale
    selectedOptions { name value }
    price { amount currencyCode }
    compareAtPrice { amount currencyCode }
    image { id url altText width height }
    product { handle title }
  }
  fragment ProductFormFields on Product {
    id
    title
    handle
    vendor
    requiresSellingPlan
    encodedVariantExistence
    encodedVariantAvailability
    priceRange { minVariantPrice { amount currencyCode } }
    options {
      name
      optionValues {
        name
        swatch { color image { previewImage { url } } }
        firstSelectableVariant { ...ProductFormVariant }
      }
    }
    selectedOrFirstAvailableVariant(
      selectedOptions: $selectedOptions
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) { ...ProductFormVariant }
    adjacentVariants(selectedOptions: $selectedOptions) { ...ProductFormVariant }
  }
`;

export interface ProductFormValue {
  name: string;
  selected: boolean;
  /** False when no variant has this value together with the other selected options. */
  exists: boolean;
  /** False when every such variant is sold out. */
  available: boolean;
  /** The selection that choosing this value gives. */
  selectedOptions: SelectedOption[];
  /** The search string for this value (`?Color=Red&Size=M`), keeping the page's other params. */
  search: string;
  /** The product the value belongs to; differs from the current one in combined listings. */
  handle: string;
  swatch?: unknown;
}

export interface ProductFormOption {
  name: string;
  /** The selected value's name, if any. */
  selected: string | null;
  values: ProductFormValue[];
}

export interface ProductFormState<TProduct extends ProductInput = ProductInput> {
  /** The variant the URL selects, or the first available one. */
  variant: ProductVariantInput | null;
  selectedOptions: SelectedOption[];
  options: ProductFormOption[];
  /** False when a variant is missing or sold out, or the product needs a selling plan. */
  canAddToCart: boolean;
  /** False when there is nothing to choose (every option has at most one value). */
  hasChoices: boolean;
  product: TProduct;
}

/**
 * Resolves the selection and the option grid on the server, without a DOM. It runs Hydrogen's product
 * form store (never connected, so it makes no requests), which reads the product's
 * `encodedVariantExistence` and `encodedVariantAvailability` fields. Pass the product from a query
 * that spreads {@link PRODUCT_FORM_FRAGMENT}; the selection comes from `product.selectedOrFirstAvailableVariant`.
 */
export function getProductFormState<TProduct extends ProductInput>(
  product: TProduct,
  searchParams: URLSearchParams = new URLSearchParams(),
): ProductFormState<TProduct> {
  const optionNames = product.options.map((option) => option.name);
  const store = createProductFormStore(product, createCartStore());
  const state = store.getState();
  store.destroy();
  // Without a resolved variant the URL's options still say what is selected.
  const selectedOptions = product.selectedOrFirstAvailableVariant
    ? state.selectedOptions
    : getSelectedProductOptions({ searchParams, allowedOptionNames: optionNames });

  const options = state.options.map((option): ProductFormOption => {
    const values = option.values.map((value): ProductFormValue => ({
      name: value.name,
      selected: value.selected,
      exists: value.exists,
      available: value.available,
      selectedOptions: value.selectedOptions,
      search: productSelectionSearch(value.selectedOptions, optionNames, searchParams),
      handle: value.handle,
      swatch: value.swatch,
    }));
    return { name: option.name, selected: values.find((value) => value.selected)?.name ?? null, values };
  });

  return {
    variant: state.selectedVariant,
    selectedOptions,
    options,
    canAddToCart: canAddToCart(product, state.options),
    hasChoices: product.options.some((option) => option.optionValues.length > 1),
    product,
  };
}

/** Builds `?Color=Red&Size=M` for a selection, keeping the other params from `base` (e.g. `?ref=campaign`). */
export function productSelectionSearch(
  selectedOptions: SelectedOption[],
  optionNames: readonly string[],
  base?: URLSearchParams,
): string {
  const params = buildProductSelectionSearchParams({ selectedOptions, optionNames, base });
  return params.size ? `?${params}` : '';
}
