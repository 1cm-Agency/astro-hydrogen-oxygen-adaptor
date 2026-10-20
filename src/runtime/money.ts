import { formatMoney, type FormatMoneyOptions, type MoneyV2 } from '@shopify/hydrogen';

/** The market part of Hydrogen's request context. */
export interface MoneyI18n {
  language: string;
  country: string;
}

/** The default locale, used when the request has no market (for example with the middleware disabled). */
export const DEFAULT_LOCALE = 'en-US';

/** The BCP 47 locale `formatMoney` expects for a market: `{ language: 'EN', country: 'CA' }` gives `en-CA`. */
export function resolveLocale(i18n?: Partial<MoneyI18n> | null): string {
  if (!i18n?.language || !i18n.country) return DEFAULT_LOCALE;
  return `${i18n.language.toLowerCase()}-${i18n.country}`;
}

/** Formats a price, or a `[min, max]` range, for the market. Returns Hydrogen's `localizedString`. */
export function formatPrice(
  money: MoneyV2 | readonly [MoneyV2, MoneyV2],
  options: Partial<Omit<FormatMoneyOptions, 'locale'>> & { locale?: string; i18n?: Partial<MoneyI18n> | null } = {},
): string {
  const { locale, i18n, ...rest } = options;
  const formatOptions = { ...rest, locale: locale ?? resolveLocale(i18n) };
  return (Array.isArray(money) ? formatMoney(money, formatOptions) : formatMoney(money as MoneyV2, formatOptions))
    .localizedString;
}
