import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';

export default defineConfig({
  base: '/shop',
  adapter: hydrogen(),
});
