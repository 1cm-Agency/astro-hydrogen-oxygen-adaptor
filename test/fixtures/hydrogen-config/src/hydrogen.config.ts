import { createShopifyRouteHandler, createShopifyRouteTemplates } from '@shopify/hydrogen';
import { defineHydrogenConfig } from 'astro-hydrogen/config';
import { createDefaultStorefrontClient } from 'astro-hydrogen/runtime/storefront';

const ping = {
  ping: createShopifyRouteHandler('/api/ping', 'GET', async () => ({ type: 'json', data: { ok: true } })),
};

export default defineHydrogenConfig({
  i18n: ({ url }) =>
    url.pathname === '/en-ca' || url.pathname.startsWith('/en-ca/')
      ? { country: 'CA', language: 'EN', pathPrefix: '/en-ca' }
      : { country: 'US', language: 'EN' },
  routeTemplates: createShopifyRouteTemplates({ product: '/p/:productHandle' }),
  handlers: ({ defaults }) => [...defaults, ping],
  getBuyerIp: ({ request }) => request.headers.get('x-real-ip') ?? undefined,
  storefront: async (args) => {
    const client = await createDefaultStorefrontClient(args);
    return Object.assign(client, { customFactory: true });
  },
  shopifyRedirects: false,
});
