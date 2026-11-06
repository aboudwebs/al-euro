import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parsePart } from "@/lib/admin-parts";
export const dynamic="force-dynamic";
const SAFE_ID=/^[A-Za-z0-9_-]{1,64}$/;
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  const { id } = await params;
 const guard=await requireStaffAccess("parts");if(!guard.ok)return guard.response;
 if(!SAFE_ID.test(id))return fail("معرّف القطعة غير صالح");
 const body=await readJson(req);if(!body)return fail("بيانات غير صالحة");
 const parsed=parsePart(body,true);if(!parsed.ok)return fail(parsed.error);
 if(!Object.keys(parsed.value).length)return fail("لا توجد تغييرات للحفظ");
 const {data,error}=await getSupabaseAdmin().rpc("admin_update_part_with_audit",{p_part_id:id,p_patch:parsed.value,p_actor_id:guard.admin.id});
 if(error)return dbFail("parts update audit rpc",error,"تعذر حفظ القطعة وتسجيل حركة المخزون");
 if(!data)return fail("القطعة غير موجودة",404);
 return ok({part:data});
}
export async function DELETE(_req:Request,{params}:{params:Promise<{id:string}>}){
  const { id } = await params;
 const guard=await requireStaffAccess("parts");if(!guard.ok)return guard.response;
 if(!SAFE_ID.test(id))return fail("معرّف القطعة غير صالح");
 const {data,error}=await getSupabaseAdmin().from("parts").update({is_active:false}).eq("id",id).select("id").maybeSingle();
 if(error)return dbFail("parts archive",error,"تعذر حذف القطعة من الكتالوج");
 if(!data)return fail("القطعة غير موجودة",404);
 return ok({archived:true});
}