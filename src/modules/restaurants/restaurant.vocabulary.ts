/** Spellings users type that differ from the canonical value stored in the data (keys lower-case). */
export const CITY_ALIASES: Readonly<Record<string, string>> = {
  gurugram: 'gurgaon',
  delhi: 'new delhi',
  'delhi ncr': 'new delhi',
  ncr: 'new delhi',
};

export type Lookup = ReadonlyMap<string, string>;

/** Case-insensitive map from lower-case value to its canonical spelling. */
export function makeLookup(values: readonly string[]): Lookup {
  return new Map(values.map((value) => [value.toLowerCase(), value]));
}

/**
 * Resolves user input to the canonical stored spelling (so equality filters stay index-friendly
 * instead of falling back to case-insensitive regexes). Unknown input is returned trimmed.
 */
export function canonicalize(
  input: string,
  lookup: Lookup,
  aliases: Readonly<Record<string, string>> = {},
): string {
  const key = input.trim().toLowerCase();
  return lookup.get(aliases[key] ?? key) ?? input.trim();
}
