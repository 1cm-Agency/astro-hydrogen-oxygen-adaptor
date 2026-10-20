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
  height?: number;
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

/** A `srcset` value with one `{url} {width}w` candidate per width. Non-Shopify URLs give an empty string. */
export function shopifyImageSrcSet(
  url: string,
  { widths = [400, 800, 1200], height, crop }: ShopifyImageSrcSetOptions = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!isShopifyImageHost(parsed.hostname)) return '';
  return widths.map((width) => `${shopifyImageUrl(url, { width, height, crop })} ${width}w`).join(', ');
}
