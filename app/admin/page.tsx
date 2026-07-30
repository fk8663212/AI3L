import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getAdminClaims } from "@/lib/security/session";
import {
  adminOverview,
  bootstrapDefaults,
} from "@/lib/services/admin-service";
import { listAdminSessions } from "@/lib/services/admin-session-service";

export default async function AdminPage() {
  if (!(await getAdminClaims())) redirect("/admin/login");
  await bootstrapDefaults();
  const [overview, sessions] = await Promise.all([
    adminOverview(),
    listAdminSessions(),
  ]);
  return <AdminDashboard initialData={overview} initialSessions={sessions} />;
}
