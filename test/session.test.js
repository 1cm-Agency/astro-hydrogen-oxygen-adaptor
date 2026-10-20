import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createCookieSessionManager } from '../dist/runtime/cookie-session.js';

const SECRET = 'a-test-secret-of-reasonable-length';

function req(url, cookie) {
  return new Request(url, cookie ? { headers: { cookie } } : undefined);
}
/** `name=value` pair from a set-cookie header. */
const pair = (setCookie) => setCookie.split(';')[0];

describe('cookie session', () => {
  it('round-trips values across two requests', async () => {
    const first = createCookieSessionManager({ request: req('https://shop.example/'), secret: SECRET });
    await first.setSessionItem('customerAccount', { accessToken: 'tok', nested: { n: 1 } });
    await first.setSessionItem('other', 'x');
    const headers = await first.commit();
    assert.ok(headers['set-cookie']);
    assert.ok(!headers['set-cookie'].includes('tok'), 'value is encrypted');

    const second = createCookieSessionManager({
      request: req('https://shop.example/next', pair(headers['set-cookie'])),
      secret: SECRET,
    });
    assert.deepEqual(await second.getSessionItem('customerAccount'), { accessToken: 'tok', nested: { n: 1 } });
    assert.equal(await second.getSessionItem('other'), 'x');
    assert.equal(await second.commit(), undefined, 'clean session sets no cookie');
    assert.equal(second.getSessionOrigin(), 'https://shop.example');
  });

  it('is secure by default over https with the __Host- prefix', async () => {
    const session = createCookieSessionManager({ request: req('https://shop.example/'), secret: SECRET });
    await session.setSessionItem('a', 1);
    const cookie = (await session.commit())['set-cookie'];
    assert.match(cookie, /^__Host-session=/);
    for (const attr of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=2592000']) {
      assert.ok(cookie.includes(attr), attr);
    }
    assert.ok(!cookie.includes('Domain'));
  });

  it('uses a plain, non-Secure cookie over http', async () => {
    const session = createCookieSessionManager({ request: req('http://localhost:4321/'), secret: SECRET });
    await session.setSessionItem('a', 1);
    const cookie = (await session.commit())['set-cookie'];
    assert.match(cookie, /^session=/);
    assert.ok(!cookie.includes('Secure'));
    assert.ok(!cookie.includes('__Host-'));
  });

  it('honours cookie options', async () => {
    const session = createCookieSessionManager({
      request: req('https://shop.example/'),
      secret: SECRET,
      cookie: { name: 'sid', maxAge: 60, sameSite: 'Strict', path: '/shop', secure: false },
    });
    await session.setSessionItem('a', 1);
    const cookie = (await session.commit())['set-cookie'];
    assert.match(cookie, /^sid=/);
    assert.ok(cookie.includes('Max-Age=60') && cookie.includes('SameSite=Strict') && cookie.includes('Path=/shop'));
    assert.ok(!cookie.includes('Secure'));
  });

  async function issue(url = 'https://shop.example/') {
    const session = createCookieSessionManager({ request: req(url), secret: SECRET });
    await session.setSessionItem('a', 'secret-value');
    return (await session.commit())['set-cookie'];
  }

  it('yields an empty session for tampered, garbage, truncated and wrong-secret cookies', async () => {
    const good = pair(await issue());
    const [name, value] = [good.slice(0, good.indexOf('=')), good.slice(good.indexOf('=') + 1)];
    const flipped = value.slice(0, 20) + (value[20] === 'A' ? 'B' : 'A') + value.slice(21);
    const cases = {
      tampered: [`${name}=${flipped}`, SECRET],
      garbage: [`${name}=not base64 !!!`, SECRET],
      truncated: [`${name}=${value.slice(0, 10)}`, SECRET],
      empty: [`${name}=`, SECRET],
      'wrong secret': [good, 'a-different-secret'],
      'other cookie name': [`session=${value}`, SECRET],
    };
    for (const [label, [cookie, secret]] of Object.entries(cases)) {
      const session = createCookieSessionManager({ request: req('https://shop.example/', cookie), secret });
      assert.equal(await session.getSessionItem('a'), undefined, label);
    }
  });

  it('rejects a cookie replayed under another name', async () => {
    const good = pair(await issue());
    const value = good.slice(good.indexOf('=') + 1);
    const session = createCookieSessionManager({
      request: req('https://shop.example/', `other=${value}`),
      secret: SECRET,
      cookie: { name: 'other' },
    });
    assert.equal(await session.getSessionItem('a'), undefined);
  });

  it('rejects an expired payload', async () => {
    const session = createCookieSessionManager({
      request: req('https://shop.example/'),
      secret: SECRET,
      cookie: { maxAge: -10 },
    });
    await session.setSessionItem('a', 1);
    const cookie = pair((await session.commit())['set-cookie']);
    const next = createCookieSessionManager({ request: req('https://shop.example/', cookie), secret: SECRET });
    assert.equal(await next.getSessionItem('a'), undefined);
  });

  it('expires the cookie when the session becomes empty, but never invents one', async () => {
    const cookie = pair(await issue());
    const session = createCookieSessionManager({ request: req('https://shop.example/', cookie), secret: SECRET });
    await session.removeSessionItem('a');
    const expired = (await session.commit())['set-cookie'];
    assert.match(expired, /^__Host-session=;/);
    assert.ok(expired.includes('Max-Age=0'));

    const anonymous = createCookieSessionManager({ request: req('https://shop.example/'), secret: SECRET });
    await anonymous.removeSessionItem('a');
    assert.equal(await anonymous.commit(), undefined);
  });

  it('warns once when the cookie exceeds the 4KB limit', async () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      for (let i = 0; i < 2; i++) {
        const session = createCookieSessionManager({ request: req('https://shop.example/'), secret: SECRET });
        await session.setSessionItem('big', Array.from({ length: 400 }, (_, n) => `${n}-${Math.random()}`).join());
        assert.ok((await session.commit())['set-cookie'].length > 4096);
      }
      assert.equal(warn.mock.callCount(), 1);
      assert.match(warn.mock.calls[0].arguments[0], /4096/);
    } finally {
      warn.mock.restore();
    }
  });
});
