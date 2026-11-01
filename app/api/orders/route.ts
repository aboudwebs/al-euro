import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { PAY_METHOD } from "@/lib/status";
import { removeImage, storeImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const MAX_ITEM_QUANTITY = 100;
const MAX_DISTINCT_ITEMS = 50;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RECEIPT_BUCKET = "receipts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = UUID_RE;
const LIST_FIELDS = "id, order_number, total_amount, cashback_used, amount_due, pay_method, status, status_note, created_at, items";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Body: multipart/form-data with
 *   items   JSON string  { "<partId>": quantity }
 *   pay     "sham" | "cod" | "debt"
 *   receipt image file (required for "sham")
 *   addressId optional id of one of the customer's saved addresses (public.user_addresses); a copy of it is stored
 *             with the order so a later edit or deletion of the address does not change old orders
 *
 * Prices, stock and totals come from the database, never from the client. The order is saved with status
 * "pending"; debt orders do NOT touch debt_balance / debt_ledger yet - that happens when an admin approves them.
 */
export async function POST(req: Request) {
  let uploadedPath: string | null = null;
  try {
    let session: ReturnType<typeof getSession>;
    try {
      session = getSession();
    } catch {
      return reply({ error: "إعداد AUTH_SECRET مفقود على الخادم" }, 500);
    }
    if (!session) return reply({ error: "يرجى تسجيل الدخول لإتمام الطلب" }, 401);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return reply({ error: "بيانات الطلب غير صالحة" }, 400);
    }

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!IDEMPOTENCY_RE.test(idempotencyKey)) return reply({ error: "تعذر التحقق من محاولة التأكيد. أعد فتح صفحة السلة" }, 400);

    const cashbackRaw = form.get("cashbackUsed");
    const cashbackUsed = cashbackRaw == null || cashbackRaw === "" ? 0 : Number(cashbackRaw);
    if (!Number.isFinite(cashbackUsed) || cashbackUsed < 0 || cashbackUsed > 1_000_000_000) {
      return reply({ error: "قيمة الكاش باك غير صالحة" }, 400);
    }

    const pay = form.get("pay");
    if (pay !== PAY_METHOD.sham && pay !== PAY_METHOD.cod && pay !== PAY_METHOD.debt) {
      return reply({ error: "طريقة دفع غير صالحة" }, 400);
    }

    let requested: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(form.get("items") ?? ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      requested = parsed as Record<string, unknown>;
    } catch {
      return reply({ error: "السلة فارغة أو غير صالحة" }, 400);
    }

    const ids = Object.keys(requested);
    if (!ids.length || ids.length > MAX_DISTINCT_ITEMS) return reply({ error: "السلة فارغة أو غير صالحة" }, 400);
    for (const id of ids) {
      const qty = requested[id];
      if (!SAFE_ID.test(id) || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
        return reply({ error: "توجد قطعة أو كمية غير صالحة في السلة" }, 400);
      }
    }

    const db = getSupabaseAdmin();

    // The account must still exist and be active (the cookie alone is not enough).
    const { data: user, error: userError } = await db
      .from("users")
      .select("id, role, name, phone, is_active, debt_limit, debt_balance, cashback_balance")
      .eq("id", session.id)
      .maybeSingle();
    if (userError) {
      console.error("[api/orders] user lookup:", userError);
      return reply({ error: "تعذر التحقق من الحساب" }, 500);
    }
    if (!user || !user.is_active) return reply({ error: "الحساب غير مفعّل" }, 403);
    if (user.role !== "workshop" && user.role !== "marketer") {
      return reply({ error: "حسابات الإدارة لا تنشئ طلبات شراء" }, 403);
    }

    const { data: rows, error: partsError } = await db
      .from("parts")
      .select("id, name, brand, oem_number, price, stock")
      .in("id", ids)
      .eq("is_active", true);
    if (partsError) {
      console.error("[api/orders] parts lookup:", partsError);
      return reply({ error: "تعذر التحقق من القطع" }, 500);
    }
    if (!rows || rows.length !== ids.length) {
      return reply({ error: "بعض القطع لم تعد متاحة، حدّث السلة وحاول مجدداً" }, 400);
    }

    const lines = [];
    let total = 0;
    for (const part of rows) {
      const qty = requested[String(part.id)] as number;
      if (Number(part.stock) < qty) return reply({ error: `الكمية المطلوبة من «${part.name}» غير متوفرة حاليًا` }, 400);
      const unit = Number(part.price);
      const lineTotal = Math.round(unit * qty * 100) / 100;
      total += lineTotal;
      lines.push({ part_id: String(part.id), name: part.name, brand: part.brand, oem_number: part.oem_number, qty, unit_price: unit, line_total: lineTotal });
    }
    total = Math.round(total * 100) / 100;
    if (!Number.isFinite(total) || total <= 0) return reply({ error: "قيمة الطلب غير صالحة" }, 400);

    if (cashbackUsed > 0 && user.role !== "workshop") {
      return reply({ error: "استخدام الكاش باك متاح لحسابات الورشات فقط" }, 403);
    }
    if (cashbackUsed > Number(user.cashback_balance ?? 0)) {
      return reply({ error: "رصيد الكاش باك المتاح غير كافٍ، حدّث الرصيد وحاول مجدداً" }, 400);
    }
    if (cashbackUsed > total) return reply({ error: "الكاش باك لا يمكن أن يتجاوز إجمالي الطلب" }, 400);
    const amountDue = Math.round((total - cashbackUsed) * 100) / 100;
    const finalPayMethod = amountDue === 0 ? "cashback" : pay;

    if (pay === PAY_METHOD.debt) {
      if (user.role !== "workshop") {
        return reply({ error: "غير مصرح: الدفع عبر دفتر الدين متاح حصريًا لحسابات الورشات المعتمدة" }, 403);
      }
      const limit = Number(user.debt_limit);
      const available = limit - Number(user.debt_balance);
      if (!(limit > 0)) return reply({ error: "لم يُحدَّد سقف دين لحسابك بعد، تواصل مع الإدارة" }, 400);
      if (amountDue > available) {
        return reply({ error: `قيمة الطلب تتجاوز سقف الدين المتاح (${Math.max(0, available)}$)` }, 400);
      }
    }

    // Optional delivery address: it must belong to the signed-in customer.
    let deliveryAddress: Record<string, string | null> | null = null;
    const addressId = form.get("addressId");
    if (typeof addressId === "string" && addressId.trim()) {
      if (!UUID_RE.test(addressId.trim())) return reply({ error: "عنوان التسليم غير صالح" }, 400);
      const { data: address, error: addressError } = await db
        .from("user_addresses")
        .select("label, governorate, area, street, details, phone")
        .eq("id", addressId.trim())
        .eq("user_id", user.id)
        .maybeSingle();
      if (addressError) {
        console.error("[api/orders] address lookup:", addressError);
        return reply({ error: "تعذر التحقق من عنوان التسليم" }, 500);
      }
      if (!address) return reply({ error: "عنوان التسليم غير موجود، اختر عنواناً آخر" }, 400);
      deliveryAddress = address;
    }

    let receiptPath: string | null = null;
    if (pay === PAY_METHOD.sham && amountDue > 0) {
      const file = form.get("receipt");
      if (!file || typeof file === "string" || (file as Blob).size === 0) {
        return reply({ error: "يرجى إرفاق إشعار تحويل شام كاش" }, 400);
      }
      const stored = await storeImage(RECEIPT_BUCKET, String(user.id), file);
      if (!stored.ok) return reply({ error: stored.error }, stored.status);
      receiptPath = stored.path;
      uploadedPath = stored.path;
    }

    const requestHash = createHash("sha256").update(JSON.stringify({
      items: Object.keys(requested).sort().map((id) => [id, requested[id]]),
      pay: finalPayMethod,
      total,
      cashbackUsed,
      addressId: typeof addressId === "string" ? addressId.trim() : null,
      receipt: receiptPath ? { size: (form.get("receipt") as Blob).size } : null,
    })).digest("hex");

    const { data: result, error: createError } = await db.rpc("create_workshop_order", {
      p_user_id: user.id,
      p_customer_name: user.name,
      p_customer_phone: user.phone,
      p_user_role: user.role,
      p_items: lines,
      p_total_amount: total,
      p_pay_method: finalPayMethod,
      p_receipt_url: receiptPath,
      p_delivery_address: deliveryAddress,
      p_cashback_used: cashbackUsed,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    });

    if (createError || !result) {
      console.error("[api/orders] create RPC:", createError);
      await removeImage(RECEIPT_BUCKET, uploadedPath);
      const message = createError?.message ?? "تعذر حفظ الطلب، حاول مجدداً";
      const safeMessage = message.includes("مفتاح التأكيد") || message.includes("رصيد الكاش باك")
        || message.includes("الكاش باك") || message.includes("سقف الدين")
        ? message
        : "تعذر حفظ الطلب، حاول مجدداً";
      return reply({ error: safeMessage }, 400);
    }

    if (result.created === false && uploadedPath) {
      await removeImage(RECEIPT_BUCKET, uploadedPath);
      uploadedPath = null;
    }
    return reply({
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      pay: result.pay,
      total: result.total,
      cashbackUsed: result.cashbackUsed,
      amountDue: result.amountDue,
      duplicate: result.created === false,
    });
  } catch (err) {
    console.error("[api/orders] POST:", err);
    await removeImage(RECEIPT_BUCKET, uploadedPath);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}

/** The signed-in customer's own orders (status, and the reason when an order was rejected / cancelled). */
export async function GET() {
  try {
    let session: ReturnType<typeof getSession>;
    try {
      session = getSession();
    } catch {
      return reply({ error: "إعداد AUTH_SECRET مفقود على الخادم" }, 500);
    }
    if (!session) return reply({ error: "يرجى تسجيل الدخول" }, 401);

    const db = getSupabaseAdmin();
    const list = (fields: string) =>
      db.from("orders").select(fields).eq("user_id", session.id).order("created_at", { ascending: false }).limit(30);
    // tracking_number / delivery_address come from supabase/updates_2026_10.sql; without it the list still loads.
    let { data, error } = await list(`${LIST_FIELDS}, tracking_number, delivery_address`);
    if (error?.code === "42703") ({ data, error } = await list(LIST_FIELDS));
    if (error) {
      console.error("[api/orders] list:", error);
      return reply({ error: "تعذر تحميل طلباتك" }, 500);
    }
    return reply({ orders: data ?? [] });
  } catch (err) {
    console.error("[api/orders] GET:", err);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
