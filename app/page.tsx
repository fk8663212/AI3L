import Link from "next/link";
import { StudentStartForm } from "@/components/student/student-start-form";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-story">
        <div className="landing-brand">
          <span className="brand-mark">A3</span>
          <span>AI3L Speaking Lab</span>
        </div>

        <div className="landing-copy">
          <p className="eyebrow">Visualize · Connect · Speak</p>
          <h1>先看見想法，再說出英語。</h1>
          <p>
            從自己的手繪與經驗出發，逐步整理概念、擴充詞彙，最後在撤除
            AI 鷹架後完成屬於你的英語敘事。
          </p>
        </div>

        <div className="process-line" aria-label="學習流程">
          <span>手繪情境</span>
          <b>→</b>
          <span>概念連結</span>
          <b>→</b>
          <span>AI 擴充</span>
          <b>→</b>
          <span>獨立口說</span>
        </div>
      </section>

      <section className="landing-access">
        <div className="access-card">
          <p className="eyebrow">Student access</p>
          <h2>開始學習</h2>
          <p>輸入教師提供的匿名研究代碼。系統不需要你的姓名或 Email。</p>
          <StudentStartForm />
          <div className="access-footer">
            <Link href="/admin/login">管理員登入</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
