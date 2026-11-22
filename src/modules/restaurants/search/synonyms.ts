/** Currency words and symbols -> ISO 4217 (only currencies present in the dataset). "$" means USD. */
export const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  rs: 'INR',
  inr: 'INR',
  rupee: 'INR',
  rupees: 'INR',
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  aed: 'AED',
  aud: 'AUD',
  brl: 'BRL',
  cad: 'CAD',
  idr: 'IDR',
  lkr: 'LKR',
  nzd: 'NZD',
  php: 'PHP',
  qar: 'QAR',
  sgd: 'SGD',
  zar: 'ZAR',
};

export interface DishSynonym {
  /** Substrings of the restaurant name that signal the dish ("Goli Vada Pav No. 1"). */
  names: string[];
  /** Cuisines where the cuisine itself is the dish; dropped if absent from the data. */
  cuisines: string[];
}

/**
 * The dataset has cuisines, not dishes. A dish is matched by name, plus a cuisine only when
 * that cuisine is effectively the dish. Deliberately NOT mapped to a broad cuisine: "vada pav"
 * -> "Street Food" would return the nearest chaat stall, not a vada pav place.
 * Keys are lower-case; spaces match optional whitespace, so "vadapav" also matches "vada pav".
 */
export const DISH_SYNONYMS: Readonly<Record<string, DishSynonym>> = {
  'vada pav': { names: ['vada pav'], cuisines: [] },
  'pav bhaji': { names: ['pav bhaji'], cuisines: [] },
  'chole bhature': { names: ['chole bhature', 'chhole bhature'], cuisines: [] },
  dosa: { names: ['dosa'], cuisines: ['South Indian'] },
  idli: { names: ['idli'], cuisines: ['South Indian'] },
  uttapam: { names: ['uttapam', 'uttappam'], cuisines: ['South Indian'] },
  sambar: { names: ['sambar'], cuisines: ['South Indian'] },
  thali: { names: ['thali'], cuisines: [] },
  biryani: { names: ['biryani'], cuisines: ['Biryani', 'Hyderabadi'] },
  'butter chicken': { names: [], cuisines: ['North Indian', 'Mughlai'] },
  'dal makhani': { names: [], cuisines: ['North Indian'] },
  tandoori: { names: ['tandoor'], cuisines: ['North Indian', 'Mughlai'] },
  kebabs: { names: ['kebab', 'kabab'], cuisines: ['Kebab'] },
  momos: { names: ['momo'], cuisines: ['Tibetan'] },
  noodles: { names: ['noodle'], cuisines: ['Chinese'] },
  pasta: { names: ['pasta'], cuisines: ['Italian'] },
  burgers: { names: ['burger'], cuisines: ['Burger'] },
  pizzas: { names: ['pizza'], cuisines: ['Pizza'] },
  steak: { names: ['steak'], cuisines: ['Steak'] },
  sushi: { names: ['sushi'], cuisines: ['Sushi'] },
  ramen: { names: ['ramen'], cuisines: ['Ramen'] },
  chai: { names: ['chai'], cuisines: ['Tea', 'Coffee and Tea'] },
  coffee: { names: ['coffee'], cuisines: ['Coffee and Tea', 'Cafe'] },
  'ice cream': { names: ['ice cream'], cuisines: ['Ice Cream'] },
  cake: { names: ['cake'], cuisines: ['Bakery', 'Patisserie'] },
  cakes: { names: ['cake'], cuisines: ['Bakery', 'Patisserie'] },
  pastry: { names: ['pastry'], cuisines: ['Bakery', 'Patisserie'] },
  sweets: { names: ['sweet', 'mithai'], cuisines: ['Mithai'] },
};
