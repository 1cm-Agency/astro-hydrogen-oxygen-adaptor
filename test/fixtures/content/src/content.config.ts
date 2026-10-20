import { defineCollection } from 'astro:content';
import { shopifyLoader } from 'astro-hydrogen/content';

export const collections = {
  products: defineCollection({ loader: shopifyLoader({ resource: 'products', max: 10 }) }),
  pages: defineCollection({ loader: shopifyLoader({ resource: 'pages' }) }),
  articles: defineCollection({ loader: shopifyLoader({ resource: 'articles', max: 3, first: 2 }) }),
};
