import type { SkinCard, Tier, WearCode } from '../../../shared/api';

// Design tokens per rarity (DESIGN.md §2). Colour = bars and dots, text = coloured labels.
export const RARITY: Record<Tier, { name: string; color: string; text: string; halo: string }> = {
  milspec: { name: 'Mil-Spec', color: 'var(--milspec)', text: 'var(--milspec-text)', halo: 'var(--milspec-halo)' },
  restricted: { name: 'Restricted', color: 'var(--restricted)', text: 'var(--restricted-text)', halo: 'var(--restricted-halo)' },
  classified: { name: 'Classified', color: 'var(--classified)', text: 'var(--classified-text)', halo: 'var(--classified-halo)' },
  covert: { name: 'Covert', color: 'var(--covert)', text: 'var(--covert-text)', halo: 'var(--covert-halo)' },
  gold: { name: '★ Rare special', color: 'var(--gold)', text: 'var(--gold-text)', halo: 'var(--gold-halo)' },
};

export const TIER_ORDER: Tier[] = ['milspec', 'restricted', 'classified', 'covert', 'gold'];

export const WEAR_COLOR: Record<WearCode, string> = {
  FN: 'var(--wear-fn)',
  MW: 'var(--wear-mw)',
  FT: 'var(--wear-ft)',
  WW: 'var(--wear-ww)',
  BS: 'var(--wear-bs)',
};

/** Second line of a card: the finish, its Doppler phase, or "Vanilla" for a plain knife. */
export function finishLabel(skin: Pick<SkinCard, 'finishName' | 'phase'>): string {
  const finish = skin.finishName ?? 'Vanilla';
  return skin.phase ? `${finish} · ${skin.phase}` : finish;
}

export const fullName = (skin: Pick<SkinCard, 'weaponName' | 'finishName' | 'phase'>) =>
  `${skin.weaponName} | ${finishLabel(skin)}`;
