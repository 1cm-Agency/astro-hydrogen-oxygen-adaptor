/**
 * Catalog-only Storefront queries for the content loaders. Every query is paginated and runs
 * `@inContext`, so `$country` and `$language` select the market's prices and translations.
 */

export type Resource = 'products' | 'collections' | 'pages' | 'articles';

export const RESOURCES: readonly Resource[] = ['products', 'collections', 'pages', 'articles'];

const IMAGE = 'url altText width height';
const SEO = 'seo { title description }';

const FIELDS: Record<Resource, string> = {
  products: `id handle title description descriptionHtml vendor productType tags updatedAt
    featuredImage { ${IMAGE} }
    priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
    options { name optionValues { name } }
    ${SEO}`,
  collections: `id handle title description descriptionHtml updatedAt image { ${IMAGE} } ${SEO}`,
  pages: `id handle title body bodySummary updatedAt ${SEO}`,
  articles: `id handle title contentHtml excerpt publishedAt tags
    author { name }
    blog { handle title }
    image { ${IMAGE} }
    ${SEO}`,
};

const TYPE_NAMES: Record<Resource, string> = {
  products: 'Product',
  collections: 'Collection',
  pages: 'Page',
  articles: 'Article',
};

const SORT_KEY_TYPES: Record<Resource, string> = {
  products: 'ProductSortKeys',
  collections: 'CollectionSortKeys',
  pages: 'PageSortKeys',
  articles: 'ArticleSortKeys',
};

const CONTEXT = '$country: CountryCode, $language: LanguageCode';
const IN_CONTEXT = '@inContext(country: $country, language: $language)';

/** A page of a resource: `first`, `after`, `query`, `sortKey` and `reverse` variables. */
export function listQuery(resource: Resource): string {
  const name = TYPE_NAMES[resource];
  return `query ShopifyContent${name}List($first: Int!, $after: String, $query: String, $sortKey: ${SORT_KEY_TYPES[resource]}, $reverse: Boolean, ${CONTEXT}) ${IN_CONTEXT} {
  ${resource}(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ${FIELDS[resource]} }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

/** One entry by handle. Articles use `blog-handle/article-handle`. */
export function entryByHandleQuery(resource: Resource): string {
  const name = TYPE_NAMES[resource];
  if (resource === 'articles') {
    return `query ShopifyContentArticleByHandle($blog: String!, $handle: String!, ${CONTEXT}) ${IN_CONTEXT} {
  blog(handle: $blog) { articleByHandle(handle: $handle) { ${FIELDS.articles} } }
}`;
  }
  return `query ShopifyContent${name}ByHandle($handle: String!, ${CONTEXT}) ${IN_CONTEXT} {
  ${name.toLowerCase()}(handle: $handle) { ${FIELDS[resource]} }
}`;
}

/** One entry by global ID (`gid://shopify/Product/1`). */
export function entryByIdQuery(resource: Resource): string {
  const name = TYPE_NAMES[resource];
  return `query ShopifyContent${name}ById($id: ID!, ${CONTEXT}) ${IN_CONTEXT} {
  node(id: $id) { ... on ${name} { ${FIELDS[resource]} } }
}`;
}

/** The HTML `render()` shows for an entry of this resource. */
export function htmlOf(resource: Resource, node: Record<string, any>): string | undefined {
  const html = resource === 'pages' ? node.body : resource === 'articles' ? node.contentHtml : node.descriptionHtml;
  return typeof html === 'string' ? html : undefined;
}

/** Entry ID: the handle, so `getEntry('products', 'slides')` reads naturally. Articles are `blog/handle`. */
export function entryIdOf(resource: Resource, node: Record<string, any>): string {
  return resource === 'articles' && node.blog?.handle ? `${node.blog.handle}/${node.handle}` : String(node.handle);
}
