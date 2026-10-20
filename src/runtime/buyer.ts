import type { OxygenBuyer } from '../config.js';

const STRING_HEADERS = {
  country: 'oxygen-buyer-country',
  region: 'oxygen-buyer-region',
  regionCode: 'oxygen-buyer-region-code',
  city: 'oxygen-buyer-city',
  postalCode: 'oxygen-buyer-postal-code',
  continent: 'oxygen-buyer-continent',
  timezone: 'oxygen-buyer-timezone',
  metroCode: 'oxygen-buyer-metro-code',
  shopId: 'oxygen-buyer-shop-id',
  storefrontId: 'oxygen-buyer-storefront-id',
  deploymentId: 'oxygen-buyer-deployment-id',
} as const;

/** Reads Oxygen's geolocation headers. `ip` comes from the adapter's buyer IP resolution. */
export function getOxygenBuyer(headers: Headers, ip: string | undefined): OxygenBuyer {
  const buyer: OxygenBuyer = { isEuCountry: isEuCountry(headers.get('oxygen-buyer-is-eu-country')) };
  if (ip) buyer.ip = ip;
  for (const [key, header] of Object.entries(STRING_HEADERS) as [keyof typeof STRING_HEADERS, string][]) {
    const value = headers.get(header)?.trim();
    if (value) buyer[key] = value;
  }
  const latitude = toNumber(headers.get('oxygen-buyer-latitude'));
  const longitude = toNumber(headers.get('oxygen-buyer-longitude'));
  if (latitude !== undefined) buyer.latitude = latitude;
  if (longitude !== undefined) buyer.longitude = longitude;
  return buyer;
}

/** Oxygen documents any non-empty value as "in the EU"; absent or empty means not. */
function isEuCountry(value: string | null): boolean {
  return !!value?.trim();
}

function toNumber(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
