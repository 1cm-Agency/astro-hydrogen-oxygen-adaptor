/**
 * The browser cart, shared by everything on the page: Hydrogen's cart store (optimistic lines,
 * server reconciliation) plus the glue for plain `<form data-cart-form>` posts.
 *
 *   import { connectCart, onCart } from 'astro-hydrogen/client/cart';
 *   connectCart();
 *   const stop = onCart((cart) => render(cart));
 *
 * Plain TypeScript, no UI framework. Safe to import from any number of scripts or islands.
 */
import { attachQuantityInput, configureCartEndpoint, createCartStore, trackCartAnalytics, type CartState, type CartStore } from '@shopify/hydrogen';

export type { CartState, CartStore };

/** Where Hydrogen's cart route lives. Cart forms post here and the store loads the cart from here. */
export const CART_ENDPOINT = '/api/cart';

/** Dispatched on `document` when a cart form is taken over by the cart store; `detail.form` is the form. */
export const CART_SUBMIT_EVENT = 'astro-hydrogen:cart-submit';

let store: CartStore | undefined;

/** The shared cart store, created on first use. Pass it to other Hydrogen stores, e.g. `createProductFormStore`. */
export function getCartStore(): CartStore {
  if (!store) {
    configureCartEndpoint(CART_ENDPOINT);
    store = createCartStore();
  }
  return store;
}

const listeners = new Set<(cart: CartState) => void>();
/** Forms that submit through their own store, e.g. the product form (it adds product analytics detail). */
const formHandlers = new WeakMap<HTMLFormElement, (event: SubmitEvent) => Promise<void>>();

/** Routes a form's submission through `handler` instead of the cart store's own. */
export function setCartFormHandler(form: HTMLFormElement, handler: (event: SubmitEvent) => Promise<void>): void {
  formHandlers.set(form, handler);
}

/**
 * Calls `callback` with the current cart state now, and again on every change.
 * Returns a function that stops listening. Call {@link connectCart} to load the cart.
 */
export function onCart(callback: (cart: CartState) => void): () => void {
  listeners.add(callback);
  callback(getCartStore().getState());
  return () => {
    listeners.delete(callback);
  };
}

const attached = new WeakSet<HTMLInputElement>();

/** Makes quantity inputs from `register('quantity', { interactive: true })` submit their form on change. */
function attachQuantityInputs() {
  for (const input of document.querySelectorAll<HTMLInputElement>('form[data-cart-form] input[name="quantity"][inputmode="numeric"]')) {
    const form = input.form;
    if (!form || attached.has(input)) continue;
    attached.add(input);
    try {
      attachQuantityInput(input, form);
    } catch {
      // The form's first submit button isn't the set button; the input then submits with the form.
    }
  }
}

let connected = false;

/**
 * Loads the cart from `/api/cart` and starts tracking it. Idempotent, and a no-op on the server.
 *
 * It also installs one capture-phase `submit` listener for `form[data-cart-form]`. When Shopify's
 * Standard Actions script is on the page (`<ShopifyScripts />` with a `SHOP_ID`) the form goes
 * through the cart store without a page load. Otherwise (for example on mock.shop) the browser posts
 * the form natively, which works without JavaScript too; after such a post navigates with Astro's
 * `<ClientRouter />`, the cart is refreshed.
 */
export function connectCart(): void {
  if (connected || typeof window === 'undefined') return;
  connected = true;
  const cart = getCartStore();
  cart.subscribe((state) => {
    for (const listener of [...listeners]) listener(state);
  });
  cart.connect();
  // Cart analytics events; Shopify's analytics bus only exists when <ShopifyScripts /> has a SHOP_ID.
  if (window.Shopify?.analytics) trackCartAnalytics(cart);

  let refreshAfterSwap = false;
  // Capture phase, so it runs before <ClientRouter />, which would turn the post into a navigation.
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const enhanced = form.hasAttribute('data-cart-form');
      if (!enhanced && new URL(form.action, location.href).pathname !== CART_ENDPOINT) return;
      if (enhanced && window.Shopify?.actions?.updateCart) {
        event.preventDefault();
        // Lets app code react, e.g. open a cart drawer.
        document.dispatchEvent(new CustomEvent(CART_SUBMIT_EVENT, { detail: { form } }));
        const handler = formHandlers.get(form) ?? cart.handleFormSubmit;
        handler(event).catch((error) => console.error('Cart update failed', error));
      }
      // Posted the ordinary way: the page navigates, so reload the cart once the new page is in.
      if (!event.defaultPrevented) refreshAfterSwap = true;
    },
    { capture: true },
  );
  attachQuantityInputs();
  document.addEventListener('astro:page-load', attachQuantityInputs);
  document.addEventListener('astro:after-swap', () => {
    if (!refreshAfterSwap) return;
    refreshAfterSwap = false;
    cart.refresh();
  });
}
