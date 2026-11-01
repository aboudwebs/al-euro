import { requireStaffAccess } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";
import { parsePart } from "@/lib/admin-parts";
export const dynamic="force-dynamic";
const FIELDS="id,name,brand,model,years,oem_number,alt_grade,price,stock,branch,image_url,is_active,created_at,category";
export async function GET(req:Request){
 const guard=await requireStaffAccess("parts");if(!guard.ok)return guard.response;
 const url=new URL(req.url),q=cleanSearch(url.searchParams.get("q")),branch=url.searchParams.get("branch"),active=url.searchParams.get("active");
 const run=(fields:string)=>{let query=getSupabaseAdmin().from("parts").select(fields);if(q)query=query.or(`name.ilike.*${q}*,brand.ilike.*${q}*,oem_number.ilike.*${q}*,model.ilike.*${q}*`);if(branch)query=query.eq("branch",branch);if(active==="1")query=query.eq("is_active",true);if(active==="0")query=query.eq("is_active",false);if(url.searchParams.get("low")==="1")query=query.lte("stock",5);return query.order("name",{ascending:true}).limit(clampLimit(url.searchParams.get("limit"),500,1000));};
 let {data,error}=await run(FIELDS);if(error?.code==="42703")({data,error}=await run(FIELDS.replace(",category","")));
 if(error)return dbFail("parts list",error,"تعذر تحميل القطع");
 const {data:all}=await getSupabaseAdmin().from("parts").select("branch").limit(5000);
 const branches=Array.from(new Set((all??[]).map(p=>(p.branch??"").trim()).filter(Boolean))).sort();
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const categories=Array.from(new Set(((data??[]) as any[]).map(p=>typeof p.category==="string"?p.category.trim():"").filter(Boolean))).sort();
 return ok({parts:data??[],branches,categories});
}
export async function POST(req:Request){
 const guard=await requireStaffAccess("parts");if(!guard.ok)return guard.response;
 const body=await readJson(req);if(!body)return fail("بيانات غير صالحة");
 const parsed=parsePart(body,false);if(!parsed.ok)return fail(parsed.error);
 const id=`P${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
 const {data,error}=await getSupabaseAdmin().rpc("admin_create_part_with_audit",{p_part:{model:"",years:"",alt_grade:null,image_url:null,is_active:true,...parsed.value,id},p_actor_id:guard.admin.id});
 if(error)return dbFail("parts create audit rpc",error,"تعذر إضافة القطعة وتسجيل حركة المخزون");
 return ok({part:data},201);
}