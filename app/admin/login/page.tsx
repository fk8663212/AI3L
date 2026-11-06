import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { getAdminClaims } from "@/lib/security/session";

export default async function AdminLoginPage() {
  if (await getAdminClaims()) redirect("/admin");
  return (
    <main className="landing-access">
      <div className="access-card">
        <p className="eyebrow">Secure administration</p>
        <h2>研究管理後台</h2>
        <p>設定 AI 供應商、研究任務、學生代碼與錄音儲存。</p>
        <AdminLoginForm />
      </div>
    </main>
  );
}
