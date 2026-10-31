"use client";
import React, { useEffect, useState } from "react";
import { Wrench, Share2, CheckCircle2, Clock, LogIn, UserPlus, ShieldCheck, ChevronDown } from "lucide-react";

const SYRIAN_CITIES = [
  "دمشق",
  "ريف دمشق",
  "حلب",
  "حمص",
  "حماة",
  "اللاذقية",
  "طرطوس",
  "إدلب",
  "دير الزور",
  "الرقة",
  "الحسكة",
  "درعا",
  "السويداء",
  "القنيطرة",
];

const AVAILABLE_BRANDS = [
  "Mercedes-Benz",
  "BMW",
  "Audi",
  "Volkswagen",
  "Range Rover",
  "Porsche",
  "أخرى",
];

export default function LoginPage() {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"workshop" | "marketer">("workshop");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [license, setLicense] = useState("");
  const [city, setCity] = useState("حلب");
  const [isCityOpen, setIsCityOpen] = useState(false); // تحكم بفتح وإغلاق قائمة المحافظات المخصصة
  const [selectedBrands, setSelectedBrands] = useState<string[]>(["Mercedes-Benz"]);
  const [otherBrandText, setOtherBrandText] = useState("");
  const [refCode, setRefCode] = useState("");
  const [refSignature, setRefSignature] = useState("");
  const [refLocked, setRefLocked] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedBy = params.get("ref");
    const signature = params.get("sig");
    if (invitedBy?.trim() && signature?.trim()) {
      setRefCode(invitedBy.trim().slice(0, 80));
      setRefSignature(signature.trim());
      setRefLocked(true);
      setAuthMode("register");
      setRole("workshop");
    }
  }, []);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [pendingNotice, setPendingNotice] = useState("");

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setMsg("");
    setPendingNotice("");

    let finalSpecs = "";
    if (authMode === "register" && role === "workshop") {
      if (selectedBrands.length === 0) {
        setErrorMsg("يرجى اختيار ماركة واحدة على الأقل لاختصاص الورشة");
        return;
      }
      if (selectedBrands.includes("أخرى") && !otherBrandText.trim()) {
        setErrorMsg("يرجى كتابة اسم الماركة الإضافية في حقل (أخرى)");
        return;
      }
      finalSpecs = selectedBrands
        .map((b) => (b === "أخرى" ? "أخرى (" + otherBrandText.trim() + ")" : b))
        .join(", ");
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: authMode,
          role,
          name,
          phone,
          password,
          license,
          city,
          spec: finalSpecs,
          refCode,
          refSignature: refLocked ? refSignature : "",
        }),
      });
      const data = await res.json();

      if (data.pendingApproval) {
        setPendingNotice(
          data.message ||
            data.error ||
            "تم إرسال طلب تسجيل الورشة/الشركة للإدارة بنجاح! سيتم مراجعة الترخيص وتفعيل حسابك قريباً."
        );
        return;
      }

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "تعذر إتمام العملية");
        return;
      }

      setMsg("تم بنجاح! جاري تحويلك...");

      // بعد نجاح الدخول أو إنشاء الحساب، افتح الكتالوج.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && /^\/(?!\/)/.test(next) && !next.startsWith("/login") ? next : "/";
    } catch {
      setErrorMsg("خطأ في الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 14px 100px" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 4 }}>
          حسابي — اليورو
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          إدارة حسابك والوصول للخدمات الخاصة
        </p>
      </div>

      {/* التبديل الرئيسي */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          background: "var(--glass-2)",
          padding: 4,
          borderRadius: 14,
          border: "1px solid var(--line)",
          marginBottom: 18,
          backdropFilter: "blur(10px)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            setAuthMode("login");
            setErrorMsg("");
            setPendingNotice("");
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "10px 14px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 13.5,
            cursor: "pointer",
            border: "none",
            background: authMode === "login" ? "rgba(59, 130, 246, 0.25)" : "transparent",
            color: authMode === "login" ? "var(--accent-text)" : "var(--muted)",
            transition: "all 0.2s ease",
          }}
        >
          <LogIn size={16} />
          تسجيل الدخول
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode("register");
            setErrorMsg("");
            setPendingNotice("");
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "10px 14px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 13.5,
            cursor: "pointer",
            border: "none",
            background: authMode === "register" ? "rgba(59, 130, 246, 0.25)" : "transparent",
            color: authMode === "register" ? "var(--accent-text)" : "var(--muted)",
            transition: "all 0.2s ease",
          }}
        >
          <UserPlus size={16} />
          إنشاء حساب
        </button>
      </div>

      {/* شاشة النجاح الخاصة بانتظار موافقة الورشة (تخفي النموذج تماماً وتعرض التنبيه الفخم) */}
      {pendingNotice ? (
        <div
          style={{
            padding: 30,
            borderRadius: 20,
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            textAlign: "center",
            backdropFilter: "blur(12px)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            style={{
              width: 70,
              height: 70,
              borderRadius: "50%",
              background: "rgba(245, 158, 11, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Clock size={36} style={{ color: "var(--warn-text)" }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: "var(--warn-text)", marginBottom: 10 }}>
            تم إرسال طلبك للمراجعة بنجاح!
          </h2>
          <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, maxWidth: 420, margin: "0 auto 20px" }}>
            {pendingNotice}
          </p>
          <button
            type="button"
            onClick={() => {
              setPendingNotice("");
              setAuthMode("login");
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              background: "var(--glass-2)",
              color: "var(--text)",
              border: "1px solid var(--line)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            العودة لتسجيل الدخول
          </button>
        </div>
      ) : (
        <>
          {/* اختيار نوع الحساب (متاح في الدخول وفي إنشاء الحساب) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <button
              type="button"
              onClick={() => setRole("workshop")}
              style={{
                padding: "12px 10px",
                borderRadius: 14,
                cursor: "pointer",
                border:
                  role === "workshop"
                    ? "1.5px solid #3b82f6"
                    : "1px solid var(--line)",
                background:
                  role === "workshop" ? "rgba(59, 130, 246, 0.15)" : "var(--glass-1)",
                color: "var(--text)",
                textAlign: "center",
                transition: "0.2s",
              }}
            >
              <Wrench size={18} style={{ margin: "0 auto 4px", color: "var(--accent-text)" }} />
              <div style={{ fontWeight: 700, fontSize: 13 }}>حساب ورشة / شركة</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                {authMode === "login" ? "تسجيل دخول الورش" : "يتطلب موافقة الإدارة"}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRole("marketer")}
              style={{
                padding: "12px 10px",
                borderRadius: 14,
                cursor: "pointer",
                border:
                  role === "marketer"
                    ? "1.5px solid #f59e0b"
                    : "1px solid var(--line)",
                background:
                  role === "marketer" ? "rgba(245, 158, 11, 0.15)" : "var(--glass-1)",
                color: "var(--text)",
                textAlign: "center",
                transition: "0.2s",
              }}
            >
              <Share2 size={18} style={{ margin: "0 auto 4px", color: "var(--warn-text)" }} />
              <div style={{ fontWeight: 700, fontSize: 13 }}>حساب عميل / مسوّق</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                {authMode === "login" ? "تسجيل دخول المسوقين" : "تفعيل فوري"}
              </div>
            </button>
          </div>

          {/* نموذج الإدخال الأساسي */}
          <form
            onSubmit={handleSubmit}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              padding: 18,
              display: "grid",
              gap: 12,
              backdropFilter: "blur(12px)",
            }}
          >
            <div style={{ paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
              <h2 style={{ fontSize: 16, fontWeight: 800 }}>
                {authMode === "login"
                  ? role === "workshop"
                    ? "تسجيل دخول ورشة / شركة"
                    : "تسجيل دخول عميل / مسوّق"
                  : role === "workshop"
                  ? "بيانات اعتماد الورشة الجديدة"
                  : "بيانات حساب المسوّق الجديد"}
              </h2>
            </div>

            {authMode === "register" && (
              <input
                className="input"
                placeholder={role === "workshop" ? "اسم الورشة أو الشركة الرسمي" : "الاسم الكامل"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ background: "var(--field-bg)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}
              />
            )}

            <input
              className="input"
              type="tel"
              placeholder="رقم الموبايل (09XXXXXXXX)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              style={{ background: "var(--field-bg)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}
            />

            <input
              className="input"
              type="password"
              placeholder="كلمة المرور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ background: "var(--field-bg)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}
            />

            {authMode === "register" && role === "workshop" && (
              <>
                <input
                  className="input"
                  placeholder="رقم السجل التجاري / ترخيص الورشة"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  required
                  style={{ background: "var(--field-bg)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}
                />

                {/* اختيار المحافظة بستايل زجاجي متطابق مع استايل اختيار السيارات */}
                <div style={{ position: "relative" }}>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: "var(--muted)" }}>
                    المحافظة:
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsCityOpen(!isCityOpen)}
                    style={{
                      width: "100%",
                      background: "var(--field-bg)",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      padding: "11px 14px",
                      fontSize: 13,
                      color: "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                  >
                    <span>{city}</span>
                    <ChevronDown size={16} style={{ color: "var(--muted)", transform: isCityOpen ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {/* قائمة المحافظات المنبثقة بشكل فخم */}
                  {isCityOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: 6,
                        background: "var(--menu-bg)",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        padding: 8,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 6,
                        zIndex: 50,
                        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                        backdropFilter: "blur(15px)",
                      }}
                    >
                      {SYRIAN_CITIES.map((c) => {
                        const active = city === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setCity(c);
                              setIsCityOpen(false);
                            }}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              border: active ? "1px solid #3b82f6" : "1px solid var(--line)",
                              background: active ? "rgba(59, 130, 246, 0.25)" : "var(--glass-1)",
                              color: active ? "var(--accent-text)" : "var(--text)",
                              textAlign: "right",
                            }}
                          >
                            {active ? "✓ " : ""} {c}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "var(--field-bg)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 8, color: "var(--muted)" }}>
                    اختصاص الورشة (الماركات):
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {AVAILABLE_BRANDS.map((brand) => {
                      const active = selectedBrands.includes(brand);
                      return (
                        <button
                          key={brand}
                          type="button"
                          onClick={() => toggleBrand(brand)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 8,
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            border: active ? "1px solid #3b82f6" : "1px solid var(--line)",
                            background: active ? "rgba(59, 130, 246, 0.2)" : "transparent",
                            color: active ? "var(--accent-text)" : "var(--muted)",
                          }}
                        >
                          {active ? "✓ " : "+ "} {brand}
                        </button>
                      );
                    })}
                  </div>

                  {selectedBrands.includes("أخرى") && (
                    <input
                      className="input"
                      style={{ marginTop: 8, background: "var(--field-bg)", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      placeholder="اسم الماركة الإضافية..."
                      value={otherBrandText}
                      onChange={(e) => setOtherBrandText(e.target.value)}
                      required
                    />
                  )}
                </div>

                <input
                  className="input"
                  placeholder="كود المسوّق إن وجد (اختياري)"
                  value={refCode}
                  readOnly={refLocked}
                  onChange={(e) => { if (!refLocked) setRefCode(e.target.value); }}
                  aria-readonly={refLocked}
                  title={refLocked ? "كود الإحالة مثبت من رابط المسوّق" : undefined}
                  style={{ background: "var(--field-bg)", borderRadius: 10, padding: "10px 12px", fontSize: 13, opacity: refLocked ? 0.8 : 1, cursor: refLocked ? "not-allowed" : "text" }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    color: "var(--accent-text)",
                    background: "rgba(37, 99, 235, 0.1)",
                    padding: "8px 10px",
                    borderRadius: 8,
                  }}
                >
                  <ShieldCheck size={16} />
                  <span>حسابات الورشات تتطلب مراجعة وموافقة الإدارة قبل التفعيل.</span>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                padding: "12px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
                border: "none",
                background: authMode === "register" && role === "marketer" ? "#f59e0b" : "#2563eb",
                color: "#fff",
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                transition: "0.2s",
              }}
            >
              {loading
                ? "جاري المعالجة..."
                : authMode === "login"
                ? role === "workshop"
                  ? "تسجيل دخول الورشة / الشركة"
                  : "تسجيل دخول المسوّق"
                : role === "workshop"
                ? "إرسال طلب اعتماد الورشة"
                : "إنشاء الحساب فوراً"}
            </button>

            {msg && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(48, 209, 88, 0.12)",
                  color: "var(--ok-text)",
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                {msg}
              </div>
            )}

            {errorMsg && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "var(--err-text)",
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                {errorMsg}
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}
