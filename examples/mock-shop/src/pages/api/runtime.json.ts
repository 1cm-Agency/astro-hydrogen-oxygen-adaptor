import type { APIRoute } from 'astro';

/** Shows which runtime served the request and what Oxygen provides on `locals.oxygen`. */
export const GET: APIRoute = ({ locals, clientAddress }) =>
  Response.json({
    runtime: globalThis.navigator?.userAgent,
    oxygen: Boolean(locals.oxygen),
    workerCache: Boolean(locals.oxygen?.cache),
    envKeys: Object.keys(locals.oxygen?.env ?? {}).filter((key) => key.startsWith('PUBLIC_')),
    storefrontClient: locals.storefront.type,
    clientAddress,
    buyer: locals.buyer,
  });
