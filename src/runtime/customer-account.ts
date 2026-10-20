import { createCartServerHandlers, createPredictiveSearchServerHandlers, type ShopifyRouteHandlerGroup } from '@shopify/hydrogen';
import {
  createCustomerAccountServerHandlers,
  createCustomerSession,
  type CustomerSession,
} from '@shopify/hydrogen/customer-account';
import type { CustomerAccountOptions, OxygenEnv } from '../config.js';

type CartSyncSource = Parameters<typeof createCustomerAccountServerHandlers>[0]['cartServerHandlers'] & object;

export interface CustomerAccountSetup {
  shopId: string;
  customerSession: CustomerSession;
  /** Cart, predictive search and (when enabled) customer account handler groups. */
  handlers: readonly ShopifyRouteHandlerGroup[];
}

export const MISSING = (name: string) =>
  `[astro-hydrogen] \`customerAccount\` is enabled but ${name} is not set. Link the storefront and run \`shopify hydrogen env pull\` to write it to .env (Oxygen injects it automatically on deploy).`;

/** Reads the Customer Account env vars, throwing a clear error for any that is missing. */
export function readCustomerAccountEnv(env: OxygenEnv) {
  const get = (name: keyof OxygenEnv & string) => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(MISSING(name));
    return value.trim();
  };
  const apiUrl = env.PUBLIC_CUSTOMER_ACCOUNT_API_URL;
  return {
    shopId: get('SHOP_ID'),
    clientId: get('PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID'),
    apiUrl: typeof apiUrl === 'string' && apiUrl.trim() ? apiUrl.trim() : undefined,
  };
}

const cache = new Map<string, CustomerAccountSetup>();

/**
 * Builds the customer session and handler groups once per Worker. The env is constant for a
 * deployment, so the result is cached by shop ID, client ID and API URL.
 */
export function getCustomerAccountSetup(
  env: OxygenEnv,
  options: boolean | CustomerAccountOptions,
): CustomerAccountSetup {
  const { shopId, clientId, apiUrl } = readCustomerAccountEnv(env);
  const key = `${shopId}|${clientId}|${apiUrl ?? ''}`;
  let setup = cache.get(key);
  if (!setup) {
    const opts = typeof options === 'object' ? options : {};
    const customerSession = createCustomerSession({
      shopId,
      customerAccountApiClientId: clientId,
      ...(apiUrl ? { customerAccountApiUrl: apiUrl } : {}),
    });
    const { cartSync, ...handlerOptions } = opts;
    // Cart handlers created with the session let the account routes attach the customer to the
    // cart on sign-in and detach them on logout. The adapter's Vite plugin makes sure `astro dev`
    // runs one build of Hydrogen, which the brand check inside Hydrogen relies on.
    const cartServerHandlers = cartSync === false ? createCartServerHandlers() : createCartServerHandlers({ customerSession });
    const accountHandlers =
      cartSync === false
        ? createCustomerAccountServerHandlers({ customerSession, ...handlerOptions })
        : createCustomerAccountServerHandlers({
            customerSession,
            cartServerHandlers: cartServerHandlers as CartSyncSource,
            ...handlerOptions,
          });
    setup = {
      shopId,
      customerSession,
      handlers: [cartServerHandlers, createPredictiveSearchServerHandlers(), accountHandlers] as readonly ShopifyRouteHandlerGroup[],
    };
    cache.set(key, setup);
  }
  return setup;
}
