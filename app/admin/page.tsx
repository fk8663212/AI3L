import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getAdminClaims } from "@/lib/security/session";
import {
  adminOverview,
  bootstrapDefaults,
} from "@/lib/services/admin-service";

export default async function AdminPage() {
  if (!(await getAdminClaims())) redirect("/admin/login");
  await bootstrapDefaults();
  const overview = await adminOverview();
  return <AdminDashboard initialData={overview} />;
}
