import AdminShell from "@/components/admin/AdminShell";

export const metadata = { title: "لوحة إدارة اليورو" };

// Everything under /admin is protected by middleware.ts (session) and by requireAdmin() in every /api/admin route.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
