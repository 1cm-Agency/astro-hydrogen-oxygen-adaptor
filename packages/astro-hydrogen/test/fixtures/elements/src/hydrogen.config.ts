import { defineHydrogenConfig } from 'astro-hydrogen/config';

export default defineHydrogenConfig({
  i18n: ({ url }) =>
    url.pathname === '/en-ca' || url.pathname.startsWith('/en-ca/')
      ? { country: 'CA', language: 'EN', pathPrefix: '/en-ca' }
      : { country: 'US', language: 'EN' },
});
