export const WEARS = [
  { code: 'FN', name: 'Factory New', below: 0.07 },
  { code: 'MW', name: 'Minimal Wear', below: 0.15 },
  { code: 'FT', name: 'Field-Tested', below: 0.38 },
  { code: 'WW', name: 'Well-Worn', below: 0.45 },
  { code: 'BS', name: 'Battle-Scarred', below: Number.POSITIVE_INFINITY },
] as const;

export type WearCode = (typeof WEARS)[number]['code'];
export const WEAR_CODES = WEARS.map((w) => w.code) as WearCode[];

/** FN [0, .07) · MW [.07, .15) · FT [.15, .38) · WW [.38, .45) · BS [.45, 1]. Null for vanilla knives. */
export function wearOf(float: number | null): (typeof WEARS)[number] | null {
  if (float === null) return null;
  return WEARS.find((w) => float < w.below) ?? WEARS[WEARS.length - 1]!;
}

/** Float interval [min, max) covered by a wear, used to filter in SQL. */
export function wearRange(code: WearCode): [number, number] {
  const index = WEARS.findIndex((w) => w.code === code);
  const min = index === 0 ? 0 : WEARS[index - 1]!.below;
  const max = WEARS[index]!.below === Number.POSITIVE_INFINITY ? 2 : WEARS[index]!.below;
  return [min, max];
}
