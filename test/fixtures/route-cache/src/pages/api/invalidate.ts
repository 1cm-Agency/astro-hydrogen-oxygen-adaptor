import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ cache, url }) => {
  await cache.invalidate({ tags: url.searchParams.get('tag') ?? 't1' });
  return new Response('invalidated');
};
