"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Pause, Plus, Trash2, UserCog } from "lucide-react";
import { api, Badge, Empty, ErrorBox, Modal, PageHead, Spinner, toast, useApi } from "@/components/admin/kit";

type Worker = { id: string; name: string; phone: string; is_active: boolean; created_at: string };

export default function WorkersPage() {
  const { data, error, loading, reload } = useApi<{ workers: Worker[] }>("/api/admin/workers");
  const [name, setName] = useState("");
    const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);\n  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);\n  const [deleting, setDeleting] = useState(false);
  const workers = data?.workers ?? [];

  async function createWorker(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await api("/api/admin/workers", { method: "POST", body: { name, password } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    setName("");
    setPassword("");
    toast("تم إنشاء حساب الموظف");
    reload();
  }

  async function toggle(worker: Worker) {
    const r = await api(`/api/admin/workers/${worker.id}`, {
      method: "PATCH",
      body: { is_active: !worker.is_active },
    });
    if (!r.ok) return toast(r.error, "err");
    toast(worker.is_active ? "تم إيقاف حساب الموظف" : "تم تفعيل حساب الموظف");
    reload();
  }

  return (
    <>
      <PageHead title="حسابات الموظفين" sub="إنشاء حسابات بصلاحيات محدودة وإيقافها عند الحاجة">
        <Badge tone="info"><UserCog size={13} /> صلاحيات محدودة</Badge>
      </PageHead>

      <form onSubmit={createWorker} className="card mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs text-white/65">
          اسم الموظف
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="الاسم الكامل" />
        </label>
        <label className="space-y-1 text-xs text-white/65">
          معرّف الموظف
          <div className="inp flex items-center text-white/55" dir="rtl">يُولّد تلقائياً عند إنشاء الحساب</div>
        </label>
        <label className="space-y-1 text-xs text-white/65">
          كلمة المرور
          <input className="inp" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required placeholder="8 أحرف على الأقل" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn w-full" disabled={busy}><Plus size={16} />{busy ? "جارٍ الإنشاء..." : "إنشاء حساب موظف"}</button>
        </div>
        <p className="text-xs text-white/45 sm:col-span-2 lg:col-span-4">الموظف يستطيع إدارة الطلبات والكتالوج فقط. لا يمكنه الوصول إلى بقية أقسام الإدارة.</p>
      </form>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !workers.length && <Empty>لا توجد حسابات موظفين حتى الآن.</Empty>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workers.map((worker) => (
          <article key={worker.id} className="card flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-white">{worker.name}</h3>
              <p className="mt-1 text-sm text-white/60" dir="ltr" style={{ textAlign: "right" }}>ID: {worker.phone}</p>
              <div className="mt-2"><Badge tone={worker.is_active ? "ok" : "warn"}>{worker.is_active ? "نشط" : "موقوف"}</Badge></div>
            </div>
            <div className="flex flex-col gap-2"><Link href={"/admin/workers/" + worker.id} className="btn2">عرض التفاصيل</Link><button type="button" className={worker.is_active ? "btn2 !text-[#FF6961]" : "btn"} onClick={() => toggle(worker)}>
              {worker.is_active ? <><Pause size={15} />إيقاف</> : <><Check size={15} />تفعيل</>}
            </button></div>
          </article>
        ))}
      </div>
    </>
  );
}
