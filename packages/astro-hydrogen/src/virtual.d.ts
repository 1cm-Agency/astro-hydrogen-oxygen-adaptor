declare module 'virtual:astro-hydrogen/config' {
  const config: import('./config.js').HydrogenConfig;
  export default config;
}

declare module 'virtual:astro-hydrogen/options' {
  /** Name passed to `caches.open()` for Hydrogen sub-request caching. */
  export const cacheName: string;
  /** Astro's `base`, without a trailing slash; empty when the site is served from the root. */
  export const base: string;
  /** Oxygen's asset CDN base URL for this deployment, when building for `shopify hydrogen deploy`. */
  export const assetBaseUrl: string | undefined;
  /** Whether the adapter's Hydrogen middleware is injected (the `middleware` adapter option). */
  export const middleware: boolean;
  /**
   * Whether the project's `404` page is prerendered. Astro then renders unmatched URLs from the static
   * file without running middleware, so the Worker entry handles Hydrogen routes for them itself.
   */
  export const prerendered404: boolean;
}
