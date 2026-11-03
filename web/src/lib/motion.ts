import type { CSSProperties } from 'react';

/**
 * Entrance order of a card in a grid or a row in a list: with the global `stagger` class,
 * item `i` rises 30 ms after the previous one (capped, see animations.css).
 */
export const stagger = (i: number | undefined): CSSProperties | undefined => (i === undefined ? undefined : ({ '--i': i } as CSSProperties));
