import { randomBytes, randomInt } from 'node:crypto';

/** Every draw of the game goes through this interface; tests inject a scripted one. */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform float in [0, 1) with 53 bits of precision. */
  unit(): number;
}

export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
  unit: () => {
    const bytes = randomBytes(8);
    const high = bytes.readUInt32BE(0) >>> 5; // 27 bits
    const low = bytes.readUInt32BE(4) >>> 6; // 26 bits
    return (high * 67108864 + low) / 9007199254740992; // / 2^53
  },
};
