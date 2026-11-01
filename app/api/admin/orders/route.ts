import { requireStaffAccess } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUSES, PAY_METHOD } from "@/lib/status";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 const guard=await requireStaffAccess("orders");if(!guard.ok)return guard.response;
 const url=new URL(req.url),status=url.searchParams.get("status"),pay=url.searchParams.get("pay"),q=cleanSearch(url.searchParams.get("q"));
 let query=getSupabaseAdmin().from("orders").select("id,order_number,user_id,customer_name,customer_phone,user_role,items,total_amount,pay_method,receipt_url,status,status_note,created_at,claimed_by,claimed_at,invoice_currency,invoice_exchange_rate,invoice_total_syp,invoice_cashback_used_syp,invoice_amount_due_syp");
 if(status&&(ORDER_STATUSES as string[]).includes(status))query=query.eq("status",status);
 if(pay&&(Object.values(PAY_METHOD) as string[]).includes(pay))query=query.eq("pay_method",pay);
 if(q){const parts=[`customer_name.ilike.*${q}*`,`customer_phone.ilike.*${q}*`];if(/^\d{1,9}$/.test(q))parts.push(`order_number.eq.${Number(q)}`);query=query.or(parts.join(","));}
 const {data,error}=await query.order("created_at",{ascending:false}).limit(clampLimit(url.searchParams.get("limit")));
 if(error)return dbFail("orders list",error,"تعذر تحميل الطلبات");
 const rows=data??[],ids=Array.from(new Set(rows.map(o=>o.claimed_by).filter((v):v is string=>!!v)));
 const workersResult=ids.length?await getSupabaseAdmin().from("users").select("id,name,phone").in("id",ids):{data:[],error:null};
 if(workersResult.error)return dbFail("order assignees",workersResult.error,"تعذر تحميل بيانات الموظفين");
 const byId=new Map((workersResult.data??[]).map(w=>[w.id,w]));
 return ok({orders:rows.map(({receipt_url,...o})=>({...o,has_receipt:!!receipt_url,claimed_worker:o.claimed_by?byId.get(o.claimed_by)??null:null,can_claim:guard.admin.role==="worker"&&o.status==="pending"&&!o.claimed_by,can_update:guard.admin.role==="admin"||o.claimed_by===guard.admin.id}))});
}