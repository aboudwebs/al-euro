"use client";
import { useCallback, useEffect, useState } from "react";
import type { Part } from "./data";

const REFRESH_MS = 30_000;

/**
 * Reads the live catalog from /api/parts (the `parts` table). It refetches every 30 s and whenever the
 * tab becomes visible again, so price / stock edits made in the admin dashboard show up without a reload.
 * On a failed refresh the last good list is kept and `error` is set.
 */
export function useParts() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/parts", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.parts)) {
        setError(data?.error || "تعذر تحميل الكتالوج");
        return;
      }
      setParts(data.parts as Part[]);
      setError("");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { parts, loading, error, reload: load };
}
