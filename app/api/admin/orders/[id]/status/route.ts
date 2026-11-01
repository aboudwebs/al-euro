import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/push";
import { ORDER_STATUS, ORDER_STATUSES } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffAccess("orders");
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  const status = body?.status;
  if (typeof status !== "string" || !(ORDER_STATUSES as string[]).includes(status) || status === ORDER_STATUS.pending) {
    return fail("الحالة المطلوبة غير صالحة");
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (guard.admin.role === "worker" && status === ORDER_STATUS.cancelled) {
    return fail("لا تملك صلاحية إلغاء الطلبات", 403);
  }
  if (status === ORDER_STATUS.cancelled && note.length < 3) {
    return fail("يرجى كتابة سبب الإلغاء/الرفض ليظهر للعميل");
  }

  const db = getSupabaseAdmin();
  const { data: order, error: orderReadError } = await db.from("orders")
    .select("id,user_id,user_role,pay_method")
    .eq("id", params.id)
    .maybeSingle();
  if (orderReadError) return dbFail("order notification lookup", orderReadError, "تعذر قراءة الطلب");

  const loyaltyBeforeResult = order && status === ORDER_STATUS.delivered && order.user_role === "workshop"
    ? await db.from("users").select("tier,cashback_balance").eq("id", order.user_id).maybeSingle()
    : null;
  if (loyaltyBeforeResult?.error) {
    return dbFail("loyalty notification lookup", loyaltyBeforeResult.error, "تعذر قراءة رصيد الولاء");
  }
  const loyaltyBefore = loyaltyBeforeResult?.data ?? null;

  const { data, error } = await db.rpc("admin_set_order_status_for_staff", {
    p_order_id: params.id,
    p_new_status: status,
    p_note: note || null,
    p_actor_id: guard.admin.id,
  });
  if (error) return dbFail("order status rpc", error, "تعذر تحديث حالة الطلب");

  if (order) {
    const messages: Record<string, { type: string; title: string; body: string }> = {
      approved: { type: "order_update", title: "تحديث الطلب", body: "تم تحديث حالة طلبك" },
      shipped: { type: "order_ready", title: "الطلب جاهز", body: "طلبك أصبح جاهزاً للاستلام" },
      delivered: { type: "order_delivered", title: "تم تسليم الطلب", body: "تم تسليم طلبك بنجاح" },
      cancelled: {
        type: "order_update",
        title: "تحديث الطلب",
        body: note ? `تم إلغاء الطلب: ${note}` : "تم إلغاء طلبك",
      },
    };
    const message = messages[status];
    if (message) {
      await notifyUser({
        userId: String(order.user_id),
        ...message,
        orderId: String(order.id),
        eventKey: `order:${order.id}:status:${status}`,
        data: { screen: "orders", orderId: String(order.id) },
      });
    }

    if (status === "approved" && order.pay_method === "debt" && order.user_role === "workshop") {
      await notifyUser({
        userId: String(order.user_id),
        type: "debt_entry",
        title: "دفتر الديون",
        body: "تم تسجيل حركة جديدة في حسابك",
        orderId: String(order.id),
        eventKey: `debt:order:${order.id}:debit`,
        data: { screen: "dashboard", orderId: String(order.id) },
      });
    }

    if (status === "delivered" && order.user_role === "workshop") {
      const { data: workshopAfter, error: workshopAfterError } = await db.from("users")
        .select("tier,cashback_balance")
        .eq("id", order.user_id)
        .maybeSingle();
      if (workshopAfterError) {
        console.error("[api/admin/orders/status] loyalty refresh:", workshopAfterError);
      } else if (workshopAfter) {
        if (workshopAfter.tier && workshopAfter.tier !== loyaltyBefore?.tier) {
          await notifyUser({
            userId: String(order.user_id),
            type: "discount_upgrade",
            title: "ترقية فئة الخصم",
            body: `تمت ترقيتك إلى فئة ${workshopAfter.tier}`,
            orderId: String(order.id),
            eventKey: `loyalty:order:${order.id}:tier:${workshopAfter.tier}`,
            data: { screen: "dashboard", orderId: String(order.id) },
          });
        }

        const cashbackAdded = Number(workshopAfter.cashback_balance ?? 0) - Number(loyaltyBefore?.cashback_balance ?? 0);
        if (cashbackAdded > 0) {
          await notifyUser({
            userId: String(order.user_id),
            type: "loyalty_reward",
            title: "مكافأة الولاء",
            body: `تمت إضافة مكافأة بقيمة ${cashbackAdded.toFixed(2)}$ إلى رصيدك`,
            orderId: String(order.id),
            eventKey: `loyalty:order:${order.id}:cashback`,
            data: { screen: "dashboard", orderId: String(order.id) },
          });
        }
      }
    }

    if (status === "delivered") {
      const { data: commission, error: commissionError } = await db.from("marketer_commissions")
        .select("id,marketer_id,commission_amount")
        .eq("order_id", order.id)
        .maybeSingle();
      if (commissionError) {
        console.error("[api/admin/orders/status] commission lookup:", commissionError);
      } else if (commission) {
        await notifyUser({
          userId: String(commission.marketer_id),
          type: "commission_new",
          title: "عمولة جديدة",
          body: `تمت إضافة عمولة جديدة بقيمة ${Number(commission.commission_amount).toFixed(2)}$`,
          orderId: String(order.id),
          eventKey: `commission:${commission.id}:created`,
          data: { screen: "dashboard", orderId: String(order.id) },
        });
      }
    }
  }

  return ok({ result: data });
}
