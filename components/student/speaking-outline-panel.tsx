"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  conceptMapSchema,
  type ConceptMap,
  type SentenceScaffold,
} from "@/lib/ai/schemas";
import {
  microMap,
  outlineSchemaForMap,
  validSpeakingOutline,
  type SpeakingOutline,
  type SpeakingSection,
} from "@/lib/domain/speaking-outline";
import type { SessionView } from "@/lib/services/session-service";
import { ConceptMapCard } from "@/components/student/concept-map-card";
import {
  SPEAKING_TEMPLATES,
  type SpeakingTemplate,
} from "@/lib/domain/speaking-templates";

type Perform = (body: Record<string, unknown>) => Promise<SessionView | null>;

export function MacroMicroCard({
  map,
  outline,
  paragraphHints,
  initialSectionId,
  initialMode = "macro_micro",
  onNavigate,
  onSave,
  hintVersion,
  speakingTemplate,
  informationGaps = [],
  organization,
}: {
  speakingTemplate?: SpeakingTemplate;
  informationGaps?: string[];
  organization?: string;
  hintVersion?: string;
  map: ConceptMap;
  outline: SpeakingOutline;
  paragraphHints?: SentenceScaffold["paragraphHints"];
  initialSectionId?: string;
  initialMode?: "single" | "macro_micro";
  onNavigate?: (
    sectionId: string,
    mode: "single" | "macro_micro",
    hintsVisible: boolean,
  ) => void;
  onSave?: (sections: SpeakingSection[]) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(initialMode);
  const [selectedId, setSelectedId] = useState(
    initialSectionId ?? outline.sections[0].id,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(outline.sections);
  const [saving, setSaving] = useState(false);
  const section =
    outline.sections.find((item) => item.id === selectedId) ??
    outline.sections[0];
  const index = outline.sections.indexOf(section);
  const submap = microMap(map, section);
  const hint = paragraphHints?.find((item) => item.sectionId === section.id);
  const validation = outlineSchemaForMap(map).safeParse({ sections: draft });
  const hintsVisible = mode === "macro_micro" && Boolean(hint);
  const navigationRef = useRef(onNavigate);
  useEffect(() => {
    navigationRef.current = onNavigate;
  }, [onNavigate]);
  useEffect(() => {
    navigationRef.current?.(section.id, mode, hintsVisible);
  }, [section.id, mode, hintVersion, hintsVisible]);

  function select(id: string, nextMode = mode) {
    setSelectedId(id);
    setMode(nextMode);
  }
  function move(index: number, offset: number) {
    setDraft((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  function update(index: number, patch: Partial<SpeakingSection>) {
    setDraft((current) =>
      current.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  }

  return (
    <section className="speaking-outline" aria-label="Macro／Micro 講述架構">
      <div className="speaking-outline-heading">
        <div>
          <p className="eyebrow">My speaking plan</p>
          <h3>
            {speakingTemplate?.id === "chronological"
              ? "把過程排成清楚的順序"
              : "把想法排成一段故事"}
          </h3>
          {speakingTemplate ? (
            <span className="tag">
              {SPEAKING_TEMPLATES[speakingTemplate.id].label}
              {organization === "procedural"
                ? " · 實作步驟"
                : organization === "chronological"
                  ? " · 事件先後"
                  : ""}
            </span>
          ) : null}
        </div>
        <div
          className="speaking-view-switch"
          role="group"
          aria-label="概念圖顯示方式"
        >
          <button
            type="button"
            aria-pressed={mode === "single"}
            onClick={() => select(section.id, "single")}
          >
            單層概念圖
          </button>
          <button
            type="button"
            aria-pressed={mode === "macro_micro"}
            onClick={() => select(section.id, "macro_micro")}
          >
            Macro／Micro 雙層圖
          </button>
        </div>
      </div>
      {informationGaps.length ? (
        <aside
          className="speaking-information-gaps"
          role="note"
          aria-label="待補充提醒"
        >
          <strong>建立架構時的待補充提醒</strong>
          <ul>
            {informationGaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
          <small>確認後可補充概念圖，再重新安排段落。</small>
        </aside>
      ) : null}
      {mode === "single" ? (
        <ConceptMapCard map={map} title="我確認後的完整概念圖" />
      ) : (
        <>
          <p className="panel-hint">
            {speakingTemplate?.id === "chronological"
              ? "依已確認的先後安排講述；選一段，Micro 會顯示這個步驟或事件的細節。"
              : "Macro 決定先說什麼、再說什麼；選一段，Micro 會顯示這一段要說的細節。"}
          </p>
          <ol className="macro-sequence" aria-label="Macro 講述順序">
            {outline.sections.map((item, position) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === section.id}
                  onClick={() => select(item.id)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "ArrowRight"
                        ? Math.min(outline.sections.length - 1, position + 1)
                        : event.key === "ArrowLeft"
                          ? Math.max(0, position - 1)
                          : -1;
                    if (next >= 0) {
                      event.preventDefault();
                      select(outline.sections[next].id);
                      event.currentTarget
                        .closest("ol")
                        ?.querySelectorAll("button")
                        [next]?.focus();
                    }
                  }}
                >
                  <span>{position + 1}</span>
                  <strong>{item.titleZh}</strong>
                  <small>{item.titleEn}</small>
                </button>
              </li>
            ))}
          </ol>
          <div className="micro-workspace" data-many={submap.nodes.length > 2}>
            <div>
              <ConceptMapCard
                map={submap}
                title={`Micro：${section.titleZh}`}
              />
              <div className="micro-relations" aria-label="Micro 中文關係">
                {submap.edges.map((edge) => (
                  <p key={edge.id}>
                    {
                      submap.nodes.find((node) => node.id === edge.from)
                        ?.labelZh
                    }{" "}
                    → <strong>{edge.relationZh}</strong> →{" "}
                    {submap.nodes.find((node) => node.id === edge.to)?.labelZh}
                  </p>
                ))}
              </div>
            </div>
            <aside
              className="paragraph-hints"
              aria-label="這一段的英文提示"
              aria-live="polite"
            >
              <span className="tag">
                第 {index + 1} 段 · {section.titleZh}
              </span>
              {hint ? (
                <>
                  <h4>英文關鍵詞</h4>
                  <div className="chip-list">
                    {hint.keywords.map((word) => (
                      <span className="chip" key={word.word}>
                        <strong>{word.word}</strong> · {word.translation}
                      </span>
                    ))}
                  </div>
                  <h4>句首提示</h4>
                  <p className="paragraph-starter">{hint.sentenceStart}</p>
                  <small>用你自己的細節，把這一句接下去。</small>
                </>
              ) : (
                <p className="panel-hint">
                  先寫下自己的句子並取得提示，這裡就會同步顯示這一段的英文關鍵詞與句首。
                </p>
              )}
            </aside>
          </div>
          <div className="speaking-outline-footer">
            <button
              className="button secondary"
              type="button"
              disabled={index === 0}
              onClick={() => select(outline.sections[index - 1].id)}
            >
              <ChevronLeft size={16} />
              上一段
            </button>
            <span>
              {index + 1} / {outline.sections.length}
            </span>
            <button
              className="button secondary"
              type="button"
              disabled={index === outline.sections.length - 1}
              onClick={() => select(outline.sections[index + 1].id)}
            >
              下一段
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      )}
      {onSave ? (
        <div className="outline-editor">
          {!editing ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setDraft(outline.sections);
                setEditing(true);
              }}
            >
              調整段落名稱與順序
            </button>
          ) : (
            <>
              <p className="panel-hint">
                安排每段要談的概念，也可以調整名稱與順序。更新後需重新取得提示，已保存的句子會保留。
              </p>
              {draft.map((item, position) => (
                <div className="outline-edit-row" key={item.id}>
                  <div className="outline-edit-fields">
                    <label>
                      第 {position + 1} 段名稱
                      <input
                        className="input"
                        aria-label={`第 ${position + 1} 段中文名稱`}
                        value={item.titleZh}
                        maxLength={80}
                        onChange={(event) =>
                          update(position, { titleZh: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      英文名稱
                      <input
                        className="input"
                        aria-label={`第 ${position + 1} 段英文名稱`}
                        value={item.titleEn}
                        maxLength={80}
                        onChange={(event) =>
                          update(position, { titleEn: event.target.value })
                        }
                      />
                    </label>
                    <div className="outline-edit-actions">
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`上移第 ${position + 1} 段`}
                        disabled={saving || position === 0}
                        onClick={() => move(position, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`下移第 ${position + 1} 段`}
                        disabled={saving || position === draft.length - 1}
                        onClick={() => move(position, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`刪除第 ${position + 1} 段`}
                        disabled={saving || draft.length === 1}
                        onClick={() =>
                          setDraft(
                            draft.filter((_, index) => index !== position),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <fieldset className="outline-concepts">
                    <legend>這段要談的概念</legend>
                    {map.nodes.map((node) => (
                      <label key={node.id}>
                        <input
                          type="checkbox"
                          checked={item.nodeIds.includes(node.id)}
                          onChange={(event) =>
                            update(position, {
                              nodeIds: event.target.checked
                                ? [...item.nodeIds, node.id]
                                : item.nodeIds.filter((id) => id !== node.id),
                            })
                          }
                        />
                        {node.labelZh} · {node.labelEn}
                      </label>
                    ))}
                  </fieldset>
                </div>
              ))}
              {!validation.success ? (
                <p className="error-banner" role="status">
                  {validation.error.issues[0].message}
                </p>
              ) : null}
              <div className="stage-panel-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving || draft.length >= 6}
                  onClick={() =>
                    setDraft([
                      ...draft,
                      {
                        id: crypto.randomUUID(),
                        titleZh: "新段落",
                        titleEn: "New section",
                        nodeIds: [map.nodes[0].id],
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  新增段落
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={saving || !validation.success}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      if (await onSave(draft)) setEditing(false);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "正在保存…" : "保存講述順序"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SpeakingOutlinePanel({
  view,
  perform,
  hintsReady = false,
}: {
  view: SessionView;
  perform: Perform;
  hintsReady?: boolean;
}) {
  const [building, setBuilding] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const navigationQueue = useRef<Promise<void>>(Promise.resolve());
  function track(
    sectionId: string,
    mode: "single" | "macro_micro",
    hintsVisible: boolean,
  ) {
    const body = {
      action: "speaking_navigation",
      sectionId,
      mode,
      hintsVisible,
      idempotencyKey: crypto.randomUUID(),
    };
    navigationQueue.current = navigationQueue.current.then(async () => {
      try {
        const response = await fetch("/api/student/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Navigation not saved");
      } catch {
        setTrackingError("段落瀏覽紀錄暫時未同步，重新整理後可重試。");
      }
    });
  }
  const decisions = view.artifacts.find(
    (item) => item.type === "concept_decisions",
  );
  const parsed = conceptMapSchema.safeParse(decisions?.data.accepted);
  if (
    !parsed.success ||
    !parsed.data.nodes.length ||
    !Array.isArray(decisions?.data.pending) ||
    decisions.data.pending.length
  )
    return null;
  const map = parsed.data;
  const saved = view.artifacts.find((item) => item.type === "speaking_outline");
  const template = view.task.config.speakingTemplate;
  const outline = validSpeakingOutline(saved?.data, map, template ?? null);
  const progress = view.artifacts.find(
    (item) =>
      item.type === "speaking_progress" &&
      item.stageId === view.session.currentStage,
  );
  const scaffold = view.artifacts.find(
    (item) => item.type === "sentence_scaffold",
  );
  const hints =
    hintsReady && scaffold?.data.speakingOutlineId === saved?.id
      ? (scaffold?.data.paragraphHints as SentenceScaffold["paragraphHints"])
      : undefined;
  return (
    <div className="speaking-outline-panel">
      {trackingError ? (
        <p className="error-banner" role="status">
          {trackingError}
        </p>
      ) : null}
      {outline ? (
        <MacroMicroCard
          key={saved!.id}
          map={map}
          outline={outline}
          speakingTemplate={template}
          organization={
            typeof saved?.data.organization === "string"
              ? saved.data.organization
              : undefined
          }
          informationGaps={
            Array.isArray(saved?.data.informationGaps)
              ? saved.data.informationGaps.filter(
                  (item): item is string => typeof item === "string",
                )
              : []
          }
          paragraphHints={hints}
          hintVersion={hints ? scaffold?.id : undefined}
          initialSectionId={
            typeof progress?.data.sectionId === "string"
              ? progress.data.sectionId
              : undefined
          }
          initialMode={
            progress?.data.mode === "single" ? "single" : "macro_micro"
          }
          onNavigate={(sectionId, mode, hintsVisible) => {
            void track(sectionId, mode, hintsVisible);
          }}
          onSave={async (sections) =>
            Boolean(
              await perform({ action: "save_speaking_outline", sections }),
            )
          }
        />
      ) : (
        <div className="artifact-card">
          <div className="artifact-card-body">
            <h3>安排你的 Macro／Micro 講述架構</h3>
            {template ? (
              <p className="tag">{SPEAKING_TEMPLATES[template.id].label}</p>
            ) : null}
            <p className="panel-hint">
              讓 AI
              依你已確認的概念安排段落，再由你調整名稱與順序。每一段都會連到自己的
              Micro 細節。
            </p>
            {saved ? (
              <p className="panel-hint">
                概念圖或講述模板已更新，請依目前的內容重新安排段落。
              </p>
            ) : null}
          </div>
        </div>
      )}
      <button
        className="button secondary"
        type="button"
        disabled={building}
        onClick={async () => {
          if (
            outline &&
            !window.confirm(
              "重新安排會取代目前的段落，並需要重新取得提示。要繼續嗎？",
            )
          )
            return;
          setBuilding(true);
          try {
            await perform({ action: "build_speaking_outline" });
          } finally {
            setBuilding(false);
          }
        }}
      >
        {building ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Sparkles size={16} />
        )}
        {building
          ? "正在安排講述段落…"
          : outline
            ? "重新安排段落"
            : "建立 Macro／Micro 講述架構"}
      </button>
    </div>
  );
}
