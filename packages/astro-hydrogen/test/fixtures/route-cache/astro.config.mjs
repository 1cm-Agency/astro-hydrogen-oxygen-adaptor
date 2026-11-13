import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';
// Documented path is 'astro-hydrogen/cache'; this fixture uses the runtime path that exists today.
import { oxygenCache } from 'astro-hydrogen/runtime/oxygen-cache';

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
  cache: { provider: oxygenCache() },
  // Broad rules, as a storefront caching its page shells would write them. They also match island URLs.
  routeRules: {
    '/islands': { maxAge: 60 },
    '/buyer': { maxAge: 60 },
    '/_server-islands/[name]': { maxAge: 60 },
  },
});
