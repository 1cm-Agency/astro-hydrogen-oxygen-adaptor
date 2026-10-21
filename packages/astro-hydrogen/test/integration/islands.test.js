import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dev } from 'astro';
import { buildFixture, DEV_PORT_RANGE, freePort, pathOf } from '../helpers/fixture.js';
import { textById } from '../helpers/html.js';

// Solid and Svelte islands: server-rendered inside the Worker (workerd), hydrated from the asset CDN.
// Hydration itself was verified in a browser against `astro preview`; here the test checks the SSR
// output and that every island's component and renderer module is served.

/** `{ name, client, ssr, componentUrl, rendererUrl }` for each `<astro-island>` in `html`. */
function islandsIn(html) {
  return [...html.matchAll(/<astro-island\b([^>]*)>/g)].map(([, attrs]) => {
    const attr = (name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return {
      name: JSON.parse(attr('opts').replaceAll('&quot;', '"')).name,
      client: attr('client'),
      ssr: /\bssr\b/.test(attrs),
      componentUrl: attr('component-url'),
      rendererUrl: attr('renderer-url'),
    };
  });
}

describe('islands fixture (Solid + Svelte) in the Worker', () => {
  let site;
  before(async () => {
    site = await buildFixture('islands', { cdn: true });
  });
  after(() => site?.dispose());

  const headers = { 'oxygen-buyer-country': 'CA' };

  it('server-renders Solid and Svelte islands with their props', async () => {
    const res = await site.fetch('/', { headers });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(textById(html, 'title'), 'islands-ssr');
    assert.match(html, /<button[^>]*id="solid-counter"[^>]*>(?:<!--\$-->)?solid(?:<!--\/-->)? (?:<!--\$-->)?5/);
    assert.match(html, /<button id="svelte-counter">svelte 7<\/button>/);
    // Props coming from Astro.locals reach both renderers.
    assert.match(html, /svelte-visible CA/);
    assert.match(html, /props="\{&quot;country&quot;:\[0,&quot;CA&quot;\]\}"/);
  });

  it('emits one island per directive, with the right renderer', async () => {
    const html = await (await site.fetch('/', { headers })).text();
    const islands = islandsIn(html);
    assert.deepEqual(
      islands.map(({ name, client, ssr }) => ({ name, client, ssr })),
      [
        { name: 'SolidCounter', client: 'load', ssr: true },
        { name: 'SvelteCounter', client: 'load', ssr: true },
        { name: 'SvelteGreeting', client: 'visible', ssr: true },
        { name: 'SolidBuyer', client: 'only', ssr: true },
      ],
    );
    assert.match(islands[0].rendererUrl, /\/_astro\/client\.[\w-]+\.js$/);
    assert.match(islands[1].rendererUrl, /\/_astro\/client\.svelte\.[\w-]+\.js$/);
    assert.equal(islands[0].rendererUrl, islands[3].rendererUrl, 'Solid islands share a renderer');
    assert.equal(islands[1].rendererUrl, islands[2].rendererUrl, 'Svelte islands share a renderer');
    // client:only renders nothing on the server.
    assert.match(html, /<astro-island [^>]*client="only"[^>]*><\/astro-island>/);
  });

  it('serves every island module from the asset CDN as JavaScript', async () => {
    const html = await (await site.fetch('/', { headers })).text();
    const urls = new Set(islandsIn(html).flatMap(({ componentUrl, rendererUrl }) => [componentUrl, rendererUrl]));
    assert.equal(urls.size, 6);
    for (const url of urls) {
      assert.ok(url.startsWith(site.assetsUrl), `${url} is on the CDN`);
      const res = await fetch(url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type') ?? '', /javascript/, url);
      assert.match(await res.text(), /export\s*\{/, url);
    }
  });

  it('serves a prerendered page with islands from the CDN', async () => {
    const res = await site.fetch('/static');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(textById(html, 'title'), 'islands-prerendered');
    assert.deepEqual(
      islandsIn(html).map(({ name, client }) => ({ name, client })),
      [
        { name: 'SolidCounter', client: 'load' },
        { name: 'SvelteCounter', client: 'load' },
      ],
    );
  });

  it('renders a client:idle Solid island on a page with no Svelte', async () => {
    const html = await (await site.fetch('/solid-only')).text();
    assert.deepEqual(
      islandsIn(html).map(({ name, client }) => ({ name, client })),
      [{ name: 'SolidCounter', client: 'idle' }],
    );
    assert.match(html, /idle(?:<!--\/-->)? (?:<!--\$-->)?1/);
  });
});

describe('islands fixture under astro dev', () => {
  let server;
  let origin;
  before(async () => {
    const port = await freePort(DEV_PORT_RANGE);
    server = await dev({ root: pathOf('islands'), server: { port, host: '127.0.0.1' }, logLevel: 'error' });
    origin = `http://127.0.0.1:${port}`;
  });
  after(() => server?.stop());

  it('server-renders both frameworks inside MiniOxygen', async () => {
    const res = await fetch(`${origin}/`, { headers: { 'oxygen-buyer-country': 'FR' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(textById(html, 'country'), 'FR');
    assert.match(html, /id="solid-counter"/);
    assert.match(html, /<button id="svelte-counter">svelte 7<\/button>/);
    const islands = islandsIn(html);
    assert.equal(islands.length, 4);
    assert.ok(islands.some(({ rendererUrl }) => rendererUrl === '/@id/@astrojs/solid-js/client.js'));
    assert.ok(islands.some(({ rendererUrl }) => rendererUrl === '/@id/@astrojs/svelte/client.js'));
  });

  it('serves the Solid and Svelte client modules', async () => {
    for (const path of ['/@id/@astrojs/solid-js/client.js', '/@id/@astrojs/svelte/client.js']) {
      const res = await fetch(`${origin}${path}`);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') ?? '', /javascript/, path);
    }
  });
});
