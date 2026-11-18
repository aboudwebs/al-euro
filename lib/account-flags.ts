/** Pure helpers for the signed-in account endpoints (no imports, so they can be unit-tested). */

export type FlagRow = {
  phone?: string | null;
  password_hash?: string | null;
  phone_verification_required?: boolean | null;
};

/**
 * The two facts the app needs to choose its buttons. The password hash itself never leaves the server.
 *  - has_password:   false for an account created with e-mail (it has no password until the owner adds one)
 *  - phone_verified: the account has a phone number that is not waiting for SMS verification
 */
export function accountFlags(row: FlagRow): { has_password: boolean; phone_verified: boolean } {
  return {
    has_password: typeof row.password_hash === "string" && row.password_hash.length > 0,
    phone_verified: typeof row.phone === "string" && row.phone.trim().length > 0 && row.phone_verification_required !== true,
  };
}

/** Account endpoints serve workshops and marketers by default; customer access must be explicitly opted in per route. */
export function accountRoleAllowed(role: unknown, options: { allowAdmin?: boolean; allowCustomer?: boolean } = {}): boolean {
  return role === "workshop" || role === "marketer"
    || (options.allowCustomer === true && role === "customer")
    || (options.allowAdmin === true && role === "admin");
}
