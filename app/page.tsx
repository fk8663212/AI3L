import Link from "next/link";
import { Info, Mic, Network, PencilLine, Sparkles } from "lucide-react";
import { StudentStartForm } from "@/components/student/student-start-form";

const STEPS = [
  { label: "手繪情境", icon: PencilLine, tone: "brand" },
  { label: "概念連結", icon: Network, tone: "brand" },
  { label: "AI 擴充", icon: Sparkles, tone: "ai" },
  { label: "獨立口說", icon: Mic, tone: "done" },
] as const;

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-story">
        <div className="landing-brand">
          <span className="brand-mark" aria-hidden="true">A3</span>
          <span>AI3L Speaking Lab</span>
        </div>

        <div className="landing-copy">
          <h1>
            先畫出想法，
            <br />
            再用英語說出來。
          </h1>
          <p>
            從你自己的手繪與經驗出發，一步一步整理概念、擴充詞彙，最後不靠提示，完成屬於你的英語敘事。
          </p>
        </div>

        <ol className="process-line" aria-label="學習流程">
          {STEPS.map(({ label, icon: Icon, tone }) => (
            <li key={label}>
              <span className={`process-icon ${tone}`}>
                <Icon size={22} aria-hidden="true" />
              </span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-access">
        <div className="access-card">
          <h2>開始學習</h2>
          <p>輸入老師給你的學生代碼。不需要姓名或 Email。</p>
          <StudentStartForm />
          <div className="shared-device-note">
            <Info size={18} aria-hidden="true" />
            <span>用的是學校共用電腦嗎？做完記得按右上角的「登出」，下一位同學才不會看到你的作品。</span>
          </div>
          <div className="access-footer">
            <Link href="/admin/login">老師登入</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
