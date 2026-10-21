import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildFixture } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

describe('features fixture', () => {
  let site;
  before(async () => {
    site = await buildFixture('features', { env: { FEATURE_SECRET: 's3cret-from-bindings' } });
  });
  after(() => site?.dispose());

  it('answers Astro Actions posted as JSON', async () => {
    const res = await site.fetch('/_actions/hello', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://shop.test' },
      body: JSON.stringify({ name: 'oxygen' }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /hello oxygen/);
  });

  it('feeds astro:env secrets from the Worker bindings', async () => {
    const html = await (await site.fetch('/env')).text();
    assert.equal(textById(html, 'secret'), 's3cret-from-bindings');
    assert.equal(textById(html, 'get-secret'), 's3cret-from-bindings');
  });

  it('still renders when a page touches Astro.session without a driver', async () => {
    const res = await site.fetch('/session');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /id="session"/);
  });

  it('server-renders a Preact client:load island', async () => {
    const html = await (await site.fetch('/')).text();
    assert.match(html, /<astro-island[^>]*client="load"/);
    assert.match(html, /<button id="counter">count <!-- -->0<\/button>|<button id="counter">count\s*0/);
  });

  it('routes i18n locales', async () => {
    const en = await site.fetch('/');
    assert.match(await en.text(), /features-en/);
    const fr = await site.fetch('/fr/');
    assert.equal(fr.status, 200);
    const html = await fr.text();
    assert.match(html, /features-fr/);
    assert.equal(textById(html, 'locale'), 'fr');
  });
});
