import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';
import svelte from '@astrojs/svelte';
import hydrogen from 'astro-hydrogen';

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
  integrations: [solid(), svelte()],
});
