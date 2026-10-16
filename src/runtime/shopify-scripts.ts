import {
  renderShopifyScriptTags,
  type ConsentConfig,
  type I18nConfig,
  type ShopifyRouteTemplates,
  type ShopifyScriptsI18n,
  type ShopifyScriptsOptions,
  type ShopifyScriptsShop,
  type ShopifyScriptTagsOptions,
} from '@shopify/hydrogen';
import type { HydrogenLocals, OxygenEnv } from '../config.js';

/** `<ShopifyScripts />` props. Everything is optional; the defaults come from env and the request. */
export interface ShopifyScriptsProps
  extends Pick<ShopifyScriptTagsOptions, 'account' | 'analytics' | 'debug' | 'inbox' | 'nonce' | 'shopifyAnalytics'> {
  /** Overrides `SHOP_ID`, `PUBLIC_STOREFRONT_ID` and `PUBLIC_STORE_DOMAIN`. */
  shop?: Partial<ShopifyScriptsShop>;
  /** Overrides the request's market from `src/hydrogen.config.ts`. Set `currency` for analytics. */
  i18n?: Partial<ShopifyScriptsI18n>;
  /**
   * Which consent script to load. Defaults to `no-banner`. For `custom-banner`, set
   * `initialize={false}` and call `initializeShopifyScripts()` yourself with your `setup` callback.
   */
  consent?: { mode?: NonNullable<ConsentConfig['mode']> };
  /** Loads Shopify's WebMCP tools in browsers that support WebMCP. Defaults to `true`. */
  webMcp?: boolean;
  /**
   * Starts the scripts in the browser, which also sends page view events. Defaults to `true`; set it
   * to `false` to call `initializeShopifyScripts()` yourself.
   */
  initialize?: boolean;
}

/** The serializable options the component passes to `initializeShopifyScripts()` in the browser. */
export type ShopifyScriptsInit = Pick<ShopifyScriptsOptions, 'webMcp'> & {
  consent?: { mode: NonNullable<ConsentConfig['mode']> };
  routes?: ShopifyRouteTemplates;
};

export interface ResolvedShopifyScripts {
  /** HTML for the head: link tags, then script tags. */
  tags: string[];
  init?: ShopifyScriptsInit;
}

let warnedAboutMissingShop = false;

/**
 * Builds Shopify's script tags for the request. Returns `undefined`, and warns once, when the shop
 * ID or domain is missing, as with the mock.shop demo store, because the scripts can't run without them.
 */
export function resolveShopifyScripts({
  locals,
  routeTemplates,
  props,
}: {
  locals: Pick<HydrogenLocals, 'oxygen' | 'shopifyRequestContext'>;
  routeTemplates?: ShopifyRouteTemplates;
  props: ShopifyScriptsProps;
}): ResolvedShopifyScripts | undefined {
  const env: OxygenEnv =
    locals.oxygen?.env ?? (globalThis as { process?: { env?: OxygenEnv } }).process?.env ?? {};
  const { shop: shopProp, i18n: i18nProp, consent, webMcp, initialize = true, ...tagOptions } = props;

  const shopId = shopProp?.shopId ?? readString(env.SHOP_ID);
  const myshopifyDomain = shopProp?.myshopifyDomain ?? readString(env.PUBLIC_STORE_DOMAIN);
  if (!shopId || !myshopifyDomain) {
    if (!warnedAboutMissingShop) {
      warnedAboutMissingShop = true;
      const missing = [!shopId && 'SHOP_ID', !myshopifyDomain && 'PUBLIC_STORE_DOMAIN'].filter(Boolean);
      console.warn(
        `[astro-hydrogen] <ShopifyScripts /> rendered nothing: ${missing.join(' and ')} not set. ` +
          'Run `npx shopify hydrogen env pull`, or pass the `shop` prop.',
      );
    }
    return undefined;
  }

  const shop: ShopifyScriptsShop = {
    shopId,
    myshopifyDomain,
    // Hydrogen's documented fallback for storefronts without a provisioned ID.
    storefrontId: shopProp?.storefrontId ?? readString(env.PUBLIC_STOREFRONT_ID) ?? '0',
  };
  const market: Partial<I18nConfig> = locals.shopifyRequestContext?.i18n ?? {};
  const i18n: ShopifyScriptsI18n = {
    country: market.country ?? 'US',
    language: market.language ?? 'EN',
    ...(market.pathPrefix && { pathPrefix: market.pathPrefix }),
    ...i18nProp,
  } as ShopifyScriptsI18n;
  const consentConfig = consent?.mode ? { mode: consent.mode } : undefined;

  const tags = renderShopifyScriptTags({
    ...tagOptions,
    shop,
    i18n,
    // The tags only depend on the mode; a custom banner's `setup` runs in the browser.
    ...(consentConfig && { consent: consentConfig as ConsentConfig }),
  });

  return {
    tags,
    ...(initialize && {
      init: {
        ...(consentConfig && { consent: consentConfig }),
        ...(routeTemplates && { routes: routeTemplates }),
        ...(webMcp !== undefined && { webMcp }),
      },
    }),
  };
}

/** JSON for an inline `<script type="application/json">`, safe against `</script>` in values. */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
