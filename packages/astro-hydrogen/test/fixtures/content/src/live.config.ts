import { defineLiveCollection } from 'astro:content';
import { Cache } from '@shopify/hydrogen';
import { shopifyLiveLoader } from 'astro-hydrogen/content';

export const collections = {
  liveProducts: defineLiveCollection({ loader: shopifyLiveLoader({ resource: 'products' }) }),
  // An hour-long cache window, to observe the sub-request cache.
  cachedProducts: defineLiveCollection({
    loader: shopifyLiveLoader({ resource: 'products', cache: Cache({ maxAge: 3600 }) }),
  }),
};
