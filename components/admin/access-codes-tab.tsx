"use client";

import { Ban, CalendarClock, CheckCircle2, RefreshCw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_CODE_BATCH, type AccessCodeStatus } from "@/lib/domain/access-codes";
import { STAGES } from "@/lib/domain/stages";
import type { adminOverview } from "@/lib/services/admin-service";
import type { AccessCodeListItem } from "@/lib/services/access-code-service";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type Action = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const STATUS_LABEL: Record<AccessCodeStatus, string> = {
  active: "有效",
  disabled: "已停用",
  expired: "已過期",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-TW") : "—";
}

/** `datetime-local` input value (viewer's local time) → ISO string, or null. */
function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function stageLabel(stageId: string): string {
  return STAGES.find((stage) => stage.id === stageId)?.title ?? stageId;
}

export function AccessCodesTab({
  data,
  action,
  setCodes,
}: {
  data: Overview;
  action: Action;
  setCodes: (codes: Array<{ code: string; label: string }>) => void;
}) {
  const tasksWithCodes = data.tasks.filter((task) => task.status !== "draft");
  const [taskId, setTaskId] = useState(
    () =>
      tasksWithCodes.find((task) => task.status === "published")?.id ??
      tasksWithCodes[0]?.id ??
      "",
  );
  const task = tasksWithCodes.find((item) => item.id === taskId);
  const [items, setItems] = useState<AccessCodeListItem[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(20);
  const [generateExpiry, setGenerateExpiry] = useState("");
  const [bulkExpiry, setBulkExpiry] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = `${taskId}:${reloadCount}`;
  const loading = Boolean(taskId) && loadedKey !== requestKey;

  const load = useCallback(() => setReloadCount((value) => value + 1), []);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    fetch(`/api/admin/codes?taskId=${taskId}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "無法載入代碼。");
        }
        return payload.data as AccessCodeListItem[];
      })
      .then(
        (data) => {
          if (cancelled) return;
          const ids = new Set(data.map((item) => item.id));
          setItems(data);
          setSelected((current) => new Set([...current].filter((id) => ids.has(id))));
          setLoadError("");
          setLoadedKey(requestKey);
        },
        (cause: unknown) => {
          if (cancelled) return;
          setLoadError(cause instanceof Error ? cause.message : "無法載入代碼。");
          setLoadedKey(requestKey);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [taskId, requestKey]);

  const counts = useMemo(() => {
    const result = { active: 0, disabled: 0, expired: 0, used: 0 };
    for (const item of items) {
      result[item.status] += 1;
      if (item.session) result.used += 1;
    }
    return result;
  }, [items]);

  const selectedIds = [...selected];
  const selectedUsed = items.filter(
    (item) => selected.has(item.id) && item.session,
  ).length;
  const allSelected = items.length > 0 && selected.size === items.length;

  async function run(payload: Record<string, unknown>, describe: (result: Record<string, unknown>) => string) {
    setNotice("");
    const result = await action(payload);
    if (result) setNotice(describe(result));
    load();
    return result;
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function update(
    codeIds: string[],
    operation: "disable" | "enable" | "set_expiry",
    expiresAt: string | null = null,
  ) {
    await run(
      { action: "update_codes", taskId, codeIds, operation, expiresAt },
      (result) => `已更新 ${String(result.updated ?? 0)} 組代碼。`,
    );
  }

  async function remove(codeIds: string[]) {
    const used = items.filter((item) => codeIds.includes(item.id) && item.session).length;
    const message =
      used > 0
        ? `要刪除 ${codeIds.length - used} 組未使用的代碼嗎？\n其中 ${used} 組已有學生使用，會保留（可改為停用）。`
        : `要永久刪除 ${codeIds.length} 組代碼嗎？刪除後無法復原。`;
    if (!window.confirm(message)) return;
    const result = await run(
      { action: "delete_codes", taskId, codeIds },
      (result) =>
        `已刪除 ${String(result.deleted ?? 0)} 組代碼` +
        (Number(result.skipped ?? 0) > 0
          ? `；${String(result.skipped)} 組已被學生使用，未刪除。`
          : "。"),
    );
    if (result) setSelected(new Set());
  }

  if (!tasksWithCodes.length) {
    return (
      <div className="admin-card">
        <p style={{ margin: 0 }}>請先在「研究任務」發布一個任務，才能產生學生代碼。</p>
      </div>
    );
  }

  return (
    <div className="section-stack">
      <div className="admin-card section-stack">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="codes-task">任務</label>
          <select
            id="codes-task"
            className="select"
            value={taskId}
            onChange={(event) => {
              setTaskId(event.target.value);
              setSelected(new Set());
              setNotice("");
            }}
          >
            {tasksWithCodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · v{item.version} · {item.status}
              </option>
            ))}
          </select>
        </div>

        {task?.status === "published" ? (
          <form
            className="stage-panel-row"
            style={{ alignItems: "flex-end", flexWrap: "wrap" }}
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(
                {
                  action: "generate_codes",
                  taskId,
                  count,
                  expiresAt: localInputToIso(generateExpiry),
                },
                (result) =>
                  `已產生 ${Array.isArray(result.codes) ? result.codes.length : 0} 組代碼。`,
              );
              if (result && Array.isArray(result.codes)) {
                setCodes(result.codes as Array<{ code: string; label: string }>);
              }
            }}
          >
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="codes-count">數量</label>
              <input
                id="codes-count"
                className="input"
                type="number"
                min={1}
                max={MAX_CODE_BATCH}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                required
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="codes-expiry">有效期限（選填）</label>
              <input
                id="codes-expiry"
                className="input"
                type="datetime-local"
                value={generateExpiry}
                onChange={(event) => setGenerateExpiry(event.target.value)}
              />
            </div>
            <button className="button" type="submit">
              <Users size={15} />
              產生代碼
            </button>
          </form>
        ) : (
          <small>此任務不是已發布狀態，只能管理既有代碼，不能產生新代碼。</small>
        )}
      </div>

      <div className="admin-card section-stack">
        <div className="stage-panel-row" style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
          <span>
            共 {items.length} 組 · 有效 {counts.active} · 已停用 {counts.disabled} · 已過期{" "}
            {counts.expired} · 已使用 {counts.used}
          </span>
          <div className="stage-panel-row" style={{ flexWrap: "wrap" }}>
            <button className="button secondary compact" type="button" onClick={load}>
              <RefreshCw size={14} />
              重新整理
            </button>
            <button
              className="button danger-outline compact"
              type="button"
              disabled={counts.active + counts.expired === 0}
              onClick={() => {
                if (
                  window.confirm(
                    "要停用此任務的所有代碼嗎？所有學生會立即無法登入或繼續作答（已存資料保留，之後可重新啟用）。",
                  )
                ) {
                  void run(
                    { action: "disable_task_codes", taskId },
                    (result) => `已停用 ${String(result.updated ?? 0)} 組代碼。`,
                  );
                }
              }}
            >
              <Ban size={14} />
              停用此任務全部代碼
            </button>
          </div>
        </div>

        {/* Always rendered (disabled when empty) so ticking a box never shifts the table. */}
        <div className={`bulk-bar ${selected.size ? "active" : ""}`}>
          <strong>{selected.size ? `已選 ${selected.size} 組` : "勾選代碼以批次操作"}</strong>
          <button
            className="button secondary compact"
            type="button"
            disabled={!selected.size}
            onClick={() => void update(selectedIds, "disable")}
          >
            <Ban size={14} />
            停用
          </button>
          <button
            className="button secondary compact"
            type="button"
            disabled={!selected.size}
            onClick={() => void update(selectedIds, "enable")}
          >
            <CheckCircle2 size={14} />
            啟用
          </button>
          <input
            aria-label="所選代碼的新有效期限"
            className="input"
            type="datetime-local"
            value={bulkExpiry}
            disabled={!selected.size}
            onChange={(event) => setBulkExpiry(event.target.value)}
            style={{ width: "auto" }}
          />
          <button
            className="button secondary compact"
            type="button"
            disabled={!selected.size}
            onClick={() => void update(selectedIds, "set_expiry", localInputToIso(bulkExpiry))}
          >
            <CalendarClock size={14} />
            {bulkExpiry ? "設定期限" : "清除期限"}
          </button>
          <button
            className="button danger-outline compact"
            type="button"
            disabled={!selected.size || selectedUsed === selected.size}
            title={
              selected.size && selectedUsed === selected.size
                ? "已使用的代碼只能停用，不能刪除"
                : undefined
            }
            onClick={() => void remove(selectedIds)}
          >
            <Trash2 size={14} />
            刪除
          </button>
        </div>

        {notice ? <div className="success-banner">{notice}</div> : null}
        {loadError ? <div className="error-banner">{loadError}</div> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全選"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
                    }
                  />
                </th>
                <th>學生標籤</th>
                <th>狀態</th>
                <th>有效期限</th>
                <th>學生進度</th>
                <th>建立時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`選取 ${item.label ?? item.id}`}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </td>
                  <td>
                    <strong>{item.label ?? "未命名"}</strong>
                  </td>
                  <td>
                    <span className={`tag ${item.status === "active" ? "success" : item.status === "disabled" ? "danger" : "muted"}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  <td>{formatDate(item.expiresAt)}</td>
                  <td>
                    {item.session
                      ? item.session.completed
                        ? "已完成"
                        : `進行中：${stageLabel(item.session.currentStage)}`
                      : "未使用"}
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="table-action-list">
                      {item.disabledAt ? (
                        <button className="button secondary compact" type="button" onClick={() => void update([item.id], "enable")}>
                          啟用
                        </button>
                      ) : (
                        <button className="button secondary compact" type="button" onClick={() => void update([item.id], "disable")}>
                          停用
                        </button>
                      )}
                      {item.session ? null : (
                        <button className="button danger-outline compact" type="button" onClick={() => void remove([item.id])}>
                          刪除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {loading && !items.length ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty-state">載入中…</div>
                  </td>
                </tr>
              ) : null}
              {!items.length && !loading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty-state">此任務尚未產生代碼。</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <small>
          已有學生使用的代碼只能停用，不能刪除，以免連帶刪除研究資料。停用或過期的代碼會立即中止該學生的存取；重新啟用後可從原進度繼續。
        </small>
      </div>
    </div>
  );
}
