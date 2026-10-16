/** The project's `src/hydrogen.config.ts`, shared by the middleware and `<ShopifyScripts />`. */
import config from 'virtual:astro-hydrogen/config';

export { config };

/** Custom route templates, when the storefront serves Shopify resources at non-standard paths. */
export const routeTemplates = config.routeTemplates;
