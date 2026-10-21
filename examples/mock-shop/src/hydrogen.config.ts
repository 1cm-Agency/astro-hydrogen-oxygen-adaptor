import { defineHydrogenConfig } from 'astro-hydrogen/config';

// Other options (routes, redirects, sessions, caching) are documented in the astro-hydrogen README.
export default defineHydrogenConfig({
  i18n: { country: 'US', language: 'EN' },
});
