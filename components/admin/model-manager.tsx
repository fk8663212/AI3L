"use client";

import { CheckCircle2, LoaderCircle, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { adminOverview } from "@/lib/services/admin-service";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type Action = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
type Provider = "google" | "openai";

const PROVIDER_NAMES: Record<string, string> = { google: "Google Gemini", openai: "OpenAI" };

type TestState = { status: "running" } | { status: "ok"; latencyMs: number } | { status: "failed"; message: string };

const emptyForm = { provider: "google" as Provider, modelId: "", displayName: "", image: true, audio: false };

export function ModelManager({ data, action }: { data: Overview; action: Action }) {
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [notice, setNotice] = useState("");

  const usage = (provider: string, modelId: string) => {
    const using = data.tasks.filter((task) => task.provider === provider && task.modelId === modelId);
    return {
      total: using.length,
      published: using.filter((task) => task.status === "published").length,
    };
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    const result = await action({
      action: "add_model",
      provider: form.provider,
      modelId: form.modelId.trim(),
      displayName: form.displayName.trim(),
      image: form.image,
      audio: form.audio,
    });
    if (result) {
      setNotice(editing ? "模型已更新。" : "模型已新增，建議按「測試」確認 API Key 可以使用它。");
      setForm(emptyForm);
      setEditing(null);
    }
  }

  async function test(provider: string, modelId: string) {
    const key = `${provider}:${modelId}`;
    setTests((current) => ({ ...current, [key]: { status: "running" } }));
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test_model", provider, modelId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "測試失敗。");
      setTests((current) => ({ ...current, [key]: { status: "ok", latencyMs: payload.data.latencyMs } }));
    } catch (cause) {
      setTests((current) => ({
        ...current,
        [key]: { status: "failed", message: cause instanceof Error ? cause.message : "測試失敗。" },
      }));
    }
  }

  function edit(model: Overview["models"][number]) {
    setEditing(`${model.provider}:${model.modelId}`);
    setForm({
      provider: model.provider as Provider,
      modelId: model.modelId,
      displayName: model.displayName,
      image: Boolean(model.capabilities.image),
      audio: Boolean(model.capabilities.audio),
    });
    setNotice("");
  }

  return (
    <div className="admin-card section-stack">
      <div className="card-heading">
        <h2>模型管理</h2>
        <small>任務發布時會鎖定所選模型；要換模型，請在「研究任務」建立新版本草稿。</small>
      </div>

      <form className="model-form" onSubmit={submit}>
        <label className="field">
          <span>供應商</span>
          <select
            className="select"
            value={form.provider}
            disabled={Boolean(editing)}
            onChange={(event) => setForm({ ...form, provider: event.target.value as Provider })}
          >
            <option value="google">Google Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="field">
          <span>Model ID</span>
          <input
            className="input"
            value={form.modelId}
            disabled={Boolean(editing)}
            onChange={(event) => setForm({ ...form, modelId: event.target.value })}
            placeholder="例如：gemini-3.6-flash"
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>顯示名稱</span>
          <input
            className="input"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="例如：Gemini 3.6 Flash"
            maxLength={120}
            required
          />
        </label>
        <fieldset className="model-capabilities">
          <legend>能力</legend>
          <label>
            <input type="checkbox" checked={form.image} onChange={(event) => setForm({ ...form, image: event.target.checked })} />
            圖片（第 4、5 階段必要）
          </label>
          <label>
            <input type="checkbox" checked={form.audio} onChange={(event) => setForm({ ...form, audio: event.target.checked })} />
            音訊（Gemini 錄音分析必要）
          </label>
        </fieldset>
        <div className="model-form-actions">
          <button className="button" type="submit">
            {editing ? <CheckCircle2 size={16} /> : <Plus size={16} />}
            {editing ? "儲存變更" : "新增模型"}
          </button>
          {editing ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(emptyForm);
              }}
            >
              取消
            </button>
          ) : null}
        </div>
      </form>
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>供應商</th>
              <th>名稱</th>
              <th>Model ID</th>
              <th>能力</th>
              <th>使用中的任務</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((model) => {
              const key = `${model.provider}:${model.modelId}`;
              const used = usage(model.provider, model.modelId);
              const testState = tests[key];
              return (
                <tr key={model.id}>
                  <td>{PROVIDER_NAMES[model.provider] ?? model.provider}</td>
                  <td>
                    <strong>{model.displayName}</strong>
                    {model.isPreset ? <small className="muted"> · 內建</small> : null}
                  </td>
                  <td>
                    <code>{model.modelId}</code>
                  </td>
                  <td>
                    {[model.capabilities.image ? "圖片" : null, model.capabilities.audio ? "音訊" : null, "結構化輸出"]
                      .filter(Boolean)
                      .join("、")}
                  </td>
                  <td>
                    {used.total ? `${used.total} 個${used.published ? `（${used.published} 已發布）` : ""}` : "—"}
                  </td>
                  <td>
                    <span className={`tag ${model.enabled ? "success" : "muted"}`}>{model.enabled ? "啟用" : "停用"}</span>
                    {testState ? (
                      <div className={`model-test ${testState.status}`} role="status">
                        {testState.status === "running" ? (
                          <>
                            <LoaderCircle className="spin" size={13} /> 測試中…
                          </>
                        ) : testState.status === "ok" ? (
                          `可以使用 · ${testState.latencyMs} ms`
                        ) : (
                          testState.message
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="table-action-list">
                      <button
                        className="button secondary compact"
                        type="button"
                        disabled={testState?.status === "running"}
                        onClick={() => void test(model.provider, model.modelId)}
                      >
                        <Zap size={14} />
                        測試
                      </button>
                      <button className="button secondary compact" type="button" onClick={() => edit(model)}>
                        <Pencil size={14} />
                        編輯
                      </button>
                      <button
                        className="button secondary compact"
                        type="button"
                        disabled={model.enabled && used.published > 0}
                        title={model.enabled && used.published > 0 ? "已發布任務正在使用，不能停用" : undefined}
                        onClick={() =>
                          void action({
                            action: "set_model_enabled",
                            provider: model.provider,
                            modelId: model.modelId,
                            enabled: !model.enabled,
                          })
                        }
                      >
                        {model.enabled ? "停用" : "啟用"}
                      </button>
                      {!model.isPreset && used.total === 0 ? (
                        <button
                          className="button danger-outline compact"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`要刪除模型「${model.displayName}」嗎？`)) {
                              void action({ action: "delete_model", provider: model.provider, modelId: model.modelId });
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          刪除
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="muted">
        停用的模型不會出現在任務編輯的選單中。已發布任務正在使用的模型不能停用；內建或曾被任務使用過的模型不能刪除，只能停用。
      </small>
    </div>
  );
}
