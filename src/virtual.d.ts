declare module 'virtual:astro-hydrogen/config' {
  const config: import('./config.js').HydrogenConfig;
  export default config;
}

declare module 'virtual:astro-hydrogen/options' {
  /** Name passed to `caches.open()` for Hydrogen sub-request caching. */
  export const cacheName: string;
  /** Oxygen's asset CDN base URL for this deployment, when building for `shopify hydrogen deploy`. */
  export const assetBaseUrl: string | undefined;
}
