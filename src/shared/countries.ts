export interface CountryInfo {
  name: string;
  /** ISO 4217 currency code. */
  currency: string;
}

/**
 * Zomato country codes -> country and currency.
 * Currency is derived from the country, not from the CSV's free-text column, which is
 * unreliable (e.g. the Philippines is labelled "Botswana Pula").
 */
export const COUNTRIES: Readonly<Record<number, CountryInfo>> = {
  1: { name: 'India', currency: 'INR' },
  14: { name: 'Australia', currency: 'AUD' },
  30: { name: 'Brazil', currency: 'BRL' },
  37: { name: 'Canada', currency: 'CAD' },
  94: { name: 'Indonesia', currency: 'IDR' },
  148: { name: 'New Zealand', currency: 'NZD' },
  162: { name: 'Philippines', currency: 'PHP' },
  166: { name: 'Qatar', currency: 'QAR' },
  184: { name: 'Singapore', currency: 'SGD' },
  189: { name: 'South Africa', currency: 'ZAR' },
  191: { name: 'Sri Lanka', currency: 'LKR' },
  208: { name: 'Turkey', currency: 'TRY' },
  214: { name: 'United Arab Emirates', currency: 'AED' },
  215: { name: 'United Kingdom', currency: 'GBP' },
  216: { name: 'United States', currency: 'USD' },
};
