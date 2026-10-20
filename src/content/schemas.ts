import { z } from 'astro/zod';

const image = z
  .object({ url: z.string(), altText: z.string().nullish(), width: z.number().nullish(), height: z.number().nullish() })
  .passthrough()
  .nullish();
const seo = z.object({ title: z.string().nullish(), description: z.string().nullish() }).passthrough().nullish();
const money = z.object({ amount: z.string(), currencyCode: z.string() }).passthrough();

const product = z
  .object({
    id: z.string(),
    handle: z.string(),
    title: z.string(),
    description: z.string().optional(),
    descriptionHtml: z.string().optional(),
    vendor: z.string().optional(),
    productType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    updatedAt: z.string().optional(),
    featuredImage: image,
    priceRange: z.object({ minVariantPrice: money, maxVariantPrice: money }).passthrough().optional(),
    options: z
      .array(z.object({ name: z.string(), optionValues: z.array(z.object({ name: z.string() }).passthrough()).optional() }).passthrough())
      .optional(),
    seo,
  })
  .passthrough();

const collection = z
  .object({
    id: z.string(),
    handle: z.string(),
    title: z.string(),
    description: z.string().optional(),
    descriptionHtml: z.string().optional(),
    updatedAt: z.string().optional(),
    image,
    seo,
  })
  .passthrough();

const page = z
  .object({
    id: z.string(),
    handle: z.string(),
    title: z.string(),
    body: z.string().optional(),
    bodySummary: z.string().optional(),
    updatedAt: z.string().optional(),
    seo,
  })
  .passthrough();

const article = z
  .object({
    id: z.string(),
    handle: z.string(),
    title: z.string(),
    contentHtml: z.string().optional(),
    excerpt: z.string().nullish(),
    publishedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.object({ name: z.string() }).passthrough().nullish(),
    blog: z.object({ handle: z.string(), title: z.string() }).passthrough().optional(),
    image,
    seo,
  })
  .passthrough();

/**
 * Loose (`passthrough`) schemas for each resource, so `getCollection()` is typed and extra fields
 * from a custom query survive. Pass one as `schema` in `defineCollection` to extend it.
 */
export const shopifySchemas = { products: product, collections: collection, pages: page, articles: article };
