import { defineConfig, envField } from 'astro/config';
import preact from '@astrojs/preact';
import hydrogen from 'astro-hydrogen';

export default defineConfig({
  output: 'server',
  adapter: hydrogen(),
  integrations: [preact()],
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
  env: {
    schema: {
      FEATURE_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
