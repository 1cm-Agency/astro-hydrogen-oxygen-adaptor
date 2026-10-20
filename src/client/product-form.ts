/**
 * Upgrades a server-rendered `<ProductForm />` so option links select in place: Hydrogen's product
 * form store works out which combinations exist and are in stock from the query's encoded variant
 * fields, with no fetch. Used by the component's script; it needs the markup `<ProductForm />` renders.
 */
import {
  AnalyticsEvent,
  buildProductSelectionSearchParams,
  canAddToCart,
  createProductFormStore,
  type ProductFormStore,
  type ProductFormStoreState,
  type ProductInput,
} from '@shopify/hydrogen';
import { connectCart, getCartStore, setCartFormHandler } from './cart.js';

interface PriceLike {
  amount: string;
  currencyCode: string;
}

/** Wires up one `[data-product-form]` root. Returns a function that undoes it. */
export function enhanceProductForm(root: HTMLElement, product: ProductInput, pathname: string): () => void {
  connectCart();
  const store: ProductFormStore = createProductFormStore(product, getCartStore());
  store.connect();
  const optionNames = product.options.map((option) => option.name);
  const form = root.querySelector<HTMLFormElement>('form[data-cart-form]');
  const locale = root.getAttribute('data-locale') ?? undefined;

  const urlFor = (selectedOptions: { name: string; value: string }[]) => {
    const params = buildProductSelectionSearchParams({
      selectedOptions,
      optionNames,
      base: new URLSearchParams(location.search),
    });
    return `${pathname}${params.size ? `?${params}` : ''}`;
  };

  const format = (money: PriceLike) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currencyCode }).format(Number(money.amount));
    } catch {
      return `${money.amount} ${money.currencyCode}`;
    }
  };

  function render(state: ProductFormStoreState) {
    for (const option of state.options) {
      for (const value of option.values) {
        const el = findValue(root, option.name, value.name);
        if (!el) continue;
        el.toggleAttribute('data-selected', value.selected);
        el.toggleAttribute('data-sold-out', !value.available);
        if (el instanceof HTMLAnchorElement) {
          if (value.selected) el.setAttribute('aria-current', 'true');
          else el.removeAttribute('aria-current');
          if (value.exists) el.href = urlFor(value.selectedOptions);
        }
      }
      const current = root.querySelector(`[data-option-selected="${cssEscape(option.name)}"]`);
      const selected = state.selectedOptions.find((s) => s.name === option.name);
      if (current) current.textContent = selected?.value ?? '';
    }
    const variant = state.selectedVariant;
    const id = form?.querySelector<HTMLInputElement>('input[name="merchandiseId"]');
    if (id) id.value = variant?.id ?? '';
    const addable = canAddToCart(product, state.options);
    const submit = form?.querySelector<HTMLButtonElement>('[data-product-submit]');
    if (submit) {
      submit.disabled = !addable;
      submit.textContent = addable
        ? (submit.getAttribute('data-label-add') ?? 'Add to cart')
        : variant
          ? (submit.getAttribute('data-label-sold-out') ?? 'Sold out')
          : (submit.getAttribute('data-label-select') ?? 'Select options');
    }
    const price = variant?.price ?? product.priceRange?.minVariantPrice;
    const priceEl = root.querySelector('[data-product-price]');
    if (priceEl && price) priceEl.textContent = format(price);
    const compare = root.querySelector('[data-product-compare-at-price]');
    if (compare) {
      const at = variant?.compareAtPrice;
      const onSale = at && price && Number(at.amount) > Number(price.amount);
      compare.textContent = onSale ? format(at) : '';
      (compare as HTMLElement).hidden = !onSale;
    }
    root.setAttribute('data-variant-id', variant?.id ?? '');
  }

  const clickHandlers: [HTMLAnchorElement, (event: MouseEvent) => void][] = [];
  for (const option of product.options) {
    for (const value of option.optionValues) {
      const el = findValue(root, option.name, value.name);
      if (!(el instanceof HTMLAnchorElement)) continue;
      const onClick = (event: MouseEvent) => {
        // Leave new-tab and modified clicks to the browser.
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (el.target && el.target !== '_self') return;
        // Another product in a combined listing: a normal navigation.
        if (el.hasAttribute('data-other-product')) return;
        const result = store.selectOption(option.name, value.name);
        if (result.status === 'invalid') return;
        event.preventDefault();
        if (result.status === 'resolved') {
          history.replaceState(history.state, '', urlFor(result.selectedOptions));
        } else {
          // The variant isn't in the local cache: let the server resolve it.
          location.replace(urlFor(result.selectedOptions));
        }
      };
      el.addEventListener('click', onClick);
      clickHandlers.push([el, onClick]);
    }
  }

  if (form) setCartFormHandler(form, (event) => store.handleFormSubmit(event));
  const stop = store.subscribe(render);
  render(store.getState());

  const selected = store.getState().selectedVariant;
  window.Shopify?.analytics?.publish(AnalyticsEvent.PRODUCT_VIEWED, {
    products: [
      {
        id: product.id,
        title: product.title,
        vendor: product.vendor ?? '',
        price: (selected?.price ?? product.priceRange?.minVariantPrice ?? { amount: '0', currencyCode: 'USD' }) as never,
        variantId: selected?.id ?? product.id,
        variantTitle: selected?.title ?? product.title,
        sku: selected?.sku ?? undefined,
        quantity: 1,
      },
    ],
  });

  return () => {
    stop();
    for (const [el, handler] of clickHandlers) el.removeEventListener('click', handler);
    store.destroy();
  };
}

function cssEscape(value: string) {
  return value.replace(/["\\]/g, '\\$&');
}

function findValue(root: HTMLElement, optionName: string, valueName: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-option-value]')) {
    if (el.getAttribute('data-option-value') === valueName && el.closest('[data-option]')?.getAttribute('data-option') === optionName) {
      return el;
    }
  }
  return null;
}
