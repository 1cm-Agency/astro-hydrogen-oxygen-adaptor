import { defineConfig } from 'astro/config';
import hydrogen from 'astro-hydrogen';

// What `astro add astro-hydrogen` writes: the integration only, no `adapter`, no `output`.
export default defineConfig({
  integrations: [hydrogen()],
});
