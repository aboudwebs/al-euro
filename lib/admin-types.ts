import type { CommissionStatus, LedgerTx, OrderStatus, PayMethod, SpecialStatus, Tier } from "./status";

export type OrderItem = {
  part_id?: string;
  name: string;
  brand?: string | null;
  oem_number?: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type AdminOrder = {
  id: string;
  order_number: number | null;
  user_id: string;
  customer_name: string;
  customer_phone: string;
  user_role: "workshop" | "marketer";
  items: OrderItem[] | null;
  total_amount: number;
  pay_method: PayMethod;
  status: OrderStatus;
  status_note: string | null;
  created_at: string;
  has_receipt?: boolean;
  receipt_signed_url?: string | null;
  /** Both only exist once supabase/updates_2026_10.sql has been run. */
  tracking_number?: string | null;
  delivery_address?: DeliveryAddress | null;
};

export type DeliveryAddress = {
  label?: string | null;
  governorate?: string | null;
  area?: string | null;
  street?: string | null;
  details?: string | null;
  phone?: string | null;
};

export type AccountInfo = {
  id: string;
  name: string;
  phone: string;
  role: "workshop" | "marketer" | "admin";
  city: string | null;
  license: string | null;
  tier: Tier | null;
  debt_limit?: number | null;
  debt_balance?: number | null;
  referred_by_code?: string | null;
};

export type AdminAccount = AccountInfo & {
  specs: string[] | null;
  cashback_balance: number | null;
  my_ref_code: string | null;
  referred_by_name: string | null;
  is_active: boolean;
  created_at: string;
};

export type LedgerEntry = {
  id: string;
  workshop_id: string;
  workshop_name?: string | null;
  order_id: string | null;
  order_number?: number | null;
  tx_type: LedgerTx;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

export type Workshop = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  tier: Tier | null;
  debt_limit: number | null;
  debt_balance: number | null;
  is_active: boolean;
};

export type AdminRequest = {
  id: string;
  user_id: string | null;
  customer_name: string;
  customer_phone: string;
  brand: string;
  other_brand: string | null;
  part_name: string;
  vin_or_oem: string | null;
  customer_notes: string;
  admin_note: string;
  image_signed_url: string | null;
  quoted_price: number | null;
  status: SpecialStatus;
  created_at: string;
};

export type AdminPart = {
  id: string;
  name: string;
  brand: string;
  model: string | null;
  years: string | null;
  oem_number: string;
  alt_grade: string | null;
  price: number;
  stock: number;
  branch: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  /** Catalogue section; only present once supabase/updates_2026_10.sql has been run. */
  category?: string | null;
};

export type AdminCommission = {
  id: string;
  marketer_id: string;
  workshop_id: string;
  order_id: string;
  order_number: number | null;
  marketer_name: string;
  workshop_name: string;
  order_amount: number;
  commission_amount: number;
  status: CommissionStatus;
  created_at: string;
};

export type Overview = {
  revenue_total: number;
  revenue_30d: number;
  pending_orders: number;
  pending_sham: number;
  pending_activations: number;
  total_debt: number;
  new_requests: number;
  available_commissions: number;
  held_commissions: number;
  low_stock_threshold: number;
  branches: { branch: string; parts_count: number; total_stock: number; stock_value: number; low_count: number }[];
  low_stock: { id: string; name: string; brand: string; branch: string; stock: number }[];
};
