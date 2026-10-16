const SUBREQUEST_HEADER = 'x-astro-hydrogen-asset';

/** True for the Worker's own asset subrequests, so a missing file can never recurse. */
export function isStaticAssetSubrequest(request: Request): boolean {
  return request.headers.has(SUBREQUEST_HEADER);
}

/**
 * Fetches a prerendered HTML file from the deployment's client assets.
 *
 * With `assetBaseUrl` (set by `shopify hydrogen deploy` at build time) files come straight from
 * Oxygen's CDN. Without it, such as in `astro preview`, they are requested from the storefront
 * origin, where `.html` paths are served from the assets directory.
 */
export async function fetchPrerenderedPage(
  request: Request,
  pathname: string,
  assetBaseUrl: string | undefined,
): Promise<Response | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;

  for (const candidate of htmlCandidates(pathname)) {
    const url = assetBaseUrl
      ? new URL(candidate.replace(/^\/+/, ''), assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`)
      : new URL(candidate, request.url);

    const response = await fetch(url, {
      headers: { [SUBREQUEST_HEADER]: '1', accept: 'text/html' },
      signal: request.signal,
    }).catch(() => undefined);

    if (!response?.ok) {
      await response?.body?.cancel();
      continue;
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.delete('set-cookie');
    headers.delete('access-control-allow-origin');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
  }

  return undefined;
}

function htmlCandidates(pathname: string): string[] {
  if (pathname.endsWith('.html')) return [pathname];
  if (pathname.endsWith('/')) return [`${pathname}index.html`];
  return [`${pathname}/index.html`, `${pathname}.html`];
}
