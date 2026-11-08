"use client";

import { SpeakingOutlinePanel } from "@/components/student/speaking-outline-panel";
import { validSpeakingOutline } from "@/lib/domain/speaking-outline";

import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  Lock,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  annotatedImageSchema,
  conceptMapSchema,
  imageAnalysisSchema,
  sentenceScaffoldSchema,
  type SentenceHint,
} from "@/lib/ai/schemas";
import { stageChecklist } from "@/lib/domain/stage-checklist";
import { STAGES, type StageId } from "@/lib/domain/stages";
import type {
  ArtifactView,
  SessionView,
} from "@/lib/services/session-service";
import { AudioRecorder } from "@/components/student/audio-recorder";
import { AnnotatedImageCard } from "@/components/student/annotated-image-card";
import { ConceptMapCard } from "@/components/student/concept-map-card";
import { ConceptMapEditor } from "@/components/student/concept-map-editor";
import { ImageUploader } from "@/components/student/image-uploader";
import { StageStepper } from "@/components/student/stage-stepper";
import { UploadedImageCard } from "@/components/student/uploaded-image-card";

type Perform = (body: Record<string, unknown>) => Promise<SessionView | null>;

function artifact(
  view: SessionView,
  stageId: StageId,
  type: string,
): ArtifactView | undefined {
  return view.artifacts.find(
    (item) => item.stageId === stageId && item.type === type,
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function StepHeading({ step, title, done }: { step: number; title: string; done?: boolean }) {
  return (
    <div className={`step-heading ${done ? "done" : ""}`}>
      <span className="step-number">{done ? <Check size={13} /> : step}</span>
      <strong>{title}</strong>
    </div>
  );
}

// ---- History (earlier stages only) ------------------------------------------

type HistoryEntry = {
  id: string;
  createdAt: string;
  node: ReactNode;
};

function vocabularyChips(content: Record<string, unknown>) {
  const decisions = Array.isArray(content.decisions)
    ? (content.decisions as Array<{ status?: string; labelEn?: string; labelZh?: string }>)
    : [];
  const kept = decisions.filter((item) => item.status !== "rejected");
  return (
    <div className="chip-list">
      {kept.map((item) => (
        <span className="chip" key={`${item.labelEn}-${item.labelZh}`}>
          {item.labelEn} · {item.labelZh}
        </span>
      ))}
    </div>
  );
}

function historyEntries(view: SessionView, stageId: StageId): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const message of view.messages.filter((item) => item.stageId === stageId)) {
    const content = message.content;
    let node: ReactNode = null;
    if (message.kind === "labels") {
      node = (
        <>
          <span className="history-label">我知道的英文詞</span>
          <div className="chip-list">
            {stringArray(content.labels).map((label) => (
              <span className="chip" key={label}>{label}</span>
            ))}
          </div>
        </>
      );
    } else if (message.kind === "vocabulary_decisions") {
      node = (
        <>
          <span className="history-label">我保留的詞彙</span>
          {vocabularyChips(content)}
        </>
      );
    } else if (message.kind === "concept_decisions") {
      const parsed = conceptMapSchema.safeParse(content.accepted);
      node = parsed.success ? <ConceptMapCard map={parsed.data} title="我確認後的概念圖" /> : null;
    } else if (message.kind === "sentences") {
      node = (
        <>
          <span className="history-label">我寫的句子</span>
          <ul className="history-sentences">
            {stringArray(content.sentences).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </>
      );
    }
    // AI messages (scaffolds, generated maps) are summarised by the student's
    // own decisions above, so they are not repeated here.
    if (node) entries.push({ id: message.id, createdAt: message.createdAt, node });
  }

  for (const item of view.artifacts.filter((row) => row.stageId === stageId)) {
    if (item.type === "image" && item.downloadUrl) {
      entries.push({
        id: item.id,
        createdAt: item.createdAt,
        node: (
          <>
            <span className="history-label">
              {stageId === "self_concept_map" ? "我的手繪概念圖" : "我的手繪情境圖"}
            </span>
            {/* Private authenticated route; Next/Image optimisation is intentionally skipped. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="history-image" src={item.downloadUrl} alt={stageId === "self_concept_map" ? "我的手繪概念圖" : "我的手繪情境圖"} />
          </>
        ),
      });
    } else if (item.type === "audio" && item.downloadUrl) {
      entries.push({
        id: item.id,
        createdAt: item.createdAt,
        node: (
          <>
            <span className="history-label">我的錄音</span>
            <audio controls src={item.downloadUrl}>
              <track kind="captions" />
            </audio>
          </>
        ),
      });
    } else if (item.type === "annotated_image") {
      const parsed = annotatedImageSchema.safeParse(item.data);
      const source = parsed.success
        ? view.artifacts.find((candidate) => candidate.id === parsed.data.sourceImageArtifactId)
        : undefined;
      if (parsed.success && source?.downloadUrl) {
        entries.push({
          id: item.id,
          createdAt: item.createdAt,
          node: <AnnotatedImageCard sourceUrl={source.downloadUrl} annotated={parsed.data} />,
        });
      }
    }
  }
  return entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function LearningHistory({ view, open }: { view: SessionView; open: boolean }) {
  const stages = STAGES.filter(
    (stage) =>
      view.session.completed || stage.order < (STAGES.find((item) => item.id === view.session.currentStage)?.order ?? 0),
  )
    .map((stage) => ({ stage, entries: historyEntries(view, stage.id) }))
    .filter((group) => group.entries.length);

  if (view.concealPriorStages) {
    return (
      <div className="info-banner history-locked">
        <Lock size={15} aria-hidden="true" /> 為了測量你獨立說英文的能力，先前的作品與 AI 提示暫時隱藏；完成後測後就會再次顯示。
      </div>
    );
  }
  if (!stages.length) return null;
  const total = stages.reduce((sum, group) => sum + group.entries.length, 0);
  return (
    <details className="learning-history" open={open}>
      <summary>
        <span>我的學習紀錄</span>
        <small>先前 {stages.length} 個階段 · {total} 項作品</small>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      {stages.map(({ stage, entries }) => (
        <section className="history-stage" key={stage.id}>
          <h3>
            <span>{stage.order}</span>
            {stage.title}
          </h3>
          {entries.map((entry) => (
            <div className="history-item" key={entry.id}>
              {entry.node}
            </div>
          ))}
        </section>
      ))}
    </details>
  );
}

// ---- Consent -----------------------------------------------------------------

function ConsentPanel({ text, perform }: { text: string; perform: Perform }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="consent-card">
      <h3>開始前，請先閱讀資料說明</h3>
      <p>{text}</p>
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>我已閱讀並同意以上說明。</span>
      </label>
      <button
        className="button"
        style={{ marginTop: 16 }}
        type="button"
        disabled={!checked}
        onClick={() => perform({ action: "consent", accepted: true })}
      >
        <Check size={17} />
        同意並開始
      </button>
    </div>
  );
}

// ---- Stage panels ------------------------------------------------------------

function AudioStagePanel({
  view,
  onSaved,
  prompt,
}: {
  view: SessionView;
  onSaved: (view: SessionView) => void;
  prompt: string;
}) {
  const config = view.task.config.stageConfig[view.session.currentStage];
  const saved = artifact(view, view.session.currentStage, "audio");
  return (
    <div className="stage-panel">
      {saved ? (
        <div className="success-banner">
          <CheckCircle2 size={16} aria-hidden="true" /> 錄音已保存。每個階段只需要一段錄音。
        </div>
      ) : (
        <>
          <p className="panel-hint">{prompt}</p>
          <AudioRecorder
            stage={view.session.currentStage}
            sessionId={view.session.id}
            minimumSeconds={config.minimumRecordingSeconds}
            maximumSeconds={config.maximumRecordingSeconds}
            onSaved={onSaved}
          />
        </>
      )}
    </div>
  );
}

function VisualizationPanel({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  const image = artifact(view, "visualization", "image");
  const savedLabels = stringArray(artifact(view, "visualization", "self_labels")?.data.labels);
  const [labelsText, setLabelsText] = useState(savedLabels.join(", "));
  const labels = [...new Set(labelsText.split(/[,\n，、]/).map((label) => label.trim()).filter(Boolean))];
  const unsaved = !sameList(labels, savedLabels);

  return (
    <div className="stage-panel">
      <StepHeading step={1} title="上傳你的手繪情境圖" done={Boolean(image)} />
      {!image ? (
        <ImageUploader sessionId={view.session.id} stage="visualization" onSaved={onSaved} />
      ) : (
        <UploadedImageCard artifact={image} title="我的手繪情境圖" alt="學生上傳的手繪情境圖" onDeleted={onSaved} />
      )}

      <StepHeading step={2} title="寫下至少 3 個你原本就知道的英文詞" done={savedLabels.length >= 3 && !unsaved} />
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="self-labels">用逗號或換行分開，不要查字典</label>
        <textarea
          id="self-labels"
          className="textarea"
          value={labelsText}
          onChange={(event) => setLabelsText(event.target.value)}
          placeholder="例如：lantern, pineapple cake, visitors"
        />
      </div>
      <div className="stage-panel-row">
        <div className="chip-list" style={{ flex: 1 }}>
          {labels.map((label) => (
            <span className="chip" key={label}>{label}</span>
          ))}
          {labels.length ? <small className="muted">共 {labels.length} 個</small> : null}
        </div>
        <button
          className={unsaved ? "button" : "button secondary"}
          type="button"
          disabled={labels.length === 0 || !unsaved}
          onClick={() => perform({ action: "save_labels", labels, idempotencyKey: crypto.randomUUID() })}
        >
          {unsaved ? "保存英文詞" : savedLabels.length ? "已保存" : "保存英文詞"}
        </button>
      </div>
      {unsaved && savedLabels.length ? (
        <small className="muted">你修改了英文詞，記得再按一次「保存英文詞」。</small>
      ) : null}
    </div>
  );
}

function SelfConceptPanel({ view, onSaved }: { view: SessionView; onSaved: (view: SessionView) => void }) {
  const saved = artifact(view, "self_concept_map", "image");
  return (
    <div className="stage-panel">
      {!saved ? (
        <>
          <p className="panel-hint">
            先在紙上畫：中間寫主題，周圍寫相關的英文詞，用箭頭連起來並在箭頭旁寫關係詞（例如 eat、go to）。畫好後拍照上傳。這一步不使用 AI。
          </p>
          <ImageUploader sessionId={view.session.id} stage="self_concept_map" onSaved={onSaved} />
        </>
      ) : (
        <UploadedImageCard artifact={saved} title="我的手繪概念圖" alt="學生上傳的手繪概念圖" onDeleted={onSaved} />
      )}
    </div>
  );
}

type VocabularyChoice = "accepted" | "edited" | "rejected";

const BACKGROUND_AI_POLL_MS = 4000;
const BACKGROUND_AI_START_GRACE_MS = 3000;

/**
 * Stage 4 and 5 AI results are prepared in the background when the previous
 * stage is submitted. This waits for that run, starts one if none started
 * (or it was for older work), and offers a retry when it failed.
 */
function useBackgroundAI(
  view: SessionView,
  stage: "image_analysis" | "ai_concept_map",
  ready: boolean,
  perform: Perform,
  onSaved: (view: SessionView) => void,
) {
  const status = view.aiStatus[stage];
  const [requesting, setRequesting] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  async function request() {
    setRequesting(true);
    await perform({ action: "run_ai", stage });
    setRequesting(false);
  }

  // The page can arrive a moment before the background run registers, so look
  // once more before starting a run of our own.
  useEffect(() => {
    if (ready || status !== "idle" || autoStarted) return;
    const timer = window.setTimeout(async () => {
      setAutoStarted(true);
      try {
        const response = await fetch("/api/student/session", { cache: "no-store" });
        const payload = response.ok ? await response.json() : null;
        const latest = payload?.data as SessionView | undefined;
        if (latest && latest.aiStatus[stage] !== "idle") {
          onSaved(latest);
          return;
        }
      } catch {
        // Fall through and start the run here.
      }
      void request();
    }, BACKGROUND_AI_START_GRACE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status, autoStarted]);

  useEffect(() => {
    if (ready || status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/student/session", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.data) onSaved(payload.data as SessionView);
      } catch {
        // Try again on the next tick.
      }
    }, BACKGROUND_AI_POLL_MS);
    return () => window.clearInterval(timer);
  }, [ready, status, onSaved]);

  const waiting =
    requesting || status === "running" || (status === "idle" && !autoStarted);
  return { waiting, request: () => void request() };
}

function BackgroundAIWaiting({
  waiting,
  onRetry,
  what,
  retryLabel,
}: {
  waiting: boolean;
  onRetry: () => void;
  what: string;
  retryLabel: string;
}) {
  return (
    <div className="stage-panel">
      {waiting ? (
        <div className="ai-note" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
          <div>
            <strong>AI 正在看{what}</strong>
            <p>通常需要半分鐘左右，完成後會自動顯示在這裡，不用重新整理。</p>
          </div>
        </div>
      ) : (
        <>
          <p className="panel-hint">
            AI 這次沒有完成{what}的分析。請按下面的按鈕再試一次；如果一直失敗，請告訴老師。
          </p>
          <button className="button" type="button" onClick={onRetry}>
            <Sparkles size={17} />
            {retryLabel}
          </button>
        </>
      )}
    </div>
  );
}

function ImageAnalysisPanel({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  const output = artifact(view, "image_analysis", "image_analysis");
  const annotatedOutput = artifact(view, "image_analysis", "annotated_image");
  const sourceImage = artifact(view, "visualization", "image");
  const decisionsArtifact = artifact(view, "image_analysis", "vocabulary_decisions");
  const parsed = imageAnalysisSchema.safeParse(output?.data);
  const annotated = annotatedImageSchema.safeParse(annotatedOutput?.data);
  const preparedForCurrentImage =
    annotated.success && annotated.data.sourceImageArtifactId === sourceImage?.id;
  const reviewed =
    Array.isArray(decisionsArtifact?.data.pending) &&
    decisionsArtifact.data.pending.length === 0 &&
    (Array.isArray(decisionsArtifact.data.accepted) || Array.isArray(decisionsArtifact.data.rejected));
  const [editing, setEditing] = useState(false);
  // No default decision: every AI word must be looked at and decided.
  const [decisions, setDecisions] = useState<
    Record<string, { status?: VocabularyChoice; labelEn: string; labelZh: string }>
  >(() => {
    if (!parsed.success) return {};
    const previous = new Map(
      [
        ...((decisionsArtifact?.data.accepted as Array<{ id: string; status: VocabularyChoice; labelEn: string; labelZh: string }> | undefined) ?? []),
        ...((decisionsArtifact?.data.rejected as Array<{ id: string; status: VocabularyChoice; labelEn: string; labelZh: string }> | undefined) ?? []),
      ].map((item) => [item.id, item]),
    );
    return Object.fromEntries(
      parsed.data.suggestions.map((item) => {
        const before = previous.get(item.id);
        return [
          item.id,
          before
            ? { status: before.status, labelEn: before.labelEn, labelZh: before.labelZh }
            : { labelEn: item.labelEn, labelZh: item.labelZh },
        ];
      }),
    );
  });

  const ready = parsed.success && preparedForCurrentImage && Boolean(sourceImage?.downloadUrl);
  const background = useBackgroundAI(view, "image_analysis", ready, perform, onSaved);

  if (!ready || !parsed.success || !annotated.success || !sourceImage?.downloadUrl) {
    return (
      <BackgroundAIWaiting
        waiting={background.waiting}
        onRetry={background.request}
        what="你的手繪圖"
        retryLabel="重新產生 AI 標記圖"
      />
    );
  }

  const suggestions = parsed.data.suggestions;
  const undecided = suggestions.filter((item) => !decisions[item.id]?.status).length;
  const emptyEdit = suggestions.some(
    (item) => decisions[item.id]?.status === "edited" && !decisions[item.id]?.labelEn.trim(),
  );
  const locked = reviewed && !editing;

  return (
    <div className="stage-panel panel-columns">
      <div className="panel-column">
      <StepHeading step={1} title="看看 AI 在你的圖上標了什麼" done />
      <AnnotatedImageCard sourceUrl={sourceImage.downloadUrl} annotated={annotated.data} />
      <div className="ai-note">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <strong>AI 看到的場景</strong>
          <p>{parsed.data.sceneSummaryZh}</p>
        </div>
      </div>
      </div>

      <div className="panel-column">
      <StepHeading step={2} title="每個詞都要決定：接受、修改或拒絕" done={reviewed} />
      <div className="review-progress" aria-hidden="true">
        <span style={{ width: `${((suggestions.length - undecided) / suggestions.length) * 100}%` }} />
      </div>
      <p className="panel-hint">
        已決定 {suggestions.length - undecided} / {suggestions.length}。只保留真的出現在你的圖或經驗裡的詞，AI 可能會看錯。
      </p>
      <div className="review-list">
        {suggestions.map((item) => {
          const decision = decisions[item.id] ?? { labelEn: item.labelEn, labelZh: item.labelZh };
          return (
            <div className={`review-item ${decision.status ?? "undecided"}`} key={item.id}>
              <div className="review-item-text">
                {decision.status === "edited" && !locked ? (
                  <div className="review-edit-row">
                    <input
                      aria-label={`修改 ${item.labelEn} 的英文`}
                      className="input"
                      value={decision.labelEn}
                      onChange={(event) =>
                        setDecisions((current) => ({ ...current, [item.id]: { ...decision, labelEn: event.target.value } }))
                      }
                    />
                    <input
                      aria-label={`修改 ${item.labelEn} 的中文`}
                      className="input"
                      value={decision.labelZh}
                      onChange={(event) =>
                        setDecisions((current) => ({ ...current, [item.id]: { ...decision, labelZh: event.target.value } }))
                      }
                    />
                  </div>
                ) : (
                  <strong>
                    {decision.labelEn} · {decision.labelZh}
                  </strong>
                )}
                <small>{item.evidence}</small>
              </div>
              <div className="decision-group" role="group" aria-label={`${item.labelEn} 的決定`}>
                {(["accepted", "edited", "rejected"] as const).map((status) => (
                  <button
                    className={decision.status === status ? `selected ${status}` : ""}
                    key={status}
                    type="button"
                    aria-pressed={decision.status === status}
                    disabled={locked}
                    onClick={() =>
                      setDecisions((current) => ({ ...current, [item.id]: { ...decision, status } }))
                    }
                  >
                    {status === "accepted" ? "接受" : status === "edited" ? "修改" : "拒絕"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {locked ? (
        <div className="stage-panel-row">
          <div className="success-banner" style={{ flex: 1 }}>
            <CheckCircle2 size={16} aria-hidden="true" /> 詞彙審核已送出。
          </div>
          <button className="button secondary" type="button" onClick={() => setEditing(true)}>
            修改決定
          </button>
        </div>
      ) : (
        <button
          className="button"
          type="button"
          disabled={undecided > 0 || emptyEdit}
          onClick={async () => {
            const result = await perform({
              action: "review_vocabulary",
              decisions: suggestions.map((item) => ({
                id: item.id,
                status: decisions[item.id]!.status,
                labelEn: decisions[item.id]!.labelEn,
                labelZh: decisions[item.id]!.labelZh,
              })),
            });
            if (result) setEditing(false);
          }}
        >
          {undecided > 0 ? `還有 ${undecided} 個詞沒有決定` : emptyEdit ? "修改的英文不可空白" : "送出詞彙審核"}
        </button>
      )}
      </div>
    </div>
  );
}

type ConceptChoice = "keep" | "remove";

function AIConceptPanel({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  const output =
    artifact(view, "ai_concept_map", "generated_concept_map") ??
    artifact(view, "ai_concept_map", "ai_concept_map");
  const decisionsArtifact = artifact(view, "ai_concept_map", "concept_decisions");
  const parsed = conceptMapSchema.safeParse(output?.data);
  const reviewed =
    Array.isArray(decisionsArtifact?.data.pending) && decisionsArtifact.data.pending.length === 0;
  const [editing, setEditing] = useState(false);
  const [choices, setChoices] = useState<Record<string, ConceptChoice>>(() => {
    if (!reviewed || !parsed.success) return {};
    const rejected = new Set(stringArray(decisionsArtifact?.data.rejectedIds));
    return Object.fromEntries(
      [...parsed.data.nodes, ...parsed.data.edges]
        .filter((item) => item.source === "ai")
        .map((item) => [item.id, rejected.has(item.id) ? "remove" : "keep"]),
    );
  });

  const background = useBackgroundAI(view, "ai_concept_map", parsed.success, perform, onSaved);
  const finalMap = conceptMapSchema.safeParse(decisionsArtifact?.data.accepted);
  const reviewedMap = conceptMapSchema.safeParse(
    decisionsArtifact?.data.reviewAccepted ?? decisionsArtifact?.data.accepted,
  );
  const hasEdits = typeof decisionsArtifact?.data.editedAt === "string";
  const [savingMap, setSavingMap] = useState(false);

  if (!parsed.success) {
    return (
      <BackgroundAIWaiting
        waiting={background.waiting}
        onRetry={background.request}
        what="你的手繪概念圖"
        retryLabel="重新產生擴充概念圖"
      />
    );
  }

  const nodeLabel = (id: string) => {
    const node = parsed.data.nodes.find((item) => item.id === id);
    return node ? node.labelEn : id;
  };
  const aiItems = [...parsed.data.nodes, ...parsed.data.edges].filter((item) => item.source === "ai");
  const removed = new Set(Object.entries(choices).filter(([, value]) => value === "remove").map(([id]) => id));
  const keptNodes = parsed.data.nodes.filter((node) => !removed.has(node.id));
  const keptIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = parsed.data.edges.filter(
    (edge) => !removed.has(edge.id) && keptIds.has(edge.from) && keptIds.has(edge.to),
  );
  // A relation whose concept was removed cannot be kept, so it needs no
  // decision of its own.
  const orphaned = (item: (typeof aiItems)[number]) =>
    !("labelEn" in item) && (removed.has(item.from) || removed.has(item.to));
  const undecided = aiItems.filter((item) => !choices[item.id] && !orphaned(item)).length;
  const locked = reviewed && !editing;

  return (
    <div className="stage-panel panel-columns concept-review-panel">
      <div className="panel-column concept-review-preview">
      <StepHeading step={1} title="比較 AI 的擴充概念圖" done />
      <ConceptMapCard map={{ nodes: keptNodes, edges: keptEdges }} title="擴充概念圖（預覽你的選擇）" />
      </div>

      <div className="panel-column concept-review-decisions">
      <StepHeading step={2} title="審核 AI 新增的概念與關係" done={reviewed} />
      <p className="panel-hint">逐項保留或移除，概念圖會同步更新。藍色是你原有的，橘色是 AI 新增的；移除概念時，相連關係也會一起移除。</p>
      <div className="review-list" tabIndex={0} role="region" aria-label="AI 新增項目審核清單">
        {aiItems.map((item) => {
          const isNode = "labelEn" in item;
          const followsNode = orphaned(item);
          const choice = followsNode ? "remove" : choices[item.id];
          return (
            <div className={`review-item ${choice ?? "undecided"}`} key={item.id}>
              <div className="review-item-text">
                <strong>
                  {isNode ? `${item.labelEn} · ${item.labelZh}` : `${nodeLabel(item.from)} — ${item.relationEn} → ${nodeLabel(item.to)}`}
                </strong>
                <small>
                  {isNode
                    ? "AI 新增的概念"
                    : followsNode
                      ? "相連的概念已移除，這個關係也一起移除"
                      : `AI 新增的關係（${item.relationZh}）`}
                </small>
              </div>
              <div className="decision-group" role="group" aria-label="保留或移除">
                {(["keep", "remove"] as const).map((value) => (
                  <button
                    className={choice === value ? `selected ${value === "keep" ? "accepted" : "rejected"}` : ""}
                    key={value}
                    type="button"
                    aria-pressed={choice === value}
                    disabled={locked || followsNode}
                    onClick={() => setChoices((current) => ({ ...current, [item.id]: value }))}
                  >
                    {value === "keep" ? "保留" : "移除"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {locked ? (
        <div className="stage-panel-row">
          <div className="success-banner" style={{ flex: 1 }}>
            <CheckCircle2 size={16} aria-hidden="true" /> 概念圖已確認。
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              if (
                hasEdits &&
                !window.confirm("重新決定保留或移除後，你在步驟 3 對概念圖做的調整會被捨棄。要繼續嗎？")
              ) {
                return;
              }
              setEditing(true);
            }}
          >
            修改決定
          </button>
        </div>
      ) : (
        <button
          className="button"
          type="button"
          disabled={undecided > 0}
          onClick={async () => {
            const rejectedIds = aiItems
              .filter((item) => removed.has(item.id) || orphaned(item))
              .map((item) => item.id);
            const result = await perform({ action: "review_concepts", rejectedIds });
            if (result) setEditing(false);
          }}
        >
          {undecided > 0 ? `還有 ${undecided} 項沒有決定` : "確認概念圖"}
        </button>
      )}
      </div>
      {locked && finalMap.success && reviewedMap.success ? (
        <div className="panel-wide">
          <StepHeading step={3} title="調整你的概念圖（可以移動、修改、新增或刪除）" done={hasEdits} />
          <ConceptMapEditor
            key={decisionsArtifact?.id}
            map={finalMap.data}
            reviewed={reviewedMap.data}
            busy={savingMap}
            onSave={async (edit) => {
              setSavingMap(true);
              const result = await perform({ action: "save_concept_map", ...edit });
              setSavingMap(false);
              return Boolean(result);
            }}
          />
        </div>
      ) : null}
      {locked ? <div className="panel-wide"><SpeakingOutlinePanel view={view} perform={perform} /></div> : null}
    </div>
  );
}

// Stages where the student works with AI output. Stage 2 runs an analysis in
// the background, but the student does not see it there, so it is not listed.
const AI_HELP_STAGES = new Set<StageId>(["image_analysis", "ai_concept_map", "sentence_scaffold"]);

const HINT_LEVELS = [
  { level: 1, name: "想一想", help: "一個引導問題和可以加進去的詞" },
  { level: 2, name: "句型框架", help: "用你的句子做成的填空句型" },
  { level: 3, name: "示範改寫", help: "把你的句子擴充成完整的一句" },
] as const;

function numberList(value: unknown, length: number): number[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) =>
    typeof source[index] === "number" ? (source[index] as number) : 0,
  );
}

/** One sentence: the student's original, their revision and its hint ladder. */
function SentenceHintCard({
  hint,
  number,
  value,
  level,
  onChange,
  onOpenLevel,
}: {
  hint: SentenceHint | undefined;
  number: number;
  value: string;
  level: number;
  onChange: (value: string) => void;
  onOpenLevel: (level: number) => void;
}) {
  return (
    <div className="sentence-hint-card">
      <div className="sentence-hint-original">
        <span className="step-number">{number}</span>
        <div>
          <small>你原本寫的</small>
          <p>{hint?.original}</p>
        </div>
      </div>
      <label className="sentence-hint-revision">
        <span>你的句子（可以邊看提示邊修改）</span>
        <input className="input" value={value} maxLength={500} onChange={(event) => onChange(event.target.value)} />
      </label>
      {hint ? (
        <div className="hint-ladder compact">
          {HINT_LEVELS.map((step) => {
            const open = level >= step.level;
            const next = level + 1 === step.level;
            return (
              <div className={`hint-level ${open ? "open" : ""}`} key={step.level}>
                <button
                  className={open ? "hint-toggle open" : "hint-toggle"}
                  type="button"
                  disabled={!open && !next}
                  aria-expanded={open}
                  onClick={() => {
                    if (!open) onOpenLevel(step.level);
                  }}
                >
                  <span>第 {step.level} 級 · {step.name}</span>
                  <small>{open ? "已打開" : next ? step.help : "先打開上一級"}</small>
                </button>
                {open && step.level === 1 ? (
                  <div className="sentence-hint-body">
                    <p>{hint.question}</p>
                    {hint.keywords.length ? (
                      <div className="chip-list">
                        {hint.keywords.map((item) => (
                          <span className="chip" key={item.word}>
                            {item.word}
                            {item.translation ? ` · ${item.translation}` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {open && step.level === 2 ? (
                  <div className="sentence-hint-body">
                    <p className="sentence-frame">{hint.frame}</p>
                    <small className="muted">把 ___ 換成你自己的內容。</small>
                  </div>
                ) : null}
                {open && step.level === 3 ? (
                  <div className="sentence-hint-body">
                    <p className="sentence-frame">{hint.example.sentence}</p>
                    {hint.example.translation ? <small className="muted">{hint.example.translation}</small> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">這一句沒有提示，可以照自己的想法修改。</p>
      )}
    </div>
  );
}

function SentencePanel({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  const saved = artifact(view, "sentence_scaffold", "sentences");
  const savedSentences = stringArray(saved?.data.sentences);
  const originals = stringArray(saved?.data.originals).length
    ? stringArray(saved?.data.originals)
    : savedSentences;
  const scaffold = artifact(view, "sentence_scaffold", "sentence_scaffold");
  const parsedScaffold = sentenceScaffoldSchema.safeParse(scaffold?.data);
  // Hints belong to the sentences they were built for; after the student
  // rewrites their original sentences, the old hints no longer apply.
  const hintsMatch =
    parsedScaffold.success &&
    parsedScaffold.data.sentences.length === originals.length &&
    parsedScaffold.data.sentences.every((item) => originals[item.index] === item.original);
  const finalMap = conceptMapSchema.safeParse(artifact(view, "ai_concept_map", "concept_decisions")?.data.accepted);
  const outlineArtifact = artifact(view, "ai_concept_map", "speaking_outline");
  const speakingTemplate = view.task.config.speakingTemplate;
  const outline = finalMap.success ? validSpeakingOutline(outlineArtifact?.data, finalMap.data, speakingTemplate ?? null) : null;
  const needsOutline = Boolean(speakingTemplate && !outline);
  const outlineMatches = !needsOutline && (!outline || scaffold?.data.speakingOutlineId === outlineArtifact?.id);
  const scaffoldReady = parsedScaffold.success && hintsMatch && outlineMatches && originals.length >= 3;
  const hintByIndex = new Map(
    parsedScaffold.success ? parsedScaffold.data.sentences.map((item) => [item.index, item]) : [],
  );

  const [draft, setDraft] = useState(originals.join("\n"));
  const [rewriting, setRewriting] = useState(false);
  const [revised, setRevised] = useState<string[]>(savedSentences);
  const [levels, setLevels] = useState<number[]>(() => numberList(saved?.data.hintLevels, savedSentences.length));
  const [requesting, setRequesting] = useState(false);
  const audio = artifact(view, "sentence_scaffold", "audio");
  const config = view.task.config.stageConfig.sentence_scaffold;

  const draftSentences = draft.split("\n").map((sentence) => sentence.trim()).filter(Boolean);
  const writing = !scaffoldReady || rewriting;
  const revisionsUnsaved = !sameList(revised.map((item) => item.trim()), savedSentences);

  function syncFrom(next: SessionView | null) {
    if (!next) return;
    const data = next.artifacts.find((item) => item.stageId === "sentence_scaffold" && item.type === "sentences")?.data;
    const sentences = stringArray(data?.sentences);
    setRevised(sentences);
    setLevels(numberList(data?.hintLevels, sentences.length));
  }

  async function saveDraftAndGetHints() {
    setRequesting(true);
    const afterSave = savedSentences.length >= 3 && sameList(draftSentences, originals) ? view : await perform({
      action: "save_sentences",
      phase: "draft",
      sentences: draftSentences,
      hintLevel: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    syncFrom(afterSave);
    if (afterSave) {
      const afterHints = await perform({ action: "run_ai", stage: "sentence_scaffold" });
      if (afterHints) setRewriting(false);
    }
    setRequesting(false);
  }

  async function saveRevision(nextLevels = levels) {
    const sentences = revised.map((item, index) => item.trim() || originals[index]);
    const result = await perform({
      action: "save_sentences",
      phase: "revision",
      sentences,
      hintLevel: Math.max(0, ...nextLevels),
      hintLevels: nextLevels,
      idempotencyKey: crypto.randomUUID(),
    });
    syncFrom(result);
  }

  async function openLevel(index: number, level: number) {
    const nextLevels = levels.map((value, position) => (position === index ? level : value));
    setLevels(nextLevels);
    // Which hint level each sentence reached is research data: save it now.
    await saveRevision(nextLevels);
  }

  return (
    <div className="stage-panel">
      <SpeakingOutlinePanel view={view} perform={perform} hintsReady={scaffoldReady && !rewriting} />
      <StepHeading step={1} title="先寫下至少 3 個自己的英文句子" done={scaffoldReady && !rewriting} />
      {writing ? (
        <>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sentences">每行一句，先不要看提示</label>
            <textarea
              id="sentences"
              className="textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={speakingTemplate?.id === "problem_solution" ? "每行寫一句自己的英文，描述你觀察到的情況、知道的原因或自己的處理想法。" : speakingTemplate?.id === "chronological" ? "每行寫一句自己的英文，說明你實際做過或知道的內容。" : "I saw many red lanterns.\nVisitors bought pineapple cakes.\nThe market felt lively."}
            />
          </div>
          <div className="stage-panel-row">
            <small className="muted" style={{ flex: 1 }}>
              已寫 {draftSentences.length} 句{draftSentences.length < 3 ? `，還差 ${3 - draftSentences.length} 句` : ""}
            </small>
            {rewriting ? (
              <button className="button secondary" type="button" onClick={() => setRewriting(false)}>
                取消
              </button>
            ) : null}
            <button
              className="button"
              type="button"
              disabled={draftSentences.length < 3 || requesting || needsOutline}
              onClick={saveDraftAndGetHints}
            >
              {requesting ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
              {requesting ? "正在為每一句準備提示…" : "保存句子並取得提示"}
            </button>
          </div>
          {needsOutline ? <p className="panel-hint">請先在上方建立任務指定的講述架構，再取得對應提示。</p> : null}
        </>
      ) : (
        <div className="stage-panel-row">
          <p className="panel-hint" style={{ flex: 1, margin: 0 }}>
            你寫了 {originals.length} 句。下面每一句都有自己的提示。
          </p>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              if (window.confirm("重寫原本的句子後，會重新產生提示，已打開的提示和修改都會重來。要繼續嗎？")) {
                setDraft(originals.join("\n"));
                setRewriting(true);
              }
            }}
          >
            重寫原本的句子
          </button>
        </div>
      )}

      <StepHeading step={2} title="逐句加強：需要時才打開下一級提示" done={scaffoldReady && levels.some((level) => level > 0)} />
      {scaffoldReady && !rewriting ? (
        <>
          <p className="panel-hint">
            每一句都有三級提示，能不用就不用。看完提示後，直接在框裡改寫你的句子，最後按「保存修改」。
          </p>
          <div className="sentence-hint-list">
            {originals.map((original, index) => (
              <SentenceHintCard
                key={`${index}-${original}`}
                hint={hintByIndex.get(index)}
                number={index + 1}
                value={revised[index] ?? original}
                level={levels[index] ?? 0}
                onChange={(value) =>
                  setRevised((current) => current.map((item, position) => (position === index ? value : item)))
                }
                onOpenLevel={(level) => void openLevel(index, level)}
              />
            ))}
          </div>
          <div className="stage-panel-row">
            <small className="muted" style={{ flex: 1 }}>
              {revisionsUnsaved ? "你有還沒保存的修改。" : "修改都已保存。"}
            </small>
            <button
              className={revisionsUnsaved ? "button" : "button secondary"}
              type="button"
              disabled={!revisionsUnsaved}
              onClick={() => void saveRevision()}
            >
              {revisionsUnsaved ? "保存修改" : "已保存"}
            </button>
          </div>
        </>
      ) : (
        <p className="panel-hint">保存 3 個以上的句子後，每一句都會有自己的三級提示。</p>
      )}

      <StepHeading step={3} title="把你的句子說一次並錄下來" done={Boolean(audio)} />
      {audio ? (
        <div className="success-banner">
          <CheckCircle2 size={16} aria-hidden="true" /> 口說練習已保存。
        </div>
      ) : scaffoldReady && !rewriting ? (
        <>
          <div className="speaking-script">
            <small>照著你修改後的句子說，連貫地說成一段：</small>
            <ol>
              {savedSentences.map((sentence, index) => (
                <li key={`${index}-${sentence}`}>{sentence}</li>
              ))}
            </ol>
            {parsedScaffold.success && parsedScaffold.data.transitions.length ? (
              <div className="speaking-transitions">
                <small>可以用這些詞把句子串起來：</small>
                <div className="chip-list">
                  {parsedScaffold.data.transitions.map((word) => (
                    <span className="chip" key={word}>{word}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {revisionsUnsaved ? <p className="panel-hint">先保存修改，錄音時看到的就是你最新的句子。</p> : null}
          <p className="panel-hint">
            約 {config.minimumRecordingSeconds}–{config.maximumRecordingSeconds} 秒。
          </p>
          <AudioRecorder
            stage="sentence_scaffold"
            sessionId={view.session.id}
            minimumSeconds={config.minimumRecordingSeconds}
            maximumSeconds={config.maximumRecordingSeconds}
            onSaved={onSaved}
          />
        </>
      ) : (
        <p className="panel-hint">取得提示後就可以錄音。</p>
      )}
    </div>
  );
}

function StagePanel({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  switch (view.session.currentStage) {
    case "pretest":
      return (
        <AudioStagePanel
          view={view}
          onSaved={onSaved}
          prompt="這一段不會有任何提示，也不用擔心文法。按下麥克風就開始錄音，說完按停止，再按保存。"
        />
      );
    case "posttest":
      return (
        <AudioStagePanel
          view={view}
          onSaved={onSaved}
          prompt="最後一次獨立口說，同樣沒有提示。盡量用你這次學到的詞和句子說得更完整。"
        />
      );
    case "visualization":
      return <VisualizationPanel view={view} perform={perform} onSaved={onSaved} />;
    case "self_concept_map":
      return <SelfConceptPanel view={view} onSaved={onSaved} />;
    case "image_analysis":
      return <ImageAnalysisPanel view={view} perform={perform} onSaved={onSaved} />;
    case "ai_concept_map":
      return <AIConceptPanel view={view} perform={perform} onSaved={onSaved} />;
    case "sentence_scaffold":
      return <SentencePanel view={view} perform={perform} onSaved={onSaved} />;
  }
}

// ---- Workspace ---------------------------------------------------------------

export function ChatWorkspace({ initialView }: { initialView: SessionView }) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  const stage = view.session.currentStage;

  const currentDefinition = useMemo(
    () => view.stages.find((item) => item.id === stage)!,
    [view, stage],
  );
  const stageConfig = view.task.config.stageConfig[stage];
  const checklist = stageChecklist(
    stage,
    view.artifacts,
    {
      minimumSeconds: stageConfig.minimumRecordingSeconds,
      maximumSeconds: stageConfig.maximumRecordingSeconds,
      speakingTemplate: view.task.config.speakingTemplate,
    },
  );
  const remaining = checklist.filter((step) => !step.done).length;
  const isLastStage = currentDefinition.order === STAGES.length;

  // A new stage starts at the top, where its instructions are.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [stage, view.session.completed]);

  async function perform(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/student/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "操作失敗。");
      }
      setView(payload.data);
      return payload.data as SessionView;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失敗。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    // Shared classroom devices: the next student must not land in this session.
    if (!window.confirm("要登出嗎？已保存的進度不會遺失，之後用同一組代碼即可繼續。")) {
      return;
    }
    await fetch("/api/student/logout", { method: "POST" });
    window.location.assign("/");
  }

  async function completeStage() {
    await perform({ action: "complete_stage", stage, stateVersion: view.session.stateVersion });
  }

  const studentLabel = view.session.studentLabel ?? view.session.id.slice(0, 8);

  return (
    <main className="workspace student-workspace">
      <section className="chat-shell student-shell">
        <header className="app-bar">
          <div className="app-bar-brand">
            <span className="brand-mark" aria-hidden="true">A3</span>
            <div>
              <strong>{view.task.title}</strong>
              <span>
                {view.session.completed
                  ? "七個階段全部完成"
                  : `第 ${currentDefinition.order} / ${STAGES.length} 階段`}
              </span>
            </div>
          </div>
          <StageStepper stages={view.stages} />
          <div className="app-bar-account">
            <span>{studentLabel}</span>
            <button className="button secondary compact" type="button" onClick={signOut}>
              <LogOut size={15} aria-hidden="true" />
              登出
            </button>
          </div>
        </header>

        <div className="chat-scroll" ref={mainRef}>
          <div className="chat-column" data-stage={stage}>
            {view.session.completed ? (
              <div className="completion-card">
                <span className="completion-icon">
                  <Check size={36} strokeWidth={2.6} aria-hidden="true" />
                </span>
                <h1>七個階段全部完成！</h1>
                <p>你的作品和錄音都已保存。可以登出並關閉這個頁面，下面可以回顧你的學習紀錄。</p>
                <button className="button" type="button" onClick={signOut}>
                  <LogOut size={17} aria-hidden="true" />
                  登出
                </button>
              </div>
            ) : (
              <>
                <div className="stage-intro">
                  <div className="stage-intro-text">
                    <span className={`stage-badge ${AI_HELP_STAGES.has(stage) ? "ai" : "self"}`}>
                      {AI_HELP_STAGES.has(stage) ? "AI 會協助你" : "這一階段由你自己完成"}
                    </span>
                    <h1>{currentDefinition.title}</h1>
                    <p>{stageConfig.instruction}</p>
                  </div>
                  {view.session.consented ? (
                    <div className="stage-todo">
                      <strong>這個階段要完成</strong>
                      <ol className="stage-checklist" aria-label="這個階段要完成的事">
                        {checklist.map((step) => (
                          <li className={step.done ? "done" : ""} key={step.label}>
                            {step.done ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
                            <span>{step.label}</span>
                            <span className="visually-hidden">{step.done ? "（已完成）" : "（未完成）"}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>

                <div className="stage-work" style={{ position: "relative" }}>
                  {busy ? (
                    <div className="busy-overlay" role="status">
                      <LoaderCircle className="spin" size={18} /> 正在處理…
                    </div>
                  ) : null}
                  {view.session.consented ? (
                    <StagePanel view={view} perform={perform} onSaved={setView} />
                  ) : (
                    <ConsentPanel text={view.task.config.consentText} perform={perform} />
                  )}
                </div>
              </>
            )}

            {view.session.consented ? (
              <LearningHistory view={view} open={view.session.completed} />
            ) : null}
          </div>
        </div>

        {view.session.consented && !view.session.completed ? (
          <footer className={`chat-composer action-bar ${view.gate.ok ? "ready" : ""}`}>
            <div className="composer-inner">
              {error ? (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              ) : null}
              <div className={`gate-row ${view.gate.ok ? "ready" : ""}`}>
                <span aria-live="polite">
                  {view.gate.ok
                    ? isLastStage
                      ? "都完成了！可以提交後測。"
                      : "這個階段完成了！"
                    : remaining > 1
                      ? `還有 ${remaining} 件事要完成。下一步：${view.gate.message}`
                      : `下一步：${view.gate.message}`}
                </span>
                <button className="button" type="button" disabled={!view.gate.ok || busy} onClick={completeStage}>
                  {isLastStage ? "提交並完成" : `完成，進入第 ${currentDefinition.order + 1} 階段`}
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
