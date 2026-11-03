/** Search words: "mp9 hyd" → ["mp9", "hyd"]. Separators (" | ", ★) don't count. */
export function searchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s|★]+/)
    .filter(Boolean)
    .slice(0, 6);
}

/** Every word must appear somewhere in the name ("mp9 hyd" finds "MP9 | Hydra"). */
export function matchesTokens(name: string, tokens: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

/**
 * Suggestion order: the weapon starts with the first word ("mp9" → MP9 skins), then the finish
 * starts with a word ("hyd" → Hydra), then any other match.
 */
export function suggestionRank(skin: { weaponName: string; finishName: string | null }, tokens: readonly string[]): number {
  const weapon = skin.weaponName.toLowerCase().replace(/^★\s*/, '');
  const finish = (skin.finishName ?? '').toLowerCase();
  if (tokens[0] && weapon.startsWith(tokens[0])) return 0;
  if (tokens.some((t) => finish.startsWith(t))) return 1;
  return 2;
}
