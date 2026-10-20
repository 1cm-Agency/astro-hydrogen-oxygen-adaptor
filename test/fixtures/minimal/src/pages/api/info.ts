import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ clientAddress, locals }) =>
  Response.json({
    clientAddress,
    buyer: locals.buyer,
    envKeys: Object.keys(locals.oxygen.env).sort(),
    userAgent: globalThis.navigator?.userAgent,
  });
