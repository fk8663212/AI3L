"use client";

import {
  Bot,
  CheckCircle2,
  Database,
  Download,
  FileText,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import type { adminOverview } from "@/lib/services/admin-service";
import { STAGES, type StageId } from "@/lib/domain/stages";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type Tab = "overview" | "providers" | "tasks" | "research";

function ProviderCard({
  provider,
  modelId,
  existing,
  action,
}: {
  provider: "openai" | "google";
  modelId: string;
  existing: Overview["providers"][number] | undefined;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}) {
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await action({
      action: "save_provider",
      provider,
      displayName: provider === "openai" ? "OpenAI" : "Google Gemini",
      apiKey: key,
      modelId,
    });
    if (result) {
      setMessage(
        result.verified
          ? "API Key 已加密保存並通過連線測試。"
          : `已保存，但連線測試失敗：${String(result.error ?? "")}`,
      );
      setKey("");
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setMessage("");
    const result = await action({
      action: "test_provider",
      provider,
      modelId,
    });
    if (result) setMessage("連線測試成功。");
    setBusy(false);
  }

  return (
    <div className="admin-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ marginBottom: 5 }}>
            {provider === "openai" ? "OpenAI" : "Google Gemini"}
          </h3>
          <small style={{ color: "var(--ink-soft)" }}>{modelId}</small>
        </div>
        <span
          className={`status-dot ${existing?.verifiedAt ? "good" : existing ? "bad" : ""}`}
          title={existing?.verifiedAt ? "已驗證" : "未驗證"}
        />
      </div>
      <p style={{ color: "var(--ink-soft)", fontSize: ".82rem" }}>
        {existing
          ? `目前金鑰：•••• ${existing.keyLastFour}`
          : "尚未設定 API Key"}
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor={`${provider}-key`}>新增或輪替 API Key</label>
          <input
            id={`${provider}-key`}
            className="input"
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="只會在送出時傳到伺服器"
            required
          />
        </div>
        <div className="stage-panel-row">
          <button className="button" type="submit" disabled={busy || !key}>
            <KeyRound size={16} />
            加密保存
          </button>
          {existing ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={test}
            >
              <RefreshCw size={16} />
              重新測試
            </button>
          ) : null}
        </div>
      </form>
      {message ? (
        <div
          className={message.includes("成功") || message.includes("通過") ? "success-banner" : "error-banner"}
        >
          {message}
        </div>
      ) : null}
      {existing?.lastError ? (
        <div className="error-banner">{existing.lastError}</div>
      ) : null}
    </div>
  );
}

function OverviewTab({ data }: { data: Overview }) {
  const completed = data.sessions.filter((session) => session.completedAt).length;
  return (
    <div className="section-stack">
      <div className="metric-grid">
        <div className="metric-card">
          <span>研究任務</span>
          <strong>{data.tasks.length}</strong>
        </div>
        <div className="metric-card">
          <span>學生工作階段</span>
          <strong>{data.sessions.length}</strong>
        </div>
        <div className="metric-card">
          <span>完成率</span>
          <strong>
            {data.sessions.length
              ? Math.round((completed / data.sessions.length) * 100)
              : 0}
            %
          </strong>
        </div>
      </div>
      <div className="split-grid">
        <div className="admin-card">
          <h2>系統就緒狀態</h2>
          <div className="section-stack">
            {(["google", "openai"] as const).map((provider) => {
              const configured = data.providers.find(
                (item) => item.provider === provider,
              );
              return (
                <div className="stage-panel-row" key={provider}>
                  <span
                    className={`status-dot ${configured?.verifiedAt ? "good" : "bad"}`}
                  />
                  <strong style={{ flex: 1 }}>
                    {provider === "google" ? "Gemini" : "OpenAI"}
                  </strong>
                  <small>
                    {configured?.verifiedAt ? "已驗證" : "尚未完成"}
                  </small>
                </div>
              );
            })}
            <div className="stage-panel-row">
              <span
                className={`status-dot ${data.drive.connected ? "good" : "bad"}`}
              />
              <strong style={{ flex: 1 }}>Google Drive</strong>
              <small>{data.drive.connected ? "已連接" : "尚未完成"}</small>
            </div>
          </div>
        </div>
        <div className="admin-card">
          <h2>Google Drive 錄音庫</h2>
          {data.drive.connected ? (
            <>
              <div className="success-banner">
                <CheckCircle2 size={15} /> 已連接 {data.drive.email}
              </div>
              <a
                className="button secondary"
                href={`https://drive.google.com/drive/folders/${data.drive.rootFolderId}`}
                target="_blank"
                rel="noreferrer"
              >
                <Link2 size={16} />
                開啟研究資料夾
              </a>
            </>
          ) : (
            <>
              <p style={{ color: "var(--ink-soft)", lineHeight: 1.6 }}>
                連接管理員 Google 帳號後，系統會建立私人研究資料夾並保存學生錄音。
              </p>
              <a className="button" href="/api/admin/google/connect">
                <Link2 size={16} />
                連接 Google Drive
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProvidersTab({
  data,
  action,
}: {
  data: Overview;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}) {
  return (
    <div className="section-stack">
      <div className="info-banner">
        API Key 使用 AES-256-GCM 加密後存入資料庫，瀏覽器永遠不會取回明文。
      </div>
      <div className="split-grid">
        <ProviderCard
          provider="google"
          modelId="gemini-3.6-flash"
          existing={data.providers.find((item) => item.provider === "google")}
          action={action}
        />
        <ProviderCard
          provider="openai"
          modelId="gpt-5.6-terra"
          existing={data.providers.find((item) => item.provider === "openai")}
          action={action}
        />
      </div>
      <div className="admin-card">
        <h2>可用模型</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>供應商</th>
                <th>顯示名稱</th>
                <th>Model ID</th>
                <th>能力</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((model) => (
                <tr key={model.id}>
                  <td>{model.provider}</td>
                  <td>{model.displayName}</td>
                  <td>
                    <code>{model.modelId}</code>
                  </td>
                  <td>
                    {model.capabilities.image ? "圖片 " : ""}
                    {model.capabilities.audio ? "音訊 " : ""}
                    結構化輸出
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TasksTab({
  data,
  action,
  setCodes,
}: {
  data: Overview;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  setCodes: (value: Array<{ code: string; label: string }>) => void;
}) {
  const [title, setTitle] = useState("大稻埕年貨市場英語敘事");
  const [slug, setSlug] = useState("dadaocheng-lunar-new-year");
  const [description, setDescription] = useState(
    "以手繪、概念圖與 AI 鷹架，將大稻埕年貨市場經驗轉化為可表達的英語敘事。",
  );
  const [provider, setProvider] = useState<"google" | "openai">("google");
  const [modelId, setModelId] = useState("gemini-3.6-flash");
  const [message, setMessage] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await action({
      action: "save_task",
      title,
      slug,
      description,
      provider,
      modelId,
      retentionDays: 180,
    });
    if (result) setMessage("任務草稿已建立。");
  }

  return (
    <div className="section-stack">
      <div className="admin-card">
        <h2>建立研究任務</h2>
        <form className="split-grid" onSubmit={create}>
          <div className="field">
            <label htmlFor="task-title">任務名稱</label>
            <input
              id="task-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="task-slug">識別名稱</label>
            <input
              id="task-slug"
              className="input"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="task-description">研究任務說明</label>
            <textarea
              id="task-description"
              className="textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="task-provider">供應商</label>
            <select
              id="task-provider"
              className="select"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as "google" | "openai";
                setProvider(next);
                setModelId(
                  next === "google" ? "gemini-3.6-flash" : "gpt-5.6-terra",
                );
              }}
            >
              <option value="google">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-model">模型</label>
            <select
              id="task-model"
              className="select"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              {data.models
                .filter((model) => model.provider === provider)
                .map((model) => (
                  <option value={model.modelId} key={model.id}>
                    {model.displayName}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <button className="button" type="submit">
              <Plus size={16} />
              建立草稿
            </button>
          </div>
        </form>
        {message ? <div className="success-banner">{message}</div> : null}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>任務</th>
              <th>版本</th>
              <th>供應商／模型</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.title}</strong>
                  <br />
                  <small>{task.slug}</small>
                </td>
                <td>v{task.version}</td>
                <td>
                  {task.provider}
                  <br />
                  <code>{task.modelId}</code>
                </td>
                <td>
                  <span className="tag">{task.status}</span>
                </td>
                <td>
                  <div className="stage-panel-row">
                    {task.status === "draft" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() =>
                          action({ action: "publish_task", taskId: task.id })
                        }
                      >
                        發布
                      </button>
                    ) : null}
                    {task.status === "published" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={async () => {
                          const result = await action({
                            action: "generate_codes",
                            taskId: task.id,
                            count: 20,
                          });
                          if (result && Array.isArray(result.codes)) {
                            setCodes(
                              result.codes as Array<{
                                code: string;
                                label: string;
                              }>,
                            );
                          }
                        }}
                      >
                        <Users size={15} />
                        產生 20 組代碼
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResearchTab({
  data,
  action,
}: {
  data: Overview;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [stage, setStage] = useState<StageId>("pretest");
  const [reason, setReason] = useState("");
  return (
    <div className="section-stack">
      <div className="admin-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ marginBottom: 6 }}>研究資料</h2>
            <p style={{ margin: 0, color: "var(--ink-soft)" }}>
              匯出匿名工作階段、訊息、概念圖、AI run 與媒體 manifest。
            </p>
          </div>
          <a className="button" href="/api/admin/export">
            <Download size={16} />
            匯出 JSON
          </a>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>匿名工作階段</th>
              <th>目前階段</th>
              <th>狀態</th>
              <th>開始時間</th>
              <th>控制</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <code>{session.id.slice(0, 12)}</code>
                </td>
                <td>{session.currentStage}</td>
                <td>{session.completedAt ? "completed" : session.stageStatus}</td>
                <td>{new Date(session.startedAt).toLocaleString("zh-TW")}</td>
                <td>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setSelected(session.id);
                      setStage(session.currentStage);
                    }}
                  >
                    <Settings2 size={15} />
                    階段覆寫
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <button
              className="button ghost"
              style={{ float: "right" }}
              type="button"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
            <h2>管理員階段覆寫</h2>
            <div className="field">
              <label htmlFor="override-stage">目標階段</label>
              <select
                id="override-stage"
                className="select"
                value={stage}
                onChange={(event) => setStage(event.target.value as StageId)}
              >
                {STAGES.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.order}. {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="override-reason">必要理由</label>
              <textarea
                id="override-reason"
                className="textarea"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：學生誤傳圖片，需要退回重新提交。"
              />
            </div>
            <button
              className="button"
              type="button"
              disabled={reason.length < 5}
              onClick={async () => {
                const result = await action({
                  action: "override_stage",
                  sessionId: selected,
                  stageId: stage,
                  reason,
                });
                if (result !== null) {
                  setSelected(null);
                  setReason("");
                }
              }}
            >
              確認覆寫並留下稽核紀錄
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminDashboard({ initialData }: { initialData: Overview }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<Array<{ code: string; label: string }>>([]);

  const heading = useMemo(
    () =>
      ({
        overview: ["控制中心", "掌握研究平台的連線與進度。"],
        providers: ["AI 與儲存", "管理伺服器端憑證及模型。"],
        tasks: ["研究任務", "發布不可變任務版本並產生學生代碼。"],
        research: ["研究資料", "查看工作階段、覆寫流程與匯出資料。"],
      })[tab],
    [tab],
  );

  async function refresh() {
    const response = await fetch("/api/admin/overview");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "重新載入失敗。");
    setData(payload.data);
  }

  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "操作失敗。");
      }
      await refresh();
      return (body.data ?? {}) as Record<string, unknown>;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失敗。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  function downloadCodes() {
    const csv = [
      "label,code",
      ...codes.map((item) => `${item.label},${item.code}`),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai3l-student-codes-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const nav = [
    { id: "overview" as const, label: "控制中心", icon: LayoutDashboard },
    { id: "providers" as const, label: "AI 與儲存", icon: Bot },
    { id: "tasks" as const, label: "研究任務", icon: FileText },
    { id: "research" as const, label: "研究資料", icon: Database },
  ];

  return (
    <main className="admin-shell">
      <aside className="admin-nav">
        <div className="rail-brand">
          <span className="brand-mark">A3</span>
          <strong>Admin</strong>
        </div>
        <div className="admin-nav-list">
          {nav.map((item) => (
            <button
              className={tab === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button
          style={{ marginTop: 28 }}
          type="button"
          onClick={logout}
        >
          <LogOut size={18} />
          <span>登出</span>
        </button>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div>
            <h1>{heading[0]}</h1>
            <p>{heading[1]}</p>
          </div>
          <button className="button secondary" type="button" onClick={refresh}>
            <RefreshCw size={16} />
            重新整理
          </button>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}
        {busy ? (
          <div className="info-banner">
            <LoaderCircle className="spin" size={16} /> 正在處理管理操作…
          </div>
        ) : null}
        {tab === "overview" ? <OverviewTab data={data} /> : null}
        {tab === "providers" ? (
          <ProvidersTab data={data} action={action} />
        ) : null}
        {tab === "tasks" ? (
          <TasksTab data={data} action={action} setCodes={setCodes} />
        ) : null}
        {tab === "research" ? (
          <ResearchTab data={data} action={action} />
        ) : null}
      </section>

      {codes.length ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <button
              className="button ghost"
              style={{ float: "right" }}
              type="button"
              onClick={() => setCodes([])}
            >
              <X size={18} />
            </button>
            <h2>學生代碼只顯示這一次</h2>
            <p style={{ color: "var(--ink-soft)" }}>
              資料庫只保存 HMAC；關閉前請下載 CSV 並安全交付學生。
            </p>
            <textarea
              className="textarea code-input"
              readOnly
              value={codes.map((item) => `${item.label}, ${item.code}`).join("\n")}
              style={{ minHeight: 280 }}
            />
            <button className="button" type="button" onClick={downloadCodes}>
              <Download size={16} />
              下載代碼 CSV
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
