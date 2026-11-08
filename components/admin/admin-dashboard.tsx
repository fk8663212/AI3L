"use client";

import {
  Bot,
  Braces,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileText,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Settings2,
  Trash2,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { adminOverview } from "@/lib/services/admin-service";
import type { AdminSessionListPage } from "@/lib/services/admin-session-service";
import { AccessCodesTab } from "@/components/admin/access-codes-tab";
import { ModelManager } from "@/components/admin/model-manager";
import {
  AuditLogTab,
  DeleteParticipantDialog,
  PrePostReportPanel,
  RecordingIssuesPanel,
  RetentionPanel,
} from "@/components/admin/data-panels";
import { STAGES, type StageId } from "@/lib/domain/stages";
import {
  SPEAKING_TEMPLATES, applySpeakingTemplateInstructions, speakingTemplateInstructions,
  speakingTemplateLabel, speakingTemplateSelection, type SpeakingTemplateChoice,
} from "@/lib/domain/speaking-templates";
import { promptConfigForSpeakingTemplate } from "@/lib/ai/prompts";
import { taskDeletionConfirmation } from "@/lib/domain/task-deletion";
import { createTaskSlug, normalizeTaskSlug, taskSlugProblem } from "@/lib/domain/task-slug";
import {
  MIN_STAGE_OVERRIDE_REASON_LENGTH,
  stageOverrideReasonReady,
} from "@/lib/domain/stage-override";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type Tab =
  | "overview"
  | "providers"
  | "tasks"
  | "codes"
  | "prompts"
  | "research"
  | "audit";
type ResearchView = "sessions" | "report" | "recordings" | "retention";
type PromptConfig = Overview["taskDefaults"]["promptConfig"];

const PROMPT_FIELDS: Array<{
  key: keyof PromptConfig;
  label: string;
  help: string;
}> = [
  {
    key: "baseSystemPrompt",
    label: "AI 鷹架共用 System Prompt",
    help: "套用於圖像分析、概念擴展與句型鷹架。",
  },
  {
    key: "imageAnalysisTemplate",
    label: "圖像分析 User Prompt",
    help: "可用 {{task.title}}、{{student.labels}}；手繪圖會另外作為圖片輸入。",
  },
  {
    key: "conceptExpansionTemplate",
    label: "概念擴展 User Prompt",
    help: "手繪概念圖會另外作為圖片輸入；可用 {{task.title}}、{{student.conceptMapJson}}、{{student.acceptedVocabularyJson}}。",
  },
  {
    key: "sentenceScaffoldTemplate",
    label: "句型鷹架 User Prompt",
    help: "可用 {{task.title}}、{{student.finalConceptMapJson}}、{{student.sentencesJson}}。",
  },
  {
    key: "googleTranscriptionSystemPrompt",
    label: "Gemini 轉錄 System Prompt",
    help: "規範 Gemini 如何忠實處理學生錄音。",
  },
  {
    key: "openaiTranscriptionPrompt",
    label: "OpenAI 轉錄 Prompt",
    help: "傳給 OpenAI 專用 audio transcription API。",
  },
  {
    key: "transcriptionTemplate",
    label: "Gemini 轉錄 User Prompt",
    help: "可用 {{recording.durationSeconds}}；音訊會另外作為輸入。",
  },
  {
    key: "speechEvaluationSystemPrompt",
    label: "口說分析 System Prompt",
    help: "限制研究分析範圍及結構化輸出。",
  },
  {
    key: "speechEvaluationTemplate",
    label: "口說分析 User Prompt",
    help: "可用 {{stage.id}}、{{recording.transcriptJson}}、{{recording.durationSeconds}}、{{recording.wordsPerMinute}}。",
  },
];

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

function OverviewTab({
  data,
  action,
  goTo,
}: {
  data: Overview;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  goTo: (tab: Tab, researchView?: ResearchView) => void;
}) {
  const completed = data.sessionStats.completed;
  const total = data.sessionStats.total;
  const [testingDrive, setTestingDrive] = useState(false);
  const [driveMessage, setDriveMessage] = useState("");
  const publishedTasks = data.tasks.filter((task) => task.status === "published");
  const largest = Math.max(1, ...Object.values(data.progress.stageCounts), data.progress.completed);

  async function testDrive() {
    setTestingDrive(true);
    setDriveMessage("");
    const result = await action({ action: "test_drive" });
    if (result) setDriveMessage("錄音儲存庫可正常使用。");
    setTestingDrive(false);
  }

  const readiness = [
    ...(["google", "openai"] as const).map((provider) => {
      const configured = data.providers.find((item) => item.provider === provider);
      return {
        key: provider,
        label: provider === "google" ? "Gemini API Key" : "OpenAI API Key",
        ok: Boolean(configured?.verifiedAt),
        detail: configured?.verifiedAt ? "已驗證" : "尚未設定",
        optional: true,
      };
    }),
    {
      key: "drive",
      label: data.drive.driver === "local" ? "本機錄音庫" : "Google Drive 錄音庫",
      ok: data.drive.verified,
      detail: data.drive.verified ? "已驗證" : data.drive.connected ? "需重新驗證" : "尚未連接",
      optional: false,
    },
    {
      key: "tasks",
      label: "已發布任務",
      ok: publishedTasks.length > 0,
      detail: `${publishedTasks.length} 個`,
      optional: false,
    },
    {
      key: "codes",
      label: "學生代碼",
      ok: data.accessCodeCount > 0,
      detail: `${data.accessCodeCount} 組`,
      optional: false,
    },
  ];
  const anyProvider = readiness.some((item) => item.optional && item.ok);

  return (
    <div className="section-stack">
      <div className="metric-grid overview-metrics">
        <div className="metric-card">
          <span>參與學生</span>
          <strong>{total}</strong>
          <small>共 {data.accessCodeCount} 組代碼</small>
        </div>
        <div className="metric-card">
          <span>已完成</span>
          <strong className="good">{completed}</strong>
          <small>{total ? Math.round((completed / total) * 100) : 0}% 完成率</small>
        </div>
        <div className={`metric-card ${data.attention.recordingIssues ? "attention" : ""}`}>
          <span>錄音分析待處理</span>
          <strong>{data.attention.recordingIssues}</strong>
          <button className="link-button" type="button" onClick={() => goTo("research", "recordings")}>
            {data.attention.recordingIssues ? "前往重試" : "查看"}
          </button>
        </div>
        <div className="metric-card">
          <span>超過保存期限</span>
          <strong>{data.attention.retentionExpired}</strong>
          <button className="link-button" type="button" onClick={() => goTo("research", "retention")}>
            檢視
          </button>
        </div>
      </div>

      <div className="overview-grid">
        <div className="admin-card">
          <div className="card-heading">
            <h2>學生停在哪一階段</h2>
            <small>{total} 位學生</small>
          </div>
          <div className="stage-funnel">
            {STAGES.map((stage) => {
              const count = data.progress.stageCounts[stage.id];
              return (
                <div className="funnel-row" key={stage.id}>
                  <span>
                    {stage.order} {stage.shortLabel}
                  </span>
                  <div className="funnel-track" aria-hidden="true">
                    <div style={{ width: `${(count / largest) * 100}%` }} />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
            <div className="funnel-row done">
              <span>已完成</span>
              <div className="funnel-track" aria-hidden="true">
                <div style={{ width: `${(data.progress.completed / largest) * 100}%` }} />
              </div>
              <strong>{data.progress.completed}</strong>
            </div>
          </div>
        </div>

        <div className="admin-card">
          <h2>系統就緒</h2>
          <div className="readiness-list">
            {readiness.map((item) => {
              const good = item.ok || (item.optional && anyProvider);
              return (
                <div className={`readiness-item ${good ? "good" : "bad"}`} key={item.key}>
                  {good ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
                  <strong>{item.label}</strong>
                  <small>{item.ok ? item.detail : item.optional && anyProvider ? "未使用" : item.detail}</small>
                </div>
              );
            })}
          </div>
          {!data.drive.verified ? (
            <p className="readiness-note">錄音儲存庫未通過驗證時，學生無法保存錄音。請先確認儲存設定。</p>
          ) : null}
        </div>
      </div>

      <div className="admin-card">
        <div className="card-heading">
          <h2>{data.drive.driver === "local" ? "本機錄音庫" : "Google Drive 錄音庫"}</h2>
          {data.drive.connected && data.drive.email ? <small>{data.drive.email}</small> : null}
        </div>
        {data.drive.driver === "local" ? (
          <>
            <p className="muted">圖片與錄音保存在本機，僅登入後可讀取。此模式不需要 Google Drive 或 Vercel Blob。</p>
            {data.drive.lastError ? <div className="error-banner">{data.drive.lastError}</div> : null}
            {driveMessage ? <div className="success-banner">{driveMessage}</div> : null}
            <button className="button" type="button" disabled={testingDrive} onClick={testDrive}>檢查本機儲存</button>
          </>
        ) : data.drive.connected ? (
          <>
            {!data.drive.verified ? (
              <div className="error-banner">Drive 授權尚未通過即時驗證，學生錄音將無法保存。</div>
            ) : null}
            {data.drive.lastError ? <div className="error-banner">{data.drive.lastError}</div> : null}
            {driveMessage ? <div className="success-banner">{driveMessage}</div> : null}
            <div className="stage-panel-row">
              <button className="button" type="button" disabled={testingDrive} onClick={testDrive}>
                {testingDrive ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                即時測試 Drive
              </button>
              {data.drive.rootFolderId ? (
                <a
                  className="button secondary"
                  href={`https://drive.google.com/drive/folders/${data.drive.rootFolderId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 size={16} />
                  開啟研究資料夾
                </a>
              ) : null}
              {!data.drive.verified ? (
                <a className="button secondary" href="/api/admin/google/connect">
                  <Link2 size={16} />
                  重新連接
                </a>
              ) : null}
            </div>
            {!data.drive.verified ? <GoogleRedirectHint /> : null}
          </>
        ) : (
          <>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              連接管理員 Google 帳號後，系統會建立私人研究資料夾並保存學生錄音。
            </p>
            <a className="button" href="/api/admin/google/connect">
              <Link2 size={16} />
              連接 Google Drive
            </a>
            <GoogleRedirectHint />
          </>
        )}
      </div>
    </div>
  );
}

const noSubscription = () => () => {};

/** The redirect URI Google Cloud must list for the host this admin is on. */
function GoogleRedirectHint() {
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  if (!origin) return null;
  return (
    <p className="muted" style={{ lineHeight: 1.6, fontSize: 13 }}>
      連接時會回到你目前所在的網址。請確認 Google Cloud OAuth 用戶端的「已授權的重新導向 URI」包含：
      <br />
      <code>{origin}/api/admin/google/callback</code>
    </p>
  );
}

function firstEnabledModel(data: Overview, provider: string): string | undefined {
  return data.models.find((model) => model.provider === provider && model.enabled)?.modelId;
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
          modelId={firstEnabledModel(data, "google") ?? "gemini-3.6-flash"}
          existing={data.providers.find((item) => item.provider === "google")}
          action={action}
        />
        <ProviderCard
          provider="openai"
          modelId={firstEnabledModel(data, "openai") ?? "gpt-5.6-terra"}
          existing={data.providers.find((item) => item.provider === "openai")}
          action={action}
        />
      </div>
      <ModelManager data={data} action={action} />
    </div>
  );
}

function TasksTab({
  data,
  action,
  setCodes,
  actionError,
}: {
  data: Overview;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  setCodes: (value: Array<{ code: string; label: string }>) => void;
  actionError?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<"google" | "openai">("google");
  const [modelId, setModelId] = useState("gemini-3.6-flash");
  const [promptVersion, setPromptVersion] = useState("1.0.0");
  const [speakingTemplateId, setSpeakingTemplateId] = useState<SpeakingTemplateChoice>("spatial");
  const [stageConfig, setStageConfig] = useState(
    () => applySpeakingTemplateInstructions(data.taskDefaults.stageConfig, "spatial"),
  );
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(
    () => promptConfigForSpeakingTemplate(structuredClone(data.taskDefaults.promptConfig), speakingTemplateSelection("spatial")),
  );
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState<{ fieldId: string; message: string } | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const normalizedSlug = normalizeTaskSlug(slug);
  const editingVersion = data.tasks.find(task => task.id === editingId)?.version ?? 1;
  const duplicateSlug = normalizedSlug && data.tasks.some(task => task.slug === normalizedSlug && task.version === editingVersion && task.id !== editingId);
  const slugProblem = taskSlugProblem(slug) ?? (duplicateSlug
    ? `「${normalizedSlug}」已用於任務 v${editingVersion}。${editingId ? "請保留原代號或改用其他代號。" : "可留空由系統自動產生，或編輯原有任務。"}`
    : null);

  function fieldError(id: string) {
    return formError?.fieldId === id ? <small id={`${id}-error`} className="field-validation-error" role="alert">{formError.message}</small> : null;
  }
  const [deleteTarget, setDeleteTarget] = useState<
    Overview["tasks"][number] | null
  >(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  function resetEditor() {
    setFormError(null);
    setEditingId(null);
    setTitle("");
    setSlug("");
    setDescription("");
    setProvider("google");
    setModelId("gemini-3.6-flash");
    setPromptVersion("1.0.0");
    setSpeakingTemplateId("spatial");
    setStageConfig(applySpeakingTemplateInstructions(data.taskDefaults.stageConfig, "spatial"));
    setPromptConfig(promptConfigForSpeakingTemplate(structuredClone(data.taskDefaults.promptConfig), speakingTemplateSelection("spatial")));
  }

  function editDraft(task: Overview["tasks"][number]) {
    setFormError(null);
    setEditingId(task.id);
    setTitle(task.title);
    setSlug(task.slug);
    setDescription(task.description);
    setProvider(task.provider as "google" | "openai");
    setModelId(task.modelId);
    setPromptVersion(task.promptVersion);
    setSpeakingTemplateId(task.config.speakingTemplate?.id ?? "legacy");
    setStageConfig(structuredClone(task.config.stageConfig));
    setPromptConfig(structuredClone(task.config.promptConfig));
    setMessage("");
    requestAnimationFrame(() =>
      document
        .getElementById("task-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (savingTask) return;
    if (slugProblem) {
      setFormError({ fieldId: "task-slug", message: slugProblem });
      form.querySelector<HTMLInputElement>("#task-slug")?.focus();
      return;
    }
    const invalid = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:invalid, textarea:invalid, select:invalid");
    if (invalid) {
      const label = invalid.labels?.[0]?.textContent?.trim() ?? "欄位";
      const problem = invalid.validity.valueMissing ? `請填寫「${label}」。`
        : invalid.validity.tooShort && "minLength" in invalid ? `「${label}」至少需要 ${invalid.minLength} 個字元，目前 ${invalid.value.length} 個。`
        : invalid.id === "task-prompt-version" ? "Prompt 版本可填 1.0.0 或 pilot-a；只接受英文字母、數字、句點、底線與連字號。"
        : `請檢查「${label}」的格式與字數。`;
      setFormError({ fieldId: invalid.id, message: problem });
      const details = invalid.closest("details");
      if (details) details.open = true;
      invalid.focus();
      invalid.scrollIntoView({ block: "center" });
      return;
    }
    setFormError(null);
    setSlug(normalizedSlug);
    setSavingTask(true);
    try {
    const result = await action({
      action: "save_task",
      id: editingId ?? undefined,
      title,
      slug: normalizedSlug || undefined,
      description,
      provider,
      modelId,
      promptVersion,
      speakingTemplateId,
      retentionDays: 180,
      stageConfig,
      promptConfig,
    });
    if (result) {
      setMessage(editingId ? "任務草稿已更新。" : "任務草稿已建立。");
      resetEditor();
    }
    } finally {
      setSavingTask(false);
    }
  }

  return (
    <div className="section-stack">
      {message ? <div className="success-banner">{message}</div> : null}

      <div className="admin-card" id="task-editor">
        <div className="task-editor-heading">
          <div>
            <h2>{editingId ? "編輯任務草稿" : "建立研究任務"}</h2>
            <p>
              草稿可編輯階段指示與 Prompt；發布後會鎖定為不可變研究版本。
            </p>
          </div>
          {editingId ? (
            <button
              className="button secondary"
              type="button"
              onClick={resetEditor}
            >
              <X size={16} />
              取消編輯
            </button>
          ) : null}
        </div>

        {actionError ? <div className="error-banner" role="alert">{actionError}</div> : null}
        <form className="task-editor-form" noValidate onSubmit={save} onInput={() => setFormError(null)}>
          <div className="split-grid">
            <div className="field">
              <label htmlFor="task-title">任務名稱</label>
              <input
                id="task-title"
                aria-invalid={formError?.fieldId === "task-title"}
                aria-describedby={formError?.fieldId === "task-title" ? "task-title-error" : undefined}
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：大稻埕市場英語敘事"
                minLength={2}
                maxLength={180}
                required
              />
              {fieldError("task-title")}
            </div>
            <div className="field">
              <label htmlFor="task-slug">唯一識別名稱（選填）</label>
              <div className="task-slug-controls">
              <input
                id="task-slug"
                className="input"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                onBlur={(event) => setSlug(normalizeTaskSlug(event.target.value))}
                placeholder={editingId ? "留空保留原本代號" : "留空，由系統自動產生"}
                aria-invalid={Boolean(slugProblem || formError?.fieldId === "task-slug")}
                aria-describedby={slugProblem || formError?.fieldId === "task-slug" ? "task-slug-help task-slug-error" : "task-slug-help"}
                maxLength={120}
              />
              <button type="button" className="button secondary" onClick={() => { setSlug(createTaskSlug()); setFormError(null); }}>自動產生</button>
              </div>
              <small id="task-slug-help">{editingId ? "留空會保留原本代號。" : "可留空，系統會自動產生代號。"}自訂可填 friedrice 或 fried-rice-01；大寫、空白與底線會自動整理。這不是學生登入代碼。</small>
              {slugProblem ? <small id="task-slug-error" className="field-validation-error" role="alert">{slugProblem}</small> : fieldError("task-slug")}
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="task-description">研究任務摘要</label>
              <textarea
                id="task-description"
                aria-invalid={formError?.fieldId === "task-description"}
                aria-describedby={formError?.fieldId === "task-description" ? "task-description-help task-description-error" : "task-description-help"}
                className="textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="此文字只顯示於介面，不會送入 AI。"
                minLength={10}
                maxLength={2000}
                required
              />
              <small id="task-description-help">至少 10 個字元，目前 {description.length} 個。請簡述本次活動或研究目的。</small>
              {fieldError("task-description")}
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
                required
                aria-invalid={formError?.fieldId === "task-model"}
                aria-describedby={formError?.fieldId === "task-model" ? "task-model-error" : undefined}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                {data.models
                  .filter(
                    (model) =>
                      model.provider === provider &&
                      (model.enabled || model.modelId === modelId),
                  )
                  .map((model) => (
                    <option value={model.modelId} key={model.id}>
                      {model.displayName}
                    </option>
                  ))}
              </select>
              {fieldError("task-model")}
            </div>
            <div className="field">
              <label htmlFor="task-prompt-version">Prompt 版本</label>
              <input
                id="task-prompt-version"
                aria-invalid={formError?.fieldId === "task-prompt-version"}
                aria-describedby={formError?.fieldId === "task-prompt-version" ? "task-prompt-version-error" : undefined}
                className="input"
                value={promptVersion}
                onChange={(event) => setPromptVersion(event.target.value)}
                pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]*"}
                placeholder="例如：1.0.0 或 pilot-a"
                maxLength={32}
                required
              />
              {fieldError("task-prompt-version")}
              <small>用來識別本次研究採用的 Prompt 組合；發布後鎖定。</small>
            </div>
          </div>

          <div className="speaking-template-settings">
            <div className="field">
              <label htmlFor="task-speaking-template">講述架構模板</label>
              <select id="task-speaking-template" className="input" value={speakingTemplateId}
                onChange={(event) => {
                  const next = event.target.value as SpeakingTemplateChoice;
                  if (next !== "legacy") {
                    const previous = speakingTemplateId === "legacy"
                      ? Object.fromEntries(STAGES.map(({ id }) => [id, data.taskDefaults.stageConfig[id].instruction])) as Record<StageId, string>
                      : speakingTemplateInstructions(speakingTemplateId);
                    setStageConfig((current) => applySpeakingTemplateInstructions(current, next, previous));
                    setPromptConfig((current) => promptConfigForSpeakingTemplate(current, speakingTemplateSelection(next)));
                  }
                  setSpeakingTemplateId(next);
                }}>
                {Object.entries(SPEAKING_TEMPLATES).map(([id, template]) => (
                  <option key={id} value={id}>{template.label}</option>
                ))}
                <option value="legacy">原有講述架構（未指定模板）</option>
              </select>
              <small>發布後固定為任務版本；既有自訂階段說明會保留。</small>
            </div>
            {speakingTemplateId !== "legacy" ? <div className="speaking-template-description">
              <strong>{SPEAKING_TEMPLATES[speakingTemplateId].english}</strong>
              <p>{SPEAKING_TEMPLATES[speakingTemplateId].description}</p>
              <p>{SPEAKING_TEMPLATES[speakingTemplateId].sequence}</p>
              {speakingTemplateId === "chronological" ? <small>歷史事件依背景、事件發展與結果安排；缺少的資料會提醒補充，不會補出未發生的步驟或成果。</small> : null}
              {speakingTemplateId === "problem_solution" ? <small>只有因果資料時不硬加解法；缺少依據會提醒補充，並區分可能原因、已確認原因、預期成效與實際結果。</small> : null}
              <button className="button secondary" type="button" onClick={() => {
                if (window.confirm("套用會取代目前七個階段的說明。要套用這個模板的預設說明嗎？")) {
                  setStageConfig((current) => applySpeakingTemplateInstructions(current, speakingTemplateId));
                }
              }}>套用模板的階段說明</button>
            </div> : null}
          </div>

          <details className="task-config-section" open>
            <summary>
              <div>
                <strong>七階段學生指示</strong>
                <small>這些文字會顯示在學生的對話工作區。</small>
              </div>
              <Workflow size={18} />
            </summary>
            <div className="task-stage-editor-grid">
              {STAGES.map((stage) => (
                <div className="field" key={stage.id}>
                  <label htmlFor={`instruction-${stage.id}`}>
                    {stage.order}. {stage.title}
                  </label>
                  <textarea
                    className="textarea"
                    id={`instruction-${stage.id}`}
                    aria-invalid={formError?.fieldId === `instruction-${stage.id}`}
                    aria-describedby={formError?.fieldId === `instruction-${stage.id}` ? `instruction-${stage.id}-error` : undefined}
                    value={stageConfig[stage.id].instruction}
                    onChange={(event) =>
                      setStageConfig((current) => ({
                        ...current,
                        [stage.id]: {
                          ...current[stage.id],
                          instruction: event.target.value,
                        },
                      }))
                    }
                    minLength={5}
                    maxLength={2000}
                    required
                  />
                  {fieldError(`instruction-${stage.id}`)}
                </div>
              ))}
            </div>
          </details>

          <details className="task-config-section">
            <summary>
              <div>
                <strong>AI System Prompt 與階段模板</strong>
                <small>
                  使用雙大括號保留執行時變數；可在發布前依研究設計調整。
                </small>
              </div>
              <Braces size={18} />
            </summary>
            <div className="task-prompt-editor-list">
              {PROMPT_FIELDS.map((field) => (
                <div className="field" key={field.key}>
                  <label htmlFor={`prompt-${field.key}`}>{field.label}</label>
                  <small>{field.help}</small>
                  <textarea
                    className="textarea task-prompt-textarea"
                    id={`prompt-${field.key}`}
                    aria-invalid={formError?.fieldId === `prompt-${field.key}`}
                    aria-describedby={formError?.fieldId === `prompt-${field.key}` ? `prompt-${field.key}-error` : undefined}
                    value={promptConfig[field.key]}
                    onChange={(event) =>
                      setPromptConfig((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    spellCheck={false}
                    minLength={10}
                    maxLength={20000}
                    required
                  />
                  {fieldError(`prompt-${field.key}`)}
                </div>
              ))}
            </div>
          </details>

          <div className="task-editor-actions">
            <button className="button" type="submit" disabled={savingTask}>
              {editingId ? <CheckCircle2 size={16} /> : <Plus size={16} />}
              {savingTask ? "正在保存…" : editingId ? "儲存草稿變更" : "建立可編輯草稿"}
            </button>
            <span>
              發布前請到「Prompt 與階段」進行最終稽核。
            </span>
          </div>
        </form>
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
                  <br /><small>{speakingTemplateLabel(task.config.speakingTemplate)}</small>
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
                      <>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => editDraft(task)}
                        >
                          <Settings2 size={15} />
                          編輯草稿
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() =>
                            action({ action: "publish_task", taskId: task.id })
                          }
                        >
                          發布
                        </button>
                      </>
                    ) : null}
                    {task.status === "published" ? (
                      <>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() =>
                            action({
                              action: "create_task_revision",
                              taskId: task.id,
                              promptVersion: `${task.version + 1}.0.0`,
                            })
                          }
                        >
                          <Plus size={15} />
                          建立 v{task.version + 1} 草稿
                        </button>
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
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `要封存「${task.title}」嗎？學生將無法登入或繼續作答；資料保留，之後可恢復。`,
                              )
                            ) {
                              void action({ action: "archive_task", taskId: task.id });
                            }
                          }}
                        >
                          封存
                        </button>
                      </>
                    ) : null}
                    {task.status === "archived" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() =>
                          action({ action: "restore_task", taskId: task.id })
                        }
                      >
                        恢復發布
                      </button>
                    ) : null}
                    <button
                      className="button danger-outline"
                      type="button"
                      onClick={() => {
                        setDeleteTarget(task);
                        setDeleteConfirmation("");
                      }}
                    >
                      <Trash2 size={15} />
                      刪除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleteTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <button
              className="button ghost"
              style={{ float: "right" }}
              type="button"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmation("");
              }}
            >
              <X size={18} />
            </button>
            <div className="danger-heading">
              <AlertTriangle size={22} />
              <div>
                <h2>刪除研究任務</h2>
                <p>
                  此操作會永久刪除任務及其未使用的學生代碼，無法復原。
                </p>
              </div>
            </div>
            <div className="info-banner">
              若任務已有任何學生工作階段，伺服器會拒絕刪除，以保護研究資料。
            </div>
            <dl className="delete-task-summary">
              <div>
                <dt>任務</dt>
                <dd>{deleteTarget.title}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>v{deleteTarget.version}</dd>
              </div>
              <div>
                <dt>狀態</dt>
                <dd>{deleteTarget.status}</dd>
              </div>
            </dl>
            <div className="field">
              <label htmlFor="delete-task-confirmation">
                請輸入{" "}
                <code>
                  {taskDeletionConfirmation(
                    deleteTarget.slug,
                    deleteTarget.version,
                  )}
                </code>
              </label>
              <input
                className="input"
                id="delete-task-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation("");
                }}
              >
                取消
              </button>
              <button
                className="button danger"
                type="button"
                disabled={
                  deleting ||
                  deleteConfirmation !==
                  taskDeletionConfirmation(
                    deleteTarget.slug,
                    deleteTarget.version,
                  )
                }
                onClick={async () => {
                  setDeleting(true);
                  const result = await action({
                    action: "delete_task",
                    taskId: deleteTarget.id,
                    confirmation: deleteConfirmation,
                  });
                  setDeleting(false);
                  if (!result) {
                    setDeleteTarget(null);
                    setDeleteConfirmation("");
                    return;
                  }
                  if (result) {
                    if (editingId === deleteTarget.id) resetEditor();
                    setMessage(
                      `任務 v${deleteTarget.version} 已刪除；相關未使用代碼也已移除。`,
                    );
                    setDeleteTarget(null);
                    setDeleteConfirmation("");
                  }
                }}
              >
                {deleting ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                {deleting ? "正在刪除…" : "永久刪除任務"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PromptCode({
  label,
  hash,
  children,
}: {
  label: string;
  hash: string | null;
  children: string;
}) {
  return (
    <div className="prompt-block">
      <div className="prompt-block-header">
        <strong>{label}</strong>
        {hash ? (
          <span title={hash}>
            SHA-256 · <code>{hash.slice(0, 14)}…</code>
          </span>
        ) : null}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function PromptAuditTab({ data }: { data: Overview }) {
  const firstPublished =
    data.tasks.find((task) => task.status === "published") ?? data.tasks[0];
  const [taskId, setTaskId] = useState(firstPublished?.id ?? "");
  const [stageId, setStageId] = useState<StageId>("pretest");
  const task = data.tasks.find((item) => item.id === taskId) ?? firstPublished;
  const audit = task?.promptAudit;
  const stage =
    audit?.stages.find((item) => item.id === stageId) ?? audit?.stages[0];

  if (!task || !audit || !stage) {
    return <div className="info-banner">尚未建立可供檢視的研究任務。</div>;
  }

  const instruction = task.config.stageConfig[stage.id].instruction;

  return (
    <div className="section-stack">
      <div className="info-banner prompt-audit-banner">
        <ShieldCheck size={18} />
        <div>
          <strong>這裡顯示正式程式實際使用的 Prompt 來源。</strong>
          <br />
          已發布任務僅供稽核；修改 Prompt 時應建立新的任務版本，避免改變收案中的研究條件。
        </div>
      </div>

      <div className="admin-card prompt-task-card">
        <div className="prompt-task-select">
          <div className="field">
            <label htmlFor="prompt-task">研究任務版本</label>
            <select
              className="select"
              id="prompt-task"
              value={task.id}
              onChange={(event) => setTaskId(event.target.value)}
            >
              {data.tasks.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title} · v{item.version} · {item.status}
                </option>
              ))}
            </select>
          </div>
          <div className="prompt-lock-state">
            <LockKeyhole size={18} />
            <div>
              <strong>
                {task.status === "published" ? "已發布、唯讀" : "草稿預覽"}
              </strong>
              <small>
                Prompt v{task.promptVersion} · {task.provider}/{task.modelId}
              </small>
            </div>
          </div>
        </div>
        <div className="prompt-task-summary">
          <div><span>講述模板</span><strong>{speakingTemplateLabel(task.config.speakingTemplate)}</strong></div>
          <div>
            <span>識別名稱</span>
            <code>{task.slug}</code>
          </div>
          <div>
            <span>任務摘要用途</span>
            <strong>只顯示於介面，不送入 AI</strong>
          </div>
          <div>
            <span>發布時間</span>
            <strong>
              {task.publishedAt
                ? new Date(task.publishedAt).toLocaleString("zh-TW")
                : "尚未發布"}
            </strong>
          </div>
        </div>
      </div>

      <div className="split-grid">
        <div className="admin-card">
          <h3>會送入 AI 的資料</h3>
          <ul className="prompt-context-list included">
            {audit.contextPolicy.included.map((item) => (
              <li key={item}>
                <CheckCircle2 size={15} />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="admin-card">
          <h3>不會送入 AI 的資料</h3>
          <ul className="prompt-context-list excluded">
            {audit.contextPolicy.excluded.map((item) => (
              <li key={item}>
                <LockKeyhole size={15} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="admin-card prompt-disclosure">
        <summary>
          <div>
            <strong>共用 AI 鷹架 System Prompt</strong>
            <small>圖像分析、概念擴展與句型鷹架共用</small>
          </div>
          <Braces size={18} />
        </summary>
        <PromptCode
          label="BASE_SYSTEM_PROMPT"
          hash={audit.baseSystemHash}
        >
          {audit.baseSystemPrompt}
        </PromptCode>
      </details>

      <div className="prompt-stage-layout">
        <nav className="prompt-stage-nav" aria-label="Prompt 階段">
          <div className="prompt-stage-nav-title">
            <Workflow size={17} />
            七階段流程
          </div>
          {audit.stages.map((item) => (
            <button
              className={stage.id === item.id ? "active" : ""}
              type="button"
              key={item.id}
              onClick={() => setStageId(item.id)}
            >
              <span>{item.order}</span>
              <div>
                <strong>{item.shortLabel}</strong>
                <small>
                  {item.calls.length
                    ? `${item.calls.length} 個 AI 呼叫`
                    : "不呼叫 AI"}
                </small>
              </div>
            </button>
          ))}
        </nav>

        <section className="prompt-stage-detail">
          <header>
            <div>
              <span className="eyebrow">
                Stage {stage.order} · <code>{stage.id}</code>
              </span>
              <h2>{stage.title}</h2>
              <p>{stage.description}</p>
            </div>
            <span className={`tag ${stage.calls.length ? "prompt-ai-tag" : ""}`}>
              {stage.calls.length ? "包含 AI 處理" : "學生自主階段"}
            </span>
          </header>

          <div className="prompt-instruction-card">
            <span>學生畫面顯示的階段指示</span>
            <p>{instruction}</p>
          </div>

          {stage.calls.length ? (
            <div className="prompt-call-list">
              {stage.calls.map((call, index) => (
                <article className="prompt-call-card" key={call.id}>
                  <div className="prompt-call-heading">
                    <span>{index + 1}</span>
                    <div>
                      <h3>{call.title}</h3>
                      <p>{call.purpose}</p>
                    </div>
                  </div>

                  <div className="prompt-variable-list">
                    <strong>執行時注入：</strong>
                    {call.variables.map((variable) => (
                      <code key={variable}>{`{{${variable}}}`}</code>
                    ))}
                  </div>

                  {call.systemPrompt ? (
                    <PromptCode
                      label={call.systemLabel ?? "System prompt"}
                      hash={call.systemHash}
                    >
                      {call.systemPrompt}
                    </PromptCode>
                  ) : null}

                  <PromptCode
                    label="實際送出的 User Prompt 模板"
                    hash={call.templateHash}
                  >
                    {call.userPromptTemplate}
                  </PromptCode>

                  {call.providerNote ? (
                    <div className="info-banner">{call.providerNote}</div>
                  ) : null}
                  {call.providerPrompt ? (
                    <PromptCode
                      label="OpenAI transcription prompt"
                      hash={call.providerPromptHash}
                    >
                      {call.providerPrompt}
                    </PromptCode>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="prompt-no-ai">
              <LockKeyhole size={22} />
              <div>
                <strong>此階段不呼叫 AI</strong>
                <p>系統只保存學生輸入，作為後續階段的研究證據。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ResearchTab({
  data,
  initialSessions,
  action,
  error,
  view,
  setView,
}: {
  view: ResearchView;
  setView: (view: ResearchView) => void;
  data: Overview;
  initialSessions: AdminSessionListPage;
  action: (
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  error: string;
}) {
  const [sessionPage, setSessionPage] = useState(initialSessions);
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedTaskFilter, setAppliedTaskFilter] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [stage, setStage] = useState<StageId>("pretest");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<{
    id: string;
    studentLabel: string | null;
  } | null>(null);
  const normalizedReasonLength = reason.trim().length;

  async function loadSessions(
    page: number,
    nextQuery = appliedQuery,
    nextTaskFilter = appliedTaskFilter,
  ) {
    setLoadingSessions(true);
    setSessionError("");
    try {
      const parameters = new URLSearchParams({ page: String(page) });
      if (nextQuery.trim()) parameters.set("q", nextQuery.trim());
      if (nextTaskFilter) parameters.set("taskId", nextTaskFilter);
      const response = await fetch(`/api/admin/sessions?${parameters}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "無法載入 Session 清單。");
      }
      setSessionPage(payload.data as AdminSessionListPage);
    } catch (cause) {
      setSessionError(
        cause instanceof Error ? cause.message : "無法載入 Session 清單。",
      );
    } finally {
      setLoadingSessions(false);
    }
  }

  async function searchSessions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery);
    setAppliedTaskFilter(taskFilter);
    await loadSessions(1, nextQuery, taskFilter);
  }

  function closeOverride() {
    setSelected(null);
    setReason("");
    setSubmitted(false);
  }

  return (
    <div className="section-stack">
      {notice ? <div className="success-banner">{notice}</div> : null}
      <div className="research-toolbar">
        <div className="segmented-tabs" role="tablist" aria-label="研究資料分頁">
          {(
            [
              { id: "sessions", label: "工作階段", badge: 0 },
              { id: "report", label: "前後測比較", badge: 0 },
              { id: "recordings", label: "錄音分析", badge: data.attention.recordingIssues },
              { id: "retention", label: "保存期限", badge: data.attention.retentionExpired },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              {item.label}
              {item.badge ? (
                <span className={`tab-badge ${item.id === "recordings" ? "ai" : ""}`}>{item.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
        <a className="button secondary" href="/api/admin/export">
          <Download size={16} />
          匯出完整 JSON
        </a>
      </div>
      {view === "report" ? <PrePostReportPanel data={data} /> : null}
      {view === "recordings" ? <RecordingIssuesPanel /> : null}
      {view === "retention" ? (
        <RetentionPanel onDeleted={() => void loadSessions(sessionPage.pagination.page || 1)} />
      ) : null}
      {view === "sessions" ? (
        <>
      <form className="session-filter-bar" onSubmit={searchSessions}>
        <label className="field">
          <span>搜尋 Session</span>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Session ID 或學生標籤"
            maxLength={100}
          />
        </label>
        <label className="field">
          <span>研究任務</span>
          <select
            className="select"
            value={taskFilter}
            onChange={(event) => setTaskFilter(event.target.value)}
          >
            <option value="">全部任務</option>
            {data.tasks.map((task) => (
              <option value={task.id} key={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <button className="button" type="submit" disabled={loadingSessions}>
          {loadingSessions ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Search size={16} />
          )}
          搜尋
        </button>
      </form>
      {sessionError ? <div className="error-banner">{sessionError}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>學生標籤</th>
              <th>任務</th>
              <th>匿名工作階段</th>
              <th>目前階段</th>
              <th>狀態</th>
              <th>開始時間</th>
              <th>控制</th>
            </tr>
          </thead>
          <tbody>
            {sessionPage.items.map((session) => (
              <tr key={session.id}>
                <td>{session.studentLabel ?? "未命名"}</td>
                <td>{session.taskTitle}</td>
                <td>
                  <code>{session.id.slice(0, 12)}</code>
                </td>
                <td>{session.currentStage}</td>
                <td>{session.completedAt ? "completed" : session.stageStatus}</td>
                <td>{new Date(session.startedAt).toLocaleString("zh-TW")}</td>
                <td>
                  <div className="table-action-list">
                    <a
                      className="button secondary compact"
                      href={`/admin/sessions/${session.id}`}
                    >
                      <Eye size={15} />
                      檢視
                    </a>
                    <a
                      className="button ghost compact"
                      href={`/admin/sessions/${session.id}?mode=student&print=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Printer size={15} />
                      PDF
                    </a>
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={() => {
                      setSelected(session.id);
                      setStage(session.currentStage);
                      setReason("");
                      setSubmitted(false);
                      setNotice("");
                    }}
                  >
                    <Settings2 size={15} />
                    階段覆寫
                  </button>
                  <button
                    className="button danger-outline compact"
                    type="button"
                    onClick={() =>
                      setDeleting({
                        id: session.id,
                        studentLabel: session.studentLabel,
                      })
                    }
                  >
                    <Trash2 size={15} />
                    刪除資料
                  </button>
                  </div>
                </td>
              </tr>
            ))}
            {!sessionPage.items.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="table-empty-state">
                    找不到符合條件的 Session。
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="session-pagination">
        <span>
          共 {sessionPage.pagination.total} 筆 · 第{" "}
          {sessionPage.pagination.totalPages
            ? sessionPage.pagination.page
            : 0}{" "}
          / {sessionPage.pagination.totalPages} 頁
        </span>
        <div>
          <button
            className="button secondary compact"
            type="button"
            disabled={loadingSessions || sessionPage.pagination.page <= 1}
            onClick={() => loadSessions(sessionPage.pagination.page - 1)}
          >
            <ChevronLeft size={15} />
            上一頁
          </button>
          <button
            className="button secondary compact"
            type="button"
            disabled={
              loadingSessions ||
              sessionPage.pagination.page >= sessionPage.pagination.totalPages
            }
            onClick={() => loadSessions(sessionPage.pagination.page + 1)}
          >
            下一頁
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
        </>
      ) : null}
      {deleting ? (
        <DeleteParticipantDialog
          session={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            setDeleting(null);
            setNotice(message);
            void loadSessions(sessionPage.pagination.page || 1);
          }}
        />
      ) : null}
      {selected ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <button
              className="button ghost"
              style={{ float: "right" }}
              type="button"
              onClick={closeOverride}
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
              <small>
                退回到目前或先前的階段時，該階段與之後階段的學生作品會標記為已取代，學生需重新完成；舊資料仍保留在匯出中。往後跳過階段則不影響既有作品。
              </small>
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
              <small>
                至少 {MIN_STAGE_OVERRIDE_REASON_LENGTH} 個字；目前{" "}
                {normalizedReasonLength} 個字。
              </small>
            </div>
            {submitted && error ? (
              <div className="error-banner">{error}</div>
            ) : null}
            <button
              className="button"
              type="button"
              disabled={!stageOverrideReasonReady(reason) || submitting}
              onClick={async () => {
                setSubmitting(true);
                setSubmitted(true);
                const result = await action({
                  action: "override_stage",
                  sessionId: selected,
                  stageId: stage,
                  reason,
                });
                setSubmitting(false);
                if (result) {
                  setNotice(
                    `階段已從 ${String(result.from)} 覆寫為 ${String(result.to)}，目前為第 ${String(result.attempt)} 次嘗試。`,
                  );
                  closeOverride();
                  await loadSessions(sessionPage.pagination.page);
                }
              }}
            >
              {submitting ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Settings2 size={16} />
              )}
              {submitting ? "正在覆寫…" : "確認覆寫並留下稽核紀錄"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminDashboard({
  initialData,
  initialSessions,
}: {
  initialData: Overview;
  initialSessions: AdminSessionListPage;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("overview");
  const [researchView, setResearchView] = useState<ResearchView>("sessions");

  function goTo(next: Tab, view?: ResearchView) {
    setTab(next);
    if (view) setResearchView(view);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<Array<{ code: string; label: string }>>([]);

  const heading = useMemo(
    () =>
      ({
        overview: ["控制中心", "掌握研究平台的連線與進度。"],
        providers: ["AI 與儲存", "管理伺服器端憑證及模型。"],
        tasks: ["研究任務", "發布不可變任務版本並產生學生代碼。"],
        codes: ["學生代碼", "產生、設定期限、停用與刪除學生代碼。"],
        prompts: ["Prompt 與階段", "稽核七階段指示、AI 模板與上下文邊界。"],
        research: ["研究資料", "查看工作階段、覆寫流程與匯出資料。"],
        audit: ["稽核紀錄", "查看所有管理員操作。"],
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
      try {
        await refresh();
      } catch {
        // Keep the original action error when the overview cannot be refreshed.
      }
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
    { id: "codes" as const, label: "學生代碼", icon: KeyRound },
    { id: "prompts" as const, label: "Prompt 與階段", icon: Braces },
    { id: "research" as const, label: "研究資料", icon: Database },
    { id: "audit" as const, label: "稽核紀錄", icon: ShieldCheck },
  ];

  return (
    <main className="admin-shell">
      <aside className="admin-nav">
        <div className="rail-brand admin-brand">
          <span className="brand-mark" aria-hidden="true">A3</span>
          <div>
            <strong>Speaking Lab</strong>
            <small>研究管理後台</small>
          </div>
        </div>
        <div className="admin-nav-list">
          {nav.map((item) => (
            <button
              className={tab === item.id ? "active" : ""}
              key={item.id}
              aria-label={item.label}
              title={item.label}
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
        {tab === "overview" ? <OverviewTab data={data} action={action} goTo={goTo} /> : null}
        {tab === "providers" ? (
          <ProvidersTab data={data} action={action} />
        ) : null}
        {tab === "tasks" ? (
          <TasksTab data={data} action={action} setCodes={setCodes} actionError={error} />
        ) : null}
        {tab === "codes" ? (
          <AccessCodesTab data={data} action={action} setCodes={setCodes} />
        ) : null}
        {tab === "prompts" ? <PromptAuditTab data={data} /> : null}
        {tab === "audit" ? <AuditLogTab /> : null}
        {tab === "research" ? (
          <ResearchTab
            data={data}
            initialSessions={initialSessions}
            action={action}
            error={error}
            view={researchView}
            setView={setResearchView}
          />
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
