"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function StudentStartForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/student/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "無法開始工作階段。");
      }
      router.push("/learn");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "發生未知錯誤。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="student-code">學生代碼</label>
        <input
          id="student-code"
          className="input code-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="AI3L-XXXX-XXXX"
          autoComplete="one-time-code"
          required
        />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button className="button full" type="submit" disabled={busy}>
        {busy ? <LoaderCircle size={18} className="spin" /> : null}
        進入學習工作區
        {!busy ? <ArrowRight size={18} /> : null}
      </button>
    </form>
  );
}
