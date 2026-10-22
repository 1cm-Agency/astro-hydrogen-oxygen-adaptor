/** Hosts whose images Shopify's CDN can resize through URL parameters. */
const SHOPIFY_IMAGE_HOSTS = ['cdn.shopify.com', 'mock.shop'];

export type ShopifyImageCrop = 'top' | 'center' | 'bottom' | 'left' | 'right';

export interface ShopifyImageOptions {
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
  /** Which part to keep when both `width` and `height` change the aspect ratio. */
  crop?: ShopifyImageCrop;
}

export interface ShopifyImageSrcSetOptions {
  /** Widths in pixels, one `srcset` candidate each. Defaults to `[400, 800, 1200]`. */
  widths?: readonly number[];
  /**
   * Display width in pixels. Together with `height` it fixes the aspect ratio: each candidate gets
   * `height * candidateWidth / width`. Without it, `height` and `crop` are left out of the
   * candidates, which then keep the image's own ratio.
   */
  width?: number;
  /** Display height in pixels; see `width`. */
  height?: number;
  /** Which part to keep when `width` and `height` change the aspect ratio. */
  crop?: ShopifyImageCrop;
}

/** Whether Shopify's CDN can resize images on `hostname` (`cdn.shopify.com`, `mock.shop` and their subdomains). */
export function isShopifyImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return SHOPIFY_IMAGE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * Sizes a Shopify CDN image by URL parameters. URLs on other hosts, and strings that are not
 * absolute URLs, are returned unchanged.
 */
export function shopifyImageUrl(url: string, { width, height, crop }: ShopifyImageOptions = {}): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!isShopifyImageHost(parsed.hostname)) return url;
  if (width !== undefined) parsed.searchParams.set('width', String(width));
  if (height !== undefined) parsed.searchParams.set('height', String(height));
  if (crop !== undefined) parsed.searchParams.set('crop', crop);
  return parsed.href;
}

/**
 * A `srcset` value with one `{url} {width}w` candidate per width. Non-Shopify URLs give an empty
 * string. `height` applies only together with `width`, scaled to each candidate, so every candidate
 * has the aspect ratio of the displayed image rather than one fixed height.
 */
export function shopifyImageSrcSet(
  url: string,
  { widths = [400, 800, 1200], width, height, crop }: ShopifyImageSrcSetOptions = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!isShopifyImageHost(parsed.hostname)) return '';
  const ratio = width && height ? height / width : undefined;
  return widths
    .map((candidate) => {
      const options: ShopifyImageOptions =
        ratio === undefined ? { width: candidate } : { width: candidate, height: Math.round(candidate * ratio), crop };
      return `${shopifyImageUrl(url, options)} ${candidate}w`;
    })
    .join(', ');
}
