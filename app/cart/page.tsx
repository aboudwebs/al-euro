"use client";
import {useState,useEffect} from "react";
import {Banknote,Landmark,BookOpen,Upload,CheckCircle2,Minus,Plus,AlertTriangle} from "lucide-react";
import {usd} from "@/lib/data";
import {useParts} from "@/lib/useParts";
import {useCart} from "@/components/cart";
import {H} from "@/components/ui";

type Role = "workshop" | "marketer";
const PAY = [
  ["sham","شام كاش",Landmark,"حوّل المبلغ وأرفق إشعار التحويل"],
  ["cod","كاش عند الاستلام",Banknote,"ادفع نقدًا للمندوب"],
  ["debt","دفتر الدين (للورشات)",BookOpen,"بعد موافقة الأدمن يبدأ عدّاد 30 يومًا"]
] as const;

export default function Cart(){
  const {items,add,dec,clear}=useCart();
  const {parts,loading:partsLoading}=useParts();
  const [role,setRole]=useState<Role|null>(null);
  const [sessionLoaded,setSessionLoaded]=useState(false);
  const [pay,setPay]=useState<string>("cod");
  const [file,setFile]=useState("");
  const [receipt,setReceipt]=useState<File|null>(null);
  const [debtAvailable,setDebtAvailable]=useState<number|null>(null);
  const [orderNo,setOrderNo]=useState<number|null>(null);
  const [done,setDone]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [err,setErr]=useState("");

  useEffect(()=>{
    let active=true;
    fetch("/api/auth")
      .then(r=>r.json())
      .then(d=>{
        if(!active) return;
        const nextRole: Role|null =
          d?.user?.role==="workshop" || d?.user?.role==="marketer"
            ? d.user.role
            : null;
        setRole(nextRole);
        if(nextRole==="workshop" && d.user.debt_limit!=null){
          setDebtAvailable(Math.max(0,Number(d.user.debt_limit)-Number(d.user.debt_balance||0)));
        }
        if(nextRole!=="workshop") setPay(current=>current==="debt"?"cod":current);
      })
      .catch(()=>{
        if(active){
          setRole(null);
          setPay(current=>current==="debt"?"cod":current);
        }
      })
      .finally(()=>{if(active)setSessionLoaded(true);});
    return ()=>{active=false;};
  },[]);

  const rows=parts.filter(p=>items[p.id]);
  const total=rows.reduce((s,p)=>s+p.price*items[p.id],0);
  const canPayByDebt=sessionLoaded && role==="workshop";
  const paymentOptions=PAY.filter(([key])=>key!=="debt" || canPayByDebt);

  useEffect(()=>{
    if(sessionLoaded && !canPayByDebt && pay==="debt") setPay("cod");
  },[sessionLoaded,canPayByDebt,pay]);

  if(done) return <div className="mx-auto mt-16 max-w-md rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-6 text-center backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300"><CheckCircle2 className="mx-auto mb-3 text-[#30D158]" size={48}/><h2 className="text-xl font-semibold tracking-tight text-white">تم إرسال الطلب</h2>{orderNo!==null&&<p className="mt-1 text-sm text-white/65">رقم الطلب: #{orderNo}</p>}<p className="mt-1 text-sm text-white/65">{done==="debt"?"طلبك بانتظار موافقة الأدمن على الدين.":"سنتواصل معك لتأكيد التوصيل."}</p></div>;

  return(<>
    <H t="السلة وإتمام الطلب" s="توصيل وشحن لكافة المحافظات السورية"/>
    {partsLoading && !rows.length
      ? <p className="text-center text-sm text-white/65">جارٍ تحميل السلة...</p>
      : !rows.length
      ? <p className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 text-center text-white/65 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">السلة فارغة. أضف قطعًا من الكتالوج.</p>
      : <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">
            {rows.map(p=><div key={p.id} className="flex items-center gap-2">
              <div className="flex-1 text-sm"><b className="font-semibold tracking-tight text-white">{p.name}</b><p className="text-xs text-white/45">{p.brand} · {p.pn}</p></div>
              <button onClick={()=>dec(p.id)} className="inline-flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1.5 text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]" aria-label={"تقليل كمية "+p.name}><Minus size={14}/></button>
              <span className="w-5 text-center font-medium text-white">{items[p.id]}</span>
              <button onClick={()=>add(p.id)} className="inline-flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1.5 text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]" aria-label={"زيادة كمية "+p.name}><Plus size={14}/></button>
              <b className="w-16 text-end font-semibold text-white">{usd(p.price*items[p.id])}</b>
            </div>)}
            <p className="border-t border-white/[0.10] pt-3 text-end text-lg font-semibold tracking-tight text-white">{usd(total)}</p>
          </div>

          <div className="space-y-3 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">
            <h3 className="font-semibold tracking-tight text-white">طريقة الدفع</h3>
            {!sessionLoaded && <p className="text-xs text-white/45">جارٍ التحقق من نوع الحساب...</p>}
            <div className="space-y-1.5 rounded-2xl border border-white/[0.08] bg-black/40 p-1.5 backdrop-blur-xl shadow-inner">
              {paymentOptions.map(([key,label,Icon,description])=>(
                <button
                  key={key}
                  onClick={()=>setPay(key)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-start text-sm transition-all ${pay===key?"border-white/[0.22] bg-white/[0.15] text-white backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]":"border-transparent text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
                >
                  <Icon className="shrink-0 text-[#0A84FF]" size={20}/>
                  <span><b className="font-semibold">{label}</b><small className="block text-white/45">{description}</small></span>
                </button>
              ))}
            </div>
            {pay==="sham"&&<label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/[0.16] bg-white/[0.08] px-4 py-2.5 text-sm text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]"><Upload size={16}/>{file||"ارفع إشعار التحويل"}<input type="file" hidden accept="image/*" onChange={e=>{const f=e.target.files?.[0]||null;if(f&&f.size>5*1024*1024){setErr("حجم الصورة يجب ألا يتجاوز 5 ميغابايت");e.target.value="";return;}setErr("");setReceipt(f);setFile(f?.name||"");}}/></label>}
            {pay==="debt"&&canPayByDebt&&<div className="flex gap-2 rounded-2xl border border-[#FF9F0A]/35 bg-[#FF9F0A]/15 p-3 text-xs text-[#FF9F0A]"><AlertTriangle size={18} className="shrink-0"/><p>عدّاد 30 يومًا يبدأ من أول قطعة دين. عند تجاوزه يتوقف السحب الآجل حتى التسديد. الكاش باك والعمولة يُصرفان بعد التسديد.<br/>المتاح من سقفك: <b>{debtAvailable==null?"غير محدد":usd(debtAvailable)}</b></p></div>}
            {err && (
              <p className="rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/20 p-2.5 text-xs text-[#FF6961] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                {err}
              </p>
            )}

            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-4 py-2.5 text-sm font-semibold text-snow shadow-[0_4px_20px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
              disabled={
                !sessionLoaded ||
                submitting ||
                (pay==="sham"&&!receipt) ||
                (pay==="debt"&&!canPayByDebt)
              }
              onClick={async ()=>{
                setErr("");
                if(pay==="debt"&&!canPayByDebt){
                  setPay("cod");
                  return;
                }
                setSubmitting(true);
                try {
                  // Only parts that are still in the live catalog are sent.
                  const fd = new FormData();
                  fd.append("items", JSON.stringify(Object.fromEntries(rows.map(p=>[p.id,items[p.id]]))));
                  fd.append("pay", pay);
                  if (pay==="sham" && receipt) fd.append("receipt", receipt);
                  const res = await fetch("/api/orders", { method: "POST", body: fd });
                  const data = await res.json().catch(()=>null);
                  if (!res.ok || !data?.ok) {
                    setErr(data?.error || "تعذر إتمام الطلب");
                    return;
                  }
                  setOrderNo(typeof data.orderNumber==="number"?data.orderNumber:null);
                  setDone(pay);
                  clear();
                } catch {
                  setErr("حدث خطأ في الاتصال بالخادم");
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "جارٍ تأكيد الطلب..." : `تأكيد الطلب · ${usd(total)}`}
            </button>
            {sessionLoaded && role!=="workshop" && <p className="text-center text-xs text-white/45">الدفع بالدين متاح حصريًا لحسابات الورشات.</p>}
          </div>
        </div>
    }
  </>);
}