"use client";

import { Download, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  MEASURE_LABELS,
  MEASURES,
  type MeasureSummary,
  type PrePostRow,
} from "@/lib/domain/pre-post-report";
import { STAGES } from "@/lib/domain/stages";
import type { adminOverview } from "@/lib/services/admin-service";
import type { RecordingAnalysisIssue } from "@/lib/services/recording-service";
import type { RetentionExpiredSession } from "@/lib/services/participant-data-service";
import type { listAuditLogs } from "@/lib/services/report-service";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type AuditPage = Awaited<ReturnType<typeof listAuditLogs>>;

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-TW") : "—";
}

function stageTitle(stageId: string): string {
  return STAGES.find((stage) => stage.id === stageId)?.title ?? stageId;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失敗。");
  return payload.data as T;
}

/**
 * GETs `url` whenever it changes or `reload()` is called. State is only set in
 * the fetch callbacks, never synchronously inside the effect.
 */
function useAdminData<T>(url: string | null) {
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = url ? `${url}#${reloadCount}` : "";
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
  }>({ key: "", data: null, error: "" });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((response) => readJson<T>(response))
      .then(
        (data) => {
          if (!cancelled) setState({ key: requestKey, data, error: "" });
        },
        (cause: unknown) => {
          if (!cancelled) {
            setState((current) => ({
              key: requestKey,
              data: current.data,
              error: cause instanceof Error ? cause.message : "無法載入資料。",
            }));
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [url, requestKey]);

  const reload = useCallback(() => setReloadCount((value) => value + 1), []);
  return {
    data: state.data,
    error: state.error,
    loading: Boolean(url) && state.key !== requestKey,
    reload,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return readJson<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ---- Recording analysis ------------------------------------------------------

export function RecordingIssuesPanel() {
  const { data, error, loading, reload } = useAdminData<RecordingAnalysisIssue[]>(
    "/api/admin/recordings",
  );
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const issues = data ?? [];

  async function retry(ids: string[]) {
    setNotice("");
    setFailure("");
    let ok = 0;
    let failed = 0;
    // One request per recording: each can take over a minute on its own.
    for (const id of ids) {
      setRunning(id);
      try {
        await postJson("/api/admin/recordings", { audioArtifactId: id });
        ok += 1;
      } catch (cause) {
        failed += 1;
        setFailure(cause instanceof Error ? cause.message : "重試失敗。");
      }
    }
    setRunning(null);
    setNotice(`已完成 ${ok} 筆分析${failed ? `，${failed} 筆仍失敗` : ""}。`);
    reload();
  }

  return (
    <div className="admin-card section-stack">
      <div className="stage-panel-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>錄音分析待處理</h2>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>
            逐字稿與口說指標產生失敗，或超過 10 分鐘仍未完成的錄音。重試會從 Google Drive 重新讀取錄音。
          </p>
        </div>
        <div className="stage-panel-row">
          <button className="button secondary compact" type="button" onClick={reload}>
            <RefreshCw size={14} />
            重新整理
          </button>
          <button
            className="button compact"
            type="button"
            disabled={!issues.length || running !== null}
            onClick={() => void retry(issues.map((item) => item.audioArtifactId))}
          >
            <RotateCcw size={14} />
            全部重試
          </button>
        </div>
      </div>
      {notice ? <div className="success-banner">{notice}</div> : null}
      {failure || error ? <div className="error-banner">{failure || error}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>學生標籤</th>
              <th>任務</th>
              <th>階段</th>
              <th>狀態</th>
              <th>最後更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((item) => (
              <tr key={item.audioArtifactId}>
                <td>{item.studentLabel ?? "未命名"}</td>
                <td>{item.taskTitle}</td>
                <td>{stageTitle(item.stageId)}</td>
                <td>
                  <span className="tag warning">
                    {item.status === "failed" ? "失敗" : "逾時未完成"}
                  </span>
                </td>
                <td>{formatDate(item.updatedAt)}</td>
                <td>
                  <button
                    className="button secondary compact"
                    type="button"
                    disabled={running !== null}
                    onClick={() => void retry([item.audioArtifactId])}
                  >
                    {running === item.audioArtifactId ? "分析中…" : "重試"}
                  </button>
                </td>
              </tr>
            ))}
            {!issues.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="table-empty-state">
                    {loading ? "載入中…" : "目前沒有需要處理的錄音分析。"}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Pre/post report ---------------------------------------------------------

function formatNumber(value: number | null): string {
  return value === null ? "—" : String(Math.round(value * 100) / 100);
}

export function PrePostReportPanel({ data }: { data: Overview }) {
  const tasks = data.tasks.filter((task) => task.status !== "draft");
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const report = useAdminData<{
    rows: PrePostRow[];
    summary: Record<(typeof MEASURES)[number], MeasureSummary>;
  }>(taskId ? `/api/admin/report?taskId=${taskId}` : null);

  return (
    <div className="admin-card section-stack">
      <div className="stage-panel-row" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>前後測比較</h2>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>
            平均值只計入前測與後測都有數值的學生（配對樣本）；為描述性統計，不含顯著性檢定。
          </p>
        </div>
        <div className="stage-panel-row" style={{ alignItems: "flex-end" }}>
          <select
            aria-label="報表任務"
            className="select"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
          >
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · v{task.version}
              </option>
            ))}
          </select>
          {taskId ? (
            <a className="button compact" href={`/api/admin/report?taskId=${taskId}&format=csv`}>
              <Download size={14} />
              下載 CSV
            </a>
          ) : null}
        </div>
      </div>
      {report.error ? <div className="error-banner">{report.error}</div> : null}
      {!tasks.length ? <p style={{ margin: 0 }}>尚無已發布的任務。</p> : null}
      {report.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>指標</th>
                  <th>配對人數</th>
                  <th>前測平均</th>
                  <th>後測平均</th>
                  <th>平均變化</th>
                </tr>
              </thead>
              <tbody>
                {MEASURES.map((measure) => {
                  const summary = report.data!.summary[measure];
                  return (
                    <tr key={measure}>
                      <td>{MEASURE_LABELS[measure]}</td>
                      <td>{summary.pairs}</td>
                      <td>{formatNumber(summary.preMean)}</td>
                      <td>{formatNumber(summary.postMean)}</td>
                      <td>{formatNumber(summary.meanChange)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details>
            <summary>每位學生（{report.data.rows.length} 位）</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>學生標籤</th>
                    <th>進度</th>
                    <th>前測語速</th>
                    <th>後測語速</th>
                    <th>前測字數</th>
                    <th>後測字數</th>
                    <th>前測內容單位</th>
                    <th>後測內容單位</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <tr key={row.sessionId}>
                      <td>{row.studentLabel ?? "未命名"}</td>
                      <td>{row.completed ? "已完成" : stageTitle(row.currentStage)}</td>
                      <td>{formatNumber(row.pre.wordsPerMinute)}</td>
                      <td>{formatNumber(row.post.wordsPerMinute)}</td>
                      <td>{formatNumber(row.pre.wordCount)}</td>
                      <td>{formatNumber(row.post.wordCount)}</td>
                      <td>{formatNumber(row.pre.contentUnits)}</td>
                      <td>{formatNumber(row.post.contentUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : report.loading ? (
        <p style={{ margin: 0 }}>載入中…</p>
      ) : null}
    </div>
  );
}

// ---- Retention ---------------------------------------------------------------

export function RetentionPanel({ onDeleted }: { onDeleted: () => void }) {
  const { data, error, loading, reload } = useAdminData<RetentionExpiredSession[]>(
    "/api/admin/participants",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const expired = data ?? [];

  async function purge() {
    if (
      !window.confirm(
        `要永久刪除這 ${expired.length} 位學生的所有資料嗎？包含 Google Drive 錄音與圖片，刪除後無法復原。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice("");
    setFailure("");
    let deleted = 0;
    let failed = 0;
    const ids = expired.map((row) => row.sessionId);
    try {
      for (let index = 0; index < ids.length; index += 25) {
        const result = await postJson<{ deleted: number; failed: string[] }>(
          "/api/admin/participants",
          { action: "purge_retention", sessionIds: ids.slice(index, index + 25) },
        );
        deleted += result.deleted;
        failed += result.failed.length;
      }
      setNotice(`已刪除 ${deleted} 位學生的資料${failed ? `；${failed} 位刪除失敗，可再試一次` : ""}。`);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "刪除失敗。");
    } finally {
      setBusy(false);
      reload();
      onDeleted();
    }
  }

  return (
    <div className="admin-card section-stack">
      <div className="stage-panel-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>已超過保存期限</h2>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>
            依任務設定的保存天數，從完成時間（未完成則為最後活動時間）起算。系統不會自動刪除，請確認後再執行。
          </p>
        </div>
        <button
          className="button danger-outline compact"
          type="button"
          disabled={!expired.length || busy}
          onClick={() => void purge()}
        >
          <Trash2 size={14} />
          {busy ? "刪除中…" : `刪除全部 ${expired.length} 位`}
        </button>
      </div>
      {notice ? <div className="success-banner">{notice}</div> : null}
      {failure || error ? <div className="error-banner">{failure || error}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>學生標籤</th>
              <th>任務</th>
              <th>保存天數</th>
              <th>起算時間</th>
              <th>到期時間</th>
            </tr>
          </thead>
          <tbody>
            {expired.map((row) => (
              <tr key={row.sessionId}>
                <td>{row.studentLabel ?? "未命名"}</td>
                <td>{row.taskTitle}</td>
                <td>{row.retentionDays}</td>
                <td>{formatDate(row.retainedSince)}</td>
                <td>{formatDate(row.expiredAt)}</td>
              </tr>
            ))}
            {!expired.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="table-empty-state">
                    {loading ? "載入中…" : "沒有超過保存期限的資料。"}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Delete one participant --------------------------------------------------

export function DeleteParticipantDialog({
  session,
  onClose,
  onDeleted,
}: {
  session: { id: string; studentLabel: string | null };
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const expected = session.studentLabel ?? session.id;
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function submit() {
    setBusy(true);
    setFailure("");
    try {
      const result = await postJson<{
        driveFilesDeleted: number;
        blobsDeleted: number;
      }>("/api/admin/participants", {
        action: "delete_participant",
        sessionId: session.id,
        confirmation: confirmation.trim(),
      });
      onDeleted(
        `已刪除 ${expected} 的所有資料（${result.driveFilesDeleted} 個錄音檔、${result.blobsDeleted} 個圖片檔）。`,
      );
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "刪除失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>刪除參與者資料</h2>
        <p>
          會永久刪除 <strong>{expected}</strong> 的錄音（Google Drive）、圖片、對話、AI 紀錄與所有階段資料，並停用其代碼。適用於撤回同意或資料刪除請求，無法復原。
        </p>
        <div className="field">
          <label htmlFor="delete-participant-confirm">請輸入「{expected}」以確認</label>
          <input
            id="delete-participant-confirm"
            className="input"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </div>
        {failure ? <div className="error-banner">{failure}</div> : null}
        <div className="stage-panel-row">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="button danger-outline"
            type="button"
            disabled={confirmation.trim() !== expected || busy}
            onClick={() => void submit()}
          >
            <Trash2 size={15} />
            {busy ? "刪除中…" : "永久刪除"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Audit log ---------------------------------------------------------------

export function AuditLogTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const params = new URLSearchParams({ page: String(page) });
  if (action) params.set("action", action);
  const { data, error, loading, reload } = useAdminData<AuditPage>(
    `/api/admin/audit?${params}`,
  );

  return (
    <div className="admin-card section-stack">
      <div className="stage-panel-row" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>稽核紀錄</h2>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>
            管理員操作紀錄：任務發布、代碼管理、階段覆寫、資料刪除等。
          </p>
        </div>
        <div className="stage-panel-row" style={{ alignItems: "flex-end" }}>
          <select
            aria-label="篩選操作"
            className="select"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部操作</option>
            {(data?.actions ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button className="button secondary compact" type="button" onClick={reload}>
            <RefreshCw size={14} />
            重新整理
          </button>
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>時間</th>
              <th>操作</th>
              <th>對象</th>
              <th>內容</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>{formatDate(item.createdAt)}</td>
                <td>
                  <code>{item.action}</code>
                </td>
                <td>
                  {item.targetType}
                  {item.targetId ? (
                    <>
                      <br />
                      <small>
                        <code>{item.targetId.slice(0, 12)}</code>
                      </small>
                    </>
                  ) : null}
                </td>
                <td>
                  <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify(item.detail)}
                  </code>
                </td>
              </tr>
            ))}
            {!data?.items.length ? (
              <tr>
                <td colSpan={4}>
                  <div className="table-empty-state">
                    {loading ? "載入中…" : "沒有稽核紀錄。"}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data && data.pagination.totalPages > 1 ? (
        <div className="session-pagination">
          <span>
            共 {data.pagination.total} 筆 · 第 {data.pagination.page} / {data.pagination.totalPages} 頁
          </span>
          <div>
            <button
              className="button secondary compact"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一頁
            </button>
            <button
              className="button secondary compact"
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一頁
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
