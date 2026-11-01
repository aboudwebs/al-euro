import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: { id: string } }) {
 const guard = await requireAdmin(); if (!guard.ok) return guard.response;
 if (!isUuid(params.id)) return fail("معرّف الموظف غير صالح");
 const db = getSupabaseAdmin();
 const { data: worker, error: we } = await db.from("users").select("id,name,phone,is_active,created_at").eq("id",params.id).eq("role","worker").maybeSingle();
 if (we) return dbFail("worker identity",we,"تعذر تحميل الموظف");
 if (!worker) return fail("الموظف غير موجود",404);
 const [{data:orders,error:oe},{data:movements,error:me}] = await Promise.all([
  db.from("orders").select("id,order_number,status,items,total_amount,created_at,claimed_at").eq("claimed_by",params.id).order("created_at",{ascending:true}),
  db.from("inventory_movements").select("id,part_id,movement_type,quantity_before,quantity_after,quantity_delta,note,created_at").eq("actor_id",params.id).order("created_at",{ascending:true})
 ]);
 if (oe) return dbFail("worker orders",oe,"تعذر تحميل سجل الطلبات");
 if (me) return dbFail("worker inventory",me,"تعذر تحميل سجل المخزون");
 const partIds=Array.from(new Set((movements??[]).map(m=>m.part_id)));
 const {data:parts,error:pe}=partIds.length?await db.from("parts").select("id,name,brand,oem_number").in("id",partIds):{data:[],error:null};
 if (pe) return dbFail("worker parts",pe,"تعذر تحميل أسماء القطع");
 const partMap=new Map((parts??[]).map(p=>[p.id,p]));
 const inventory=(movements??[]).map(m=>({...m,part:partMap.get(m.part_id)??null}));
 const totals=new Map<string,{part_id:string;name:string;brand:string;total_added:number;operations:number}>();
 for(const m of inventory){if(m.quantity_delta<=0)continue;const p=m.part??{name:"قطعة غير متاحة",brand:""};const v=totals.get(m.part_id)??{part_id:m.part_id,name:p.name,brand:p.brand,total_added:0,operations:0};v.total_added+=m.quantity_delta;v.operations++;totals.set(m.part_id,v);}
 const sortedOrders=(orders??[]).map((o,i)=>({...o,employee_sequence:i+1}));
 return ok({worker,orders:sortedOrders,inventory,inventory_totals:Array.from(totals.values()).sort((a,b)=>b.total_added-a.total_added),stats:{orders_count:sortedOrders.length,inventory_operations:inventory.length,units_added:inventory.reduce((s,m)=>s+Math.max(0,m.quantity_delta),0)}});
}