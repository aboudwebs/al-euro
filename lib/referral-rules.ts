/** Pure referral rules (no imports, so they can be unit-tested). */

export type ReferralFlag = "self_referral" | "burst" | "shared_address";

/** Pure rules, kept separate from the database calls so they can be unit-tested. */
export function referralFlags(input: {
  newUserPhone: string;
  referrerPhone: string | null;
  signupsLastHour: number;
  signupsSameAddressLastDay: number;
}): ReferralFlag[] {
  const flags: ReferralFlag[] = [];
  const digits = (value: string | null) => (value ?? "").replace(/\D/g, "").replace(/^(963|0)/, "");
  if (digits(input.referrerPhone) && digits(input.referrerPhone) === digits(input.newUserPhone)) flags.push("self_referral");
  if (input.signupsLastHour >= 5) flags.push("burst");
  if (input.signupsSameAddressLastDay >= 3) flags.push("shared_address");
  return flags;
}
