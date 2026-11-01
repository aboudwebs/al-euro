import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
export const dynamic="force-dynamic";
export async function POST(_req:Request,{params}:{params:{id:string}}){
 const guard=await requireStaffAccess("orders"); if(!guard.ok)return guard.response;
 if(guard.admin.role!=="worker")return fail("استلام الطلبات مخصص لحسابات الموظفين",403);
 if(!isUuid(params.id))return fail("معرّف الطلب غير صالح");
 const {data,error}=await getSupabaseAdmin().rpc("claim_order_for_worker",{p_order_id:params.id,p_actor_id:guard.admin.id});
 if(error)return dbFail("claim order",error,"تعذر استلام الطلب");
 return ok({result:data});
}