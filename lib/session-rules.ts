/** Pure revocation rule (no imports, so it can be unit-tested): does a token still match its account? */
export type AccountState = { version: number; active: boolean };

/** A token without `v` (issued before revocation existed) counts as version 0. */
export function tokenMatchesAccount(tokenVersion: number | undefined, state: AccountState | null): boolean {
  if (!state || !state.active) return false;
  return (tokenVersion ?? 0) === state.version;
}
