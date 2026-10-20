import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';
// Documented path is 'astro-hydrogen/cache'; this fixture uses the runtime path that exists today.
import { oxygenCache } from 'astro-hydrogen/runtime/oxygen-cache';

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
  cache: { provider: oxygenCache() },
});
