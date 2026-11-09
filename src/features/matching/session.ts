import type { MatchRecipient } from '../profile/model';

let match: MatchRecipient | null = null;

/** One short-lived recipient selection; contains no biometric template. */
export const matchSession = {
  set(value: MatchRecipient) { this.clear(); match = value; },
  get(id: string): MatchRecipient | undefined {
    if (!match || match.id !== id || match.expiresAt <= Date.now()) { this.clear(); return undefined; }
    return match;
  },
  clear() { match = null; },
};
