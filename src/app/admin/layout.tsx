import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // In demo mode, allow access
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

  if (authEnabled) {
    const session = await getSession();
    if (!session.isLoggedIn || session.role !== "admin") {
      redirect("/");
    }
  }

  return <AdminShell>{children}</AdminShell>;
}
