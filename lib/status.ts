// Values written to the text status columns. They mirror the LIVE database CHECK constraints exactly:
//   orders_status_check                 pending | approved | shipped | delivered | cancelled
//   orders_pay_method_check             sham | cod | debt
//   special_requests_status_check       new | priced | ordered | completed | cancelled
//   debt_ledger_tx_type_check           debit | payment
//   marketer_commissions_status_check   held | available | paid
//   users_role_check                    workshop | marketer | admin
//   users_tier_check                    Bronze | Silver | Gold
// Keep them in this one file; supabase/admin_full_setup.sql re-creates the same constraints.

export const ORDER_STATUS = {
  pending: "pending",
  approved: "approved",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export const ORDER_STATUSES = Object.values(ORDER_STATUS) as OrderStatus[];

/** Allowed one-click transitions for admins (delivered / cancelled are final). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["approved", "cancelled"],
  approved: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const PAY_METHOD = { sham: "sham", cod: "cod", debt: "debt" } as const;
export type PayMethod = (typeof PAY_METHOD)[keyof typeof PAY_METHOD];

export const SPECIAL_STATUS = {
  new: "new",
  priced: "priced",
  ordered: "ordered",
  completed: "completed",
  cancelled: "cancelled",
} as const;
export type SpecialStatus = (typeof SPECIAL_STATUS)[keyof typeof SPECIAL_STATUS];
export const SPECIAL_STATUSES = Object.values(SPECIAL_STATUS) as SpecialStatus[];

export const SPECIAL_TRANSITIONS: Record<SpecialStatus, SpecialStatus[]> = {
  new: ["priced", "cancelled"],
  priced: ["ordered", "cancelled"],
  ordered: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const COMMISSION_STATUS = { held: "held", available: "available", paid: "paid" } as const;
export type CommissionStatus = (typeof COMMISSION_STATUS)[keyof typeof COMMISSION_STATUS];

export const LEDGER_TX = { debit: "debit", payment: "payment" } as const;
export type LedgerTx = (typeof LEDGER_TX)[keyof typeof LEDGER_TX];

export const TIER = { Bronze: "Bronze", Silver: "Silver", Gold: "Gold" } as const;
export type Tier = (typeof TIER)[keyof typeof TIER];
export const TIERS_LIST = Object.values(TIER) as Tier[];

export const COMMISSION_RATE = 0.02;
export const LOW_STOCK_THRESHOLD = 5;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "قيد المراجعة",
  approved: "تمت الموافقة",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  sham: "شام كاش",
  cod: "كاش عند الاستلام",
  debt: "دفتر الدين",
};

export const SPECIAL_STATUS_LABEL: Record<SpecialStatus, string> = {
  new: "جديد",
  priced: "تم التسعير",
  ordered: "تم الطلب",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  held: "معلّقة",
  available: "مستحقة",
  paid: "مدفوعة",
};

export const LEDGER_TX_LABEL: Record<LedgerTx, string> = {
  debit: "قيد دين",
  payment: "تسديد",
};

export const TIER_LABEL: Record<Tier, string> = {
  Bronze: "برونزية",
  Silver: "فضية",
  Gold: "ذهبية",
};

export const ROLE_LABEL = { workshop: "ورشة", marketer: "مسوّق", admin: "إدارة" } as const;

// Admin reply to a special request is stored inside special_requests.notes (no extra column) after this marker.
export const ADMIN_NOTE_MARKER = "[ملاحظة الإدارة]";
export function splitRequestNotes(notes: string | null | undefined): { customer: string; admin: string } {
  const text = notes ?? "";
  const i = text.indexOf(ADMIN_NOTE_MARKER);
  if (i === -1) return { customer: text.trim(), admin: "" };
  return { customer: text.slice(0, i).trim(), admin: text.slice(i + ADMIN_NOTE_MARKER.length).trim() };
}
export function joinRequestNotes(customer: string, admin: string): string | null {
  const c = customer.trim();
  const a = admin.trim();
  const out = a ? `${c}${c ? "\n\n" : ""}${ADMIN_NOTE_MARKER} ${a}` : c;
  return out || null;
}
