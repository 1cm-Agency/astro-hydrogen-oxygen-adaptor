import { defineMiddleware } from 'astro/middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  // The adapter's middleware has `order: 'pre'`, so it already put the Storefront client here.
  const sawStorefront = typeof (context.locals as { storefront?: unknown }).storefront;
  const response = await next();
  if (!response.headers.has('x-user-middleware')) {
    try {
      response.headers.set('x-user-middleware', sawStorefront);
    } catch {
      return new Response(response.body, {
        status: response.status,
        headers: [...response.headers, ['x-user-middleware', sawStorefront]],
      });
    }
  }
  return response;
});
