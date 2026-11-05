"use client";

import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Lock,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  annotatedImageSchema,
  conceptMapSchema,
  imageAnalysisSchema,
  sentenceScaffoldSchema,
} from "@/lib/ai/schemas";
import type { StageId } from "@/lib/domain/stages";
import type {
  ArtifactView,
  SessionView,
} from "@/lib/services/session-service";
import { AudioRecorder } from "@/components/student/audio-recorder";
import { AnnotatedImageCard } from "@/components/student/annotated-image-card";
import { ConceptMapCard } from "@/components/student/concept-map-card";
import { ImageUploader } from "@/components/student/image-uploader";
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

function MessageContent({
  message,
}: {
  message: SessionView["messages"][number];
}) {
  if (message.kind === "labels") {
    return (
      <div className="chip-list">
        {stringArray(message.content.labels).map((label) => (
          <span className="chip" key={label}>
            {label}
          </span>
        ))}
      </div>
    );
  }

  if (
    message.kind === "concept_map" ||
    message.kind === "ai_concept_map" ||
    message.kind === "concept_decisions"
  ) {
    const source =
      message.kind === "concept_decisions"
        ? message.content.accepted
        : message.content;
    const parsed = conceptMapSchema.safeParse(source);
    if (parsed.success) {
      return (
        <ConceptMapCard
          map={parsed.data}
          title={
            message.kind === "ai_concept_map"
              ? "AI 生成的新概念圖"
              : message.kind === "concept_decisions"
                ? "我確認後的概念圖"
                : "我的原始概念圖"
          }
        />
      );
    }
  }

  if (message.kind === "image_analysis") {
    const parsed = imageAnalysisSchema.safeParse(message.content);
    if (parsed.success) {
      return (
        <div>
          <strong>AI 看見的場景</strong>
          <p>{parsed.data.sceneSummaryZh}</p>
          <div className="chip-list">
            {parsed.data.suggestions.map((item) => (
              <span className="chip" key={item.id}>
                {item.labelEn} · {item.labelZh}
              </span>
            ))}
          </div>
        </div>
      );
    }
  }

  if (message.kind === "sentences") {
    return (
      <div>
        {stringArray(message.content.sentences).map((sentence) => (
          <div key={sentence}>{sentence}</div>
        ))}
      </div>
    );
  }

  if (message.kind === "sentence_scaffold") {
    return (
      <div>
        <strong>句型鷹架已準備完成</strong>
        <p>你可以在下方依需要逐級開啟提示。</p>
      </div>
    );
  }

  return (
    <span>
      {typeof message.content.text === "string"
        ? message.content.text
        : message.role === "assistant"
          ? "AI 已完成此階段的分析。"
          : "已提交學習內容。"}
    </span>
  );
}

function ArtifactHistory({
  view,
  currentOnly,
}: {
  view: SessionView;
  currentOnly: boolean;
}) {
  const rows = currentOnly
    ? view.artifacts.filter(
        (item) => item.stageId === view.session.currentStage,
      )
    : view.artifacts;
  const media = rows.filter(
    (item) => item.type === "image" || item.type === "audio",
  );
  const annotatedImages =
    view.session.currentStage === "image_analysis"
      ? []
      : rows
          .filter((item) => item.type === "annotated_image")
          .flatMap((item) => {
            const parsed = annotatedImageSchema.safeParse(item.data);
            if (!parsed.success) return [];
            const source = view.artifacts.find(
              (candidate) =>
                candidate.id === parsed.data.sourceImageArtifactId,
            );
            return source?.downloadUrl
              ? [{ artifact: item, annotated: parsed.data, source }]
              : [];
          });
  return (
    <>
      {media.map((item) => (
        <div className="message-row student" key={item.id}>
          <div className="artifact-card">
            <div className="artifact-card-header">
              <span>
                {item.type === "image"
                  ? item.stageId === "self_concept_map"
                    ? "我的手繪概念圖"
                    : "我的手繪情境圖"
                  : "我的口說錄音"}
              </span>
              <span className="tag">{item.status}</span>
            </div>
            {item.downloadUrl && item.type === "image" ? (
              // Private authenticated route; Next/Image optimization is intentionally skipped.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="artifact-image"
                src={item.downloadUrl}
                alt={
                  item.stageId === "self_concept_map"
                    ? "學生手繪概念圖"
                    : "學生手繪情境圖"
                }
              />
            ) : null}
            {item.downloadUrl && item.type === "audio" ? (
              <div className="artifact-card-body">
                <audio controls src={item.downloadUrl}>
                  <track kind="captions" />
                </audio>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {annotatedImages.map(({ artifact: item, annotated, source }) => (
        <div className="message-row assistant" key={item.id}>
          <AnnotatedImageCard
            sourceUrl={source.downloadUrl!}
            annotated={annotated}
          />
        </div>
      ))}
    </>
  );
}

function ConsentPanel({
  text,
  perform,
}: {
  text: string;
  perform: Perform;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="consent-card">
      <h3>開始前的資料說明</h3>
      <p>{text}</p>
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
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

function AudioStagePanel({
  view,
  onSaved,
}: {
  view: SessionView;
  onSaved: (view: SessionView) => void;
}) {
  const config = view.task.config.stageConfig[view.session.currentStage];
  const saved = artifact(
    view,
    view.session.currentStage,
    "audio",
  );
  return (
    <div className="stage-panel">
      {saved ? (
        <div className="success-banner">
          <CheckCircle2 size={16} style={{ verticalAlign: "middle" }} />{" "}
          錄音已安全保存至 Google Drive。
        </div>
      ) : (
        <AudioRecorder
          stage={view.session.currentStage}
          sessionId={view.session.id}
          minimumSeconds={config.minimumRecordingSeconds}
          maximumSeconds={config.maximumRecordingSeconds}
          onSaved={onSaved}
        />
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
  const labelsArtifact = artifact(view, "visualization", "self_labels");
  const [labelsText, setLabelsText] = useState(
    stringArray(labelsArtifact?.data.labels).join(", "),
  );
  const labels = labelsText
    .split(/[,\n，]/)
    .map((label) => label.trim())
    .filter(Boolean);

  return (
    <div className="stage-panel">
      {!image ? (
        <ImageUploader
          sessionId={view.session.id}
          stage="visualization"
          onSaved={onSaved}
        />
      ) : (
        <UploadedImageCard
          artifact={image}
          title="我的手繪情境圖"
          alt="學生上傳的手繪情境圖"
          onDeleted={onSaved}
        />
      )}
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="self-labels">我原本就知道的英文詞彙</label>
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
            <span className="chip" key={label}>
              {label}
            </span>
          ))}
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={labels.length === 0}
          onClick={() =>
            perform({
              action: "save_labels",
              labels,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          保存標記
        </button>
      </div>
    </div>
  );
}

function SelfConceptPanel({
  view,
  onSaved,
}: {
  view: SessionView;
  onSaved: (view: SessionView) => void;
}) {
  const saved = artifact(view, "self_concept_map", "image");

  return (
    <div className="stage-panel">
      {!saved ? (
        <>
          <div className="info-banner">
            請先在紙上自行畫出概念、方向連線與關係詞，再拍照或選擇圖片上傳。此階段不會由 AI 代畫。
          </div>
          <ImageUploader
            sessionId={view.session.id}
            stage="self_concept_map"
            onSaved={onSaved}
          />
        </>
      ) : (
        <UploadedImageCard
          artifact={saved}
          title="我的原始手繪概念圖"
          alt="學生上傳的手繪概念圖"
          onDeleted={onSaved}
        />
      )}
    </div>
  );
}

function ImageAnalysisPanel({
  view,
  perform,
}: {
  view: SessionView;
  perform: Perform;
}) {
  const output = artifact(view, "image_analysis", "image_analysis");
  const annotatedOutput = artifact(
    view,
    "image_analysis",
    "annotated_image",
  );
  const sourceImage = artifact(view, "visualization", "image");
  const decisionsArtifact = artifact(
    view,
    "image_analysis",
    "vocabulary_decisions",
  );
  const parsed = imageAnalysisSchema.safeParse(output?.data);
  const annotated = annotatedImageSchema.safeParse(annotatedOutput?.data);
  const preparedForCurrentImage =
    annotated.success &&
    annotated.data.sourceImageArtifactId === sourceImage?.id;
  const [decisions, setDecisions] = useState<
    Record<
      string,
      {
        status: "accepted" | "edited" | "rejected";
        labelEn: string;
        labelZh: string;
      }
    >
  >(() =>
    parsed.success
      ? Object.fromEntries(
          parsed.data.suggestions.map((item) => [
            item.id,
            {
              status: "accepted" as const,
              labelEn: item.labelEn,
              labelZh: item.labelZh,
            },
          ]),
        )
      : {},
  );

  if (!parsed.success || !preparedForCurrentImage || !sourceImage?.downloadUrl) {
    return (
      <div className="stage-panel">
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          AI 會讀取你先前的手繪圖，將辨識到的元素直接標在原圖上，並提供可審核的雙語詞彙。
        </p>
        {parsed.success && !annotated.success ? (
          <div className="info-banner">
            目前只有舊版詞彙分析；請重新執行以取得 AI 標記後的手繪圖。
          </div>
        ) : null}
        <button
          className="button"
          type="button"
          onClick={() => perform({ action: "run_ai", stage: "image_analysis" })}
        >
          <Sparkles size={17} />
          產生 AI 標記版本
        </button>
      </div>
    );
  }

  const alreadyReviewed =
    Array.isArray(decisionsArtifact?.data.pending) &&
    decisionsArtifact.data.pending.length === 0;
  return (
    <div className="stage-panel">
      <AnnotatedImageCard
        sourceUrl={sourceImage.downloadUrl}
        annotated={annotated.data}
      />
      <div className="info-banner">{parsed.data.sceneSummaryZh}</div>
      <div className="review-list">
        {parsed.data.suggestions.map((item) => {
          const decision = decisions[item.id] ?? {
            status: "accepted" as const,
            labelEn: item.labelEn,
            labelZh: item.labelZh,
          };
          return (
            <div className="review-item" key={item.id}>
              <div>
                {decision.status === "edited" ? (
                  <div className="stage-panel-row">
                    <input
                      className="input"
                      value={decision.labelEn}
                      onChange={(event) =>
                        setDecisions((current) => ({
                          ...current,
                          [item.id]: {
                            ...decision,
                            labelEn: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      className="input"
                      value={decision.labelZh}
                      onChange={(event) =>
                        setDecisions((current) => ({
                          ...current,
                          [item.id]: {
                            ...decision,
                            labelZh: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                ) : (
                  <strong>
                    {decision.labelEn} · {decision.labelZh}
                  </strong>
                )}
                <p>
                  {item.evidence} · 信心 {Math.round(item.confidence * 100)}%
                </p>
              </div>
              <div className="decision-group">
                {(["accepted", "edited", "rejected"] as const).map((status) => (
                  <button
                    className={decision.status === status ? "selected" : ""}
                    key={status}
                    type="button"
                    onClick={() =>
                      setDecisions((current) => ({
                        ...current,
                        [item.id]: { ...decision, status },
                      }))
                    }
                  >
                    {status === "accepted"
                      ? "接受"
                      : status === "edited"
                        ? "修改"
                        : "拒絕"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {!alreadyReviewed ? (
        <button
          className="button"
          type="button"
          onClick={() =>
            perform({
              action: "review_vocabulary",
              decisions: parsed.data.suggestions.map((item) => ({
                id: item.id,
                ...(decisions[item.id] ?? {
                  status: "accepted" as const,
                  labelEn: item.labelEn,
                  labelZh: item.labelZh,
                }),
              })),
            })
          }
        >
          完成詞彙審核
        </button>
      ) : (
        <div className="success-banner">所有詞彙已完成審核。</div>
      )}
    </div>
  );
}

function AIConceptPanel({
  view,
  perform,
}: {
  view: SessionView;
  perform: Perform;
}) {
  const output =
    artifact(view, "ai_concept_map", "generated_concept_map") ??
    artifact(view, "ai_concept_map", "ai_concept_map");
  const decisions = artifact(view, "ai_concept_map", "concept_decisions");
  const parsed = conceptMapSchema.safeParse(output?.data);
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(stringArray(decisions?.data.rejectedIds)),
  );

  if (!parsed.success) {
    return (
      <div className="stage-panel">
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          AI 會讀取你上傳的手繪概念圖，整合已確認詞彙，生成一張具有節點、方向連線與關係詞的新概念圖。
        </p>
        <button
          className="button"
          type="button"
          onClick={() => perform({ action: "run_ai", stage: "ai_concept_map" })}
        >
          <Sparkles size={17} />
          產生擴充概念圖
        </button>
      </div>
    );
  }

  const alreadyReviewed =
    Array.isArray(decisions?.data.pending) &&
    decisions.data.pending.length === 0;
  const selectedNodes = parsed.data.nodes.filter(
    (node) => !excluded.has(node.id),
  );
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = parsed.data.edges.filter(
    (edge) =>
      !excluded.has(edge.id) &&
      selectedNodeIds.has(edge.from) &&
      selectedNodeIds.has(edge.to),
  );

  return (
    <div className="stage-panel">
      <ConceptMapCard
        map={{ nodes: selectedNodes, edges: selectedEdges }}
        title="AI 生成的新概念圖"
      />
      <div className="review-list">
        {[...parsed.data.nodes, ...parsed.data.edges]
          .filter((item) => item.source === "ai")
          .map((item) => {
            const isNode = "labelEn" in item;
            const label = isNode
              ? item.labelEn
              : `${item.relationEn}（關係）`;
            return (
              <label className="review-item" key={item.id}>
                <span>
                  <strong>{label}</strong>
                  <p>AI 新增建議；取消勾選即拒絕。</p>
                </span>
                <input
                  type="checkbox"
                  checked={!excluded.has(item.id)}
                  onChange={(event) =>
                    setExcluded((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                />
              </label>
            );
          })}
      </div>
      {!alreadyReviewed ? (
        <button
          className="button"
          type="button"
          onClick={() =>
            perform({
              action: "review_concepts",
              accepted: { nodes: selectedNodes, edges: selectedEdges },
              rejectedIds: [...excluded],
            })
          }
        >
          完成概念審核
        </button>
      ) : (
        <div className="success-banner">擴充概念圖已確認。</div>
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
  const scaffold = artifact(view, "sentence_scaffold", "sentence_scaffold");
  const parsedScaffold = sentenceScaffoldSchema.safeParse(scaffold?.data);
  const [text, setText] = useState(
    stringArray(saved?.data.sentences).join("\n"),
  );
  const [hintLevel, setHintLevel] = useState(
    typeof saved?.data.hintLevel === "number" ? saved.data.hintLevel : 0,
  );
  const sentences = text
    .split("\n")
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const audio = artifact(view, "sentence_scaffold", "audio");

  async function save(level = hintLevel) {
    await perform({
      action: "save_sentences",
      sentences,
      hintLevel: level,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async function reveal(level: number) {
    setHintLevel(level);
    await save(level);
  }

  return (
    <div className="stage-panel">
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="sentences">先寫下自己的英文句子（每行一句）</label>
        <textarea
          id="sentences"
          className="textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="I saw many red lanterns.\nVisitors bought pineapple cakes.\nThe market felt lively."
        />
      </div>
      <div className="stage-panel-row">
        <button
          className="button secondary"
          type="button"
          disabled={!sentences.length}
          onClick={() => save()}
        >
          保存我的句子
        </button>
        {!parsedScaffold.success ? (
          <button
            className="button"
            type="button"
            disabled={sentences.length < 3}
            onClick={async () => {
              await save();
              await perform({
                action: "run_ai",
                stage: "sentence_scaffold",
              });
            }}
          >
            <Sparkles size={17} />
            建立分級鷹架
          </button>
        ) : null}
      </div>

      {parsedScaffold.success ? (
        <div className="artifact-card">
          <div className="artifact-card-header">
            <span>需要多少提示？</span>
            <span className="tag">目前第 {hintLevel} 級</span>
          </div>
          <div className="artifact-card-body section-stack">
            <div className="stage-panel-row">
              {[1, 2, 3].map((level) => (
                <button
                  className={hintLevel >= level ? "button dark" : "button secondary"}
                  key={level}
                  type="button"
                  onClick={() => reveal(level)}
                >
                  第 {level} 級
                </button>
              ))}
            </div>
            {hintLevel >= 1 ? (
              <div>
                <strong>關鍵詞</strong>
                <div className="chip-list" style={{ marginTop: 8 }}>
                  {parsedScaffold.data.keywords.map((item) => (
                    <span className="chip" key={item.word}>
                      {item.word} · {item.translation}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {hintLevel >= 2 ? (
              <div>
                <strong>句首提示</strong>
                <ul>
                  {parsedScaffold.data.starters.map((starter) => (
                    <li key={starter}>{starter}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {hintLevel >= 3 ? (
              <div>
                <strong>示範句</strong>
                <ul>
                  {parsedScaffold.data.examples.map((example) => (
                    <li key={example.sentence}>
                      {example.sentence}
                      <br />
                      <small>{example.translation}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {audio ? (
        <div className="success-banner">鷹架口說練習已保存。</div>
      ) : (
        <AudioRecorder
          stage="sentence_scaffold"
          sessionId={view.session.id}
          minimumSeconds={
            view.task.config.stageConfig.sentence_scaffold.minimumRecordingSeconds
          }
          maximumSeconds={
            view.task.config.stageConfig.sentence_scaffold.maximumRecordingSeconds
          }
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function StageComposer({
  view,
  perform,
  onSaved,
}: {
  view: SessionView;
  perform: Perform;
  onSaved: (view: SessionView) => void;
}) {
  if (!view.session.consented) {
    return (
      <ConsentPanel text={view.task.config.consentText} perform={perform} />
    );
  }

  switch (view.session.currentStage) {
    case "pretest":
    case "posttest":
      return <AudioStagePanel view={view} onSaved={onSaved} />;
    case "visualization":
      return (
        <VisualizationPanel view={view} perform={perform} onSaved={onSaved} />
      );
    case "self_concept_map":
      return <SelfConceptPanel view={view} onSaved={onSaved} />;
    case "image_analysis":
      return <ImageAnalysisPanel view={view} perform={perform} />;
    case "ai_concept_map":
      return <AIConceptPanel view={view} perform={perform} />;
    case "sentence_scaffold":
      return (
        <SentencePanel view={view} perform={perform} onSaved={onSaved} />
      );
  }
}

export function ChatWorkspace({ initialView }: { initialView: SessionView }) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentDefinition = useMemo(
    () =>
      view.stages.find((stage) => stage.id === view.session.currentStage)!,
    [view],
  );
  const visibleMessages = view.concealPriorStages
    ? view.messages.filter(
        (message) => message.stageId === view.session.currentStage,
      )
    : view.messages;

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
    await perform({
      action: "complete_stage",
      stage: view.session.currentStage,
      stateVersion: view.session.stateVersion,
    });
  }

  return (
    <main className="workspace">
      <aside className="stage-rail">
        <div className="rail-brand">
          <span className="brand-mark">A3</span>
          <strong>Speaking Lab</strong>
        </div>
        <ol className="stage-list">
          {view.stages.map((stage) => (
            <li
              className={`stage-item ${stage.status}`}
              data-order={stage.order}
              key={stage.id}
              aria-current={stage.status === "active" ? "step" : undefined}
            >
              <strong>{stage.title}</strong>
              <small>
                {stage.status === "completed"
                  ? "已完成"
                  : stage.status === "active"
                    ? "進行中"
                    : "尚未解鎖"}
              </small>
            </li>
          ))}
        </ol>
        <div className="rail-footer">
          目前登入
          <br />
          <strong>{view.session.studentLabel ?? view.session.id.slice(0, 8)}</strong>
          <br />
          <button className="rail-signout" type="button" onClick={signOut}>
            <LogOut size={14} />
            不是你？登出
          </button>
        </div>
      </aside>

      <section className="chat-shell">
        <header className="chat-header">
          <div>
            <h1>{view.task.title}</h1>
            <p>
              第 {currentDefinition.order} 階段 · {currentDefinition.title}
            </p>
          </div>
          <span className="model-badge">
            {view.task.provider === "google" ? "Gemini" : "OpenAI"} ·{" "}
            {view.task.modelId}
          </span>
        </header>

        <div className="chat-scroll">
          <div className="chat-column">
            <div className="phase-intro">
              <p className="eyebrow">
                Stage {currentDefinition.order} / 7
              </p>
              <h2>{currentDefinition.title}</h2>
              <p>
                {
                  view.task.config.stageConfig[view.session.currentStage]
                    .instruction
                }
              </p>
            </div>

            {view.concealPriorStages ? (
              <div className="info-banner">
                <Lock size={15} style={{ verticalAlign: "middle" }} />{" "}
                為了測量獨立口說，先前的 AI 提示會在提交後測後重新顯示。
              </div>
            ) : null}

            {visibleMessages.map((message) => (
              <div className={`message-row ${message.role}`} key={message.id}>
                <div className="message-bubble">
                  <MessageContent message={message} />
                  <div className="message-meta">
                    {message.role === "assistant" ? "AI 鷹架" : "我的提交"} ·{" "}
                    {new Date(message.createdAt).toLocaleTimeString("zh-TW", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
            <ArtifactHistory
              view={view}
              currentOnly={view.concealPriorStages}
            />
            {view.session.completed ? (
              <div className="consent-card">
                <h3>七個階段已完成</h3>
                <p>
                  你的學習歷程已保存。教師可以在後台匯出匿名化資料與查看錄音。
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {!view.session.completed ? (
          <footer className="chat-composer">
            <div className="composer-inner">
              {error ? <div className="error-banner">{error}</div> : null}
              <div style={{ position: "relative" }}>
                {busy ? (
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 4,
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 18,
                      background: "rgba(255,255,255,.78)",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    <span>
                      <LoaderCircle className="spin" size={18} /> 正在處理…
                    </span>
                  </div>
                ) : null}
                <StageComposer
                  view={view}
                  perform={perform}
                  onSaved={setView}
                />
              </div>
              {view.session.consented ? (
                <div
                  className={`gate-row ${view.gate.ok ? "ready" : ""}`}
                  style={{ marginTop: 10 }}
                >
                  <span>
                    {view.gate.ok ? (
                      <CheckCircle2 size={15} style={{ verticalAlign: "middle" }} />
                    ) : (
                      <CircleAlert size={15} style={{ verticalAlign: "middle" }} />
                    )}{" "}
                    {view.gate.message}
                  </span>
                  <button
                    className="button"
                    type="button"
                    disabled={!view.gate.ok || busy}
                    onClick={completeStage}
                  >
                    完成此階段
                    <ChevronRight size={17} />
                  </button>
                </div>
              ) : null}
            </div>
          </footer>
        ) : (
          <footer className="chat-composer">
            <div className="composer-inner">
              <div className="success-banner">
                <CheckCircle2 size={16} style={{ verticalAlign: "middle" }} />{" "}
                任務已完成，可安全關閉此頁。
              </div>
            </div>
          </footer>
        )}
      </section>
    </main>
  );
}
