import { MacroMicroCard } from "@/components/student/speaking-outline-panel";
import { outlineSourceMap, validSpeakingOutline } from "@/lib/domain/speaking-outline";
import { parseSpeakingTemplate } from "@/lib/domain/speaking-templates";
import { Lock, ShieldCheck } from "lucide-react";
import {
  annotatedImageSchema,
  conceptMapSchema,
  imageAnalysisSchema,
  speechEvaluationSchema,
  transcriptSchema,
} from "@/lib/ai/schemas";
import { STAGES, type StageId } from "@/lib/domain/stages";
import type {
  AdminLearningRecordArtifact,
  AdminLearningRecordMessage,
  AdminSessionLearningRecord,
  AdminSessionMeta,
} from "@/lib/services/admin-session-service";
import type {
  ArtifactView,
  SessionView,
} from "@/lib/services/session-service";
import { AnnotatedImageCard } from "@/components/student/annotated-image-card";
import { StageStepper } from "@/components/student/stage-stepper";
import { ConceptMapCard } from "@/components/student/concept-map-card";
import { SessionArtifactImage } from "@/components/admin/session-print-controls";

type ReadonlyMessage = {
  role: string;
  kind: string;
  content: Record<string, unknown>;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const STATUS_LABELS: Record<string, string> = {
  ready: "已保存",
  pending: "處理中",
  failed: "失敗",
  deleted: "已刪除",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-TW") : "—";
}

function formatBytes(value: number | null): string {
  if (value === null) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function JsonFallback({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="session-json-fallback">{JSON.stringify(value, null, 2)}</pre>
  );
}

function ReadonlyMessageContent({ message }: { message: ReadonlyMessage }) {
  if (message.kind === "speaking_navigation") return <p>瀏覽段落：{String(message.content.sectionTitle ?? message.content.sectionId)} · {message.content.mode === "single" ? "單層概念圖" : "Macro／Micro 雙層圖"} · {message.content.hintsVisible ? "顯示英文提示" : "未顯示英文提示"}</p>;
  if (["speaking_outline", "speaking_outline_edit"].includes(message.kind) && Array.isArray(message.content.sections)) return <ol>{message.content.sections.map((section: { id: string; titleZh: string; titleEn: string }) => <li key={section.id}>{section.titleZh} · {section.titleEn}</li>)}</ol>;
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
              ? "AI 擴充概念圖"
              : message.kind === "concept_decisions"
                ? "學生確認的概念圖"
                : "學生概念圖"
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
          <strong>AI 圖像分析</strong>
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
      <div className="session-sentence-list">
        {stringArray(message.content.sentences).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
    );
  }

  if (typeof message.content.text === "string") {
    return <p className="session-message-text">{message.content.text}</p>;
  }
  return <JsonFallback value={message.content} />;
}

function MessageCard({
  message,
  showHiddenFlag = false,
}: {
  message: AdminLearningRecordMessage | SessionView["messages"][number];
  showHiddenFlag?: boolean;
}) {
  const hiddenUntilComplete =
    "hiddenUntilComplete" in message && message.hiddenUntilComplete;
  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-bubble">
        <ReadonlyMessageContent message={message} />
        <div className="message-meta">
          {message.role === "assistant" ? "AI 助教" : "學生"} ·{" "}
          {formatDate(message.createdAt)}
          {showHiddenFlag && hiddenUntilComplete ? " · 完成前隱藏" : ""}
        </div>
      </div>
    </div>
  );
}

function AudioArtifact({
  artifact,
}: {
  artifact: {
    downloadUrl: string | null;
    data: Record<string, unknown>;
    mimeType: string | null;
    sizeBytes: number | null;
  };
}) {
  return (
    <div className="session-audio-record">
      <dl>
        <div>
          <dt>長度</dt>
          <dd>{formatDuration(artifact.data.durationSeconds)}</dd>
        </div>
        <div>
          <dt>格式</dt>
          <dd>{artifact.mimeType ?? "未知"}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{formatBytes(artifact.sizeBytes)}</dd>
        </div>
      </dl>
      {artifact.downloadUrl ? (
        <>
          <audio controls src={artifact.downloadUrl}>
            <track kind="captions" />
          </audio>
          <a className="session-audio-link" href={`${artifact.downloadUrl}?download=1`}>
            下載錄音
          </a>
        </>
      ) : null}
    </div>
  );
}

function TranscriptArtifact({ data }: { data: Record<string, unknown> }) {
  const parsed = transcriptSchema.safeParse(data);
  if (!parsed.success) return <JsonFallback value={data} />;
  return (
    <div className="session-transcript">
      <p>{parsed.data.text}</p>
      {parsed.data.segments.length ? (
        <ol>
          {parsed.data.segments.map((segment, index) => (
            <li key={`${segment.startSeconds}-${index}`}>
              <time>
                {segment.startSeconds.toFixed(1)}–{segment.endSeconds.toFixed(1)}s
              </time>
              {segment.text}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function EvaluationArtifact({ data }: { data: Record<string, unknown> }) {
  const parsed = speechEvaluationSchema.safeParse(data);
  if (!parsed.success) return <JsonFallback value={data} />;
  return (
    <div className="session-evaluation">
      <dl>
        <div>
          <dt>內容單位</dt>
          <dd>{parsed.data.contentUnits}</dd>
        </div>
        <div>
          <dt>每分鐘字數</dt>
          <dd>{parsed.data.wordsPerMinute}</dd>
        </div>
        <div>
          <dt>停頓次數</dt>
          <dd>{parsed.data.pauseCount}</dd>
        </div>
      </dl>
      <p>
        <strong>詞彙亮點：</strong>
        {parsed.data.vocabularyHighlights.join("、") || "—"}
      </p>
      <p>
        <strong>組織回饋：</strong>
        {parsed.data.organizationFeedbackZh}
      </p>
      <p>
        <strong>下一步：</strong>
        {parsed.data.nextStepZh}
      </p>
    </div>
  );
}

function artifactTitle(type: string): string {
  return (
    {
      image: "學生圖片",
      audio: "口說錄音",
      transcript: "忠實逐字稿",
      speech_evaluation: "口說描述性分析",
      annotated_image: "AI 標註圖片",
      self_labels: "學生標籤",
      image_analysis: "AI 圖像分析",
      vocabulary_decisions: "詞彙審核結果",
      generated_concept_map: "AI 擴充概念圖",
      ai_concept_map: "AI 概念圖",
      concept_decisions: "概念審核結果",
      sentences: "學生句子",
      sentence_scaffold: "句子鷹架",
      speaking_outline: "Macro／Micro 講述架構",
      speaking_progress: "講述段落與提示瀏覽紀錄",
    }[type] ?? type
  );
}

function ArtifactBody({
  artifact,
  allArtifacts,
}: {
  artifact: AdminLearningRecordArtifact;
  allArtifacts: AdminLearningRecordArtifact[];
}) {
  if (artifact.type === "image" && artifact.downloadUrl) {
    return (
      <SessionArtifactImage
        className="artifact-image"
        src={artifact.downloadUrl}
        alt="學生上傳圖片"
      />
    );
  }
  if (artifact.type === "speaking_outline") {
    const map = outlineSourceMap(artifact.data);
    const outline = map ? validSpeakingOutline(artifact.data, map) : null;
    if (map && outline) {
      const scaffold = allArtifacts.filter((item) => item.type === "sentence_scaffold" && item.data.speakingOutlineId === artifact.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      return <MacroMicroCard map={map} outline={outline} speakingTemplate={parseSpeakingTemplate(artifact.data.speakingTemplate)} organization={typeof artifact.data.organization === "string" ? artifact.data.organization : undefined} informationGaps={stringArray(artifact.data.informationGaps)} paragraphHints={scaffold?.data.paragraphHints as import("@/lib/ai/schemas").SentenceScaffold["paragraphHints"]} />;
    }
  }
  if (artifact.type === "speaking_progress") return <p>段落：{String(artifact.data.sectionTitle ?? artifact.data.sectionId)} · {artifact.data.mode === "single" ? "單層概念圖" : "Macro／Micro 雙層圖"} · {artifact.data.hintsVisible ? "已顯示英文提示" : "未顯示英文提示"}</p>;
  if (artifact.type === "audio") return <AudioArtifact artifact={artifact} />;
  if (artifact.type === "transcript") {
    return <TranscriptArtifact data={artifact.data} />;
  }
  if (artifact.type === "speech_evaluation") {
    return <EvaluationArtifact data={artifact.data} />;
  }
  if (artifact.type === "annotated_image") {
    const parsed = annotatedImageSchema.safeParse(artifact.data);
    const source = parsed.success
      ? allArtifacts.find(
          (item) => item.id === parsed.data.sourceImageArtifactId,
        )
      : undefined;
    if (parsed.success && source?.downloadUrl) {
      return (
        <AnnotatedImageCard
          sourceUrl={source.downloadUrl}
          annotated={parsed.data}
        />
      );
    }
  }
  if (
    ["generated_concept_map", "ai_concept_map", "concept_decisions"].includes(
      artifact.type,
    )
  ) {
    const source =
      artifact.type === "concept_decisions"
        ? artifact.data.accepted
        : artifact.data;
    const parsed = conceptMapSchema.safeParse(source);
    if (parsed.success) {
      return (
        <ConceptMapCard map={parsed.data} title={artifactTitle(artifact.type)} />
      );
    }
  }
  if (artifact.type === "image_analysis") {
    return (
      <ReadonlyMessageContent
        message={{
          role: "assistant",
          kind: "image_analysis",
          content: artifact.data,
        }}
      />
    );
  }
  if (artifact.type === "self_labels") {
    return (
      <ReadonlyMessageContent
        message={{ role: "student", kind: "labels", content: artifact.data }}
      />
    );
  }
  if (artifact.type === "sentences") {
    const sentences = stringArray(artifact.data.sentences);
    const originals = stringArray(artifact.data.originals);
    const levels = Array.isArray(artifact.data.hintLevels) ? artifact.data.hintLevels : [];
    if (originals.length === sentences.length && originals.length) {
      // Stage 6 research data: each sentence before and after its hints.
      return (
        <ol className="session-sentence-revisions">
          {sentences.map((sentence, index) => (
            <li key={`${index}-${sentence}`}>
              <small>
                原句：{originals[index]}
                {" · "}提示開到第 {typeof levels[index] === "number" ? levels[index] : 0} 級
              </small>
              <p>{sentence === originals[index] ? "（沒有修改）" : sentence}</p>
            </li>
          ))}
        </ol>
      );
    }
    return (
      <ReadonlyMessageContent
        message={{ role: "student", kind: "sentences", content: artifact.data }}
      />
    );
  }
  return <JsonFallback value={artifact.data} />;
}

function FullArtifactCard({
  artifact,
  allArtifacts,
}: {
  artifact: AdminLearningRecordArtifact;
  allArtifacts: AdminLearningRecordArtifact[];
}) {
  return (
    <article
      className={`learning-artifact ${artifact.supersededAt ? "superseded" : ""}`}
    >
      <header>
        <div>
          <h4>{artifactTitle(artifact.type)}</h4>
          <small>{formatDate(artifact.createdAt)}</small>
        </div>
        <div className="artifact-status-list">
          <span className="tag">{statusLabel(artifact.status)}</span>
          {artifact.supersededAt ? (
            <span className="tag warning">
              已被取代 · {formatDate(artifact.supersededAt)}
            </span>
          ) : null}
        </div>
      </header>
      <ArtifactBody artifact={artifact} allArtifacts={allArtifacts} />
    </article>
  );
}

function SessionMetadata({ session }: { session: AdminSessionMeta }) {
  return (
    <section className="session-metadata">
      <div>
        <span>Session ID</span>
        <strong>{session.id}</strong>
      </div>
      <div>
        <span>學生標籤</span>
        <strong>{session.studentLabel ?? "未命名"}</strong>
      </div>
      <div>
        <span>任務</span>
        <strong>{session.taskTitle}</strong>
      </div>
      <div>
        <span>目前階段</span>
        <strong>{STAGES.find((stage) => stage.id === session.currentStage)?.title ?? session.currentStage}</strong>
      </div>
      <div>
        <span>狀態</span>
        <strong>{session.completedAt ? "已完成" : "進行中"}</strong>
      </div>
      <div>
        <span>研究同意</span>
        <strong>
          {session.consentedAt
            ? `已同意（${formatDate(session.consentedAt)}）`
            : "尚未同意"}
        </strong>
      </div>
      <div>
        <span>開始時間</span>
        <strong>{formatDate(session.startedAt)}</strong>
      </div>
      <div>
        <span>完成時間</span>
        <strong>{formatDate(session.completedAt)}</strong>
      </div>
    </section>
  );
}

function StudentArtifactHistory({
  artifacts,
  currentStage,
}: {
  artifacts: ArtifactView[];
  currentStage: StageId;
}) {
  const visible = artifacts.filter(
    (artifact) =>
      artifact.type === "image" ||
      artifact.type === "audio" ||
      artifact.type === "annotated_image",
  );

  return (
    <>
      {visible.map((artifact) => {
        if (artifact.type === "image" && artifact.downloadUrl) {
          return (
            <div className="message-row student" key={artifact.id}>
              <div className="artifact-card">
                <div className="artifact-card-header">
                  <span>學生圖片</span>
                  <span className="tag">{statusLabel(artifact.status)}</span>
                </div>
                <SessionArtifactImage
                  className="artifact-image"
                  src={artifact.downloadUrl}
                  alt="學生上傳圖片"
                />
              </div>
            </div>
          );
        }
        if (artifact.type === "audio") {
          return (
            <div className="message-row student" key={artifact.id}>
              <div className="artifact-card">
                <div className="artifact-card-header">
                  <span>口說錄音</span>
                  <span className="tag">{statusLabel(artifact.status)}</span>
                </div>
                <AudioArtifact artifact={artifact} />
              </div>
            </div>
          );
        }
        if (
          artifact.type === "annotated_image" &&
          currentStage !== "image_analysis"
        ) {
          const parsed = annotatedImageSchema.safeParse(artifact.data);
          const source = parsed.success
            ? artifacts.find(
                (item) => item.id === parsed.data.sourceImageArtifactId,
              )
            : undefined;
          if (parsed.success && source?.downloadUrl) {
            return (
              <div className="message-row assistant" key={artifact.id}>
                <AnnotatedImageCard
                  sourceUrl={source.downloadUrl}
                  annotated={parsed.data}
                />
              </div>
            );
          }
        }
        return null;
      })}
    </>
  );
}

export function ReadonlyStudentSession({
  view,
  session,
}: {
  view: SessionView;
  session: AdminSessionMeta;
}) {
  const currentDefinition = view.stages.find(
    (stage) => stage.id === view.session.currentStage,
  )!;
  const visibleMessages = view.concealPriorStages
    ? view.messages.filter(
        (message) => message.stageId === view.session.currentStage,
      )
    : view.messages;
  const visibleArtifacts = view.concealPriorStages
    ? view.artifacts.filter(
        (artifact) => artifact.stageId === view.session.currentStage,
      )
    : view.artifacts;

  return (
    <div className="session-preview-content student-mode">
      <SessionMetadata session={session} />
      <div className="info-banner session-readonly-banner">
        <ShieldCheck size={16} />
        管理員唯讀預覽：此頁不會修改學生資料。
      </div>
      <main className="workspace student-workspace session-readonly-workspace">
        <section className="chat-shell">
          <header className="app-bar">
            <div className="app-bar-brand">
              <span className="brand-mark" aria-hidden="true">A3</span>
              <div>
                <strong>{view.task.title}</strong>
                <span>
                  第 {currentDefinition.order} / {view.stages.length} 階段
                </span>
              </div>
            </div>
            <StageStepper stages={view.stages} />
            <span className="readonly-pill">唯讀 · 按鈕已停用</span>
          </header>
          <div className="chat-scroll">
            <div className="chat-column">
              <div className="stage-intro">
                <div className="stage-intro-text">
                  <span className="stage-badge self">第 {currentDefinition.order} 階段</span>
                  <h1>{currentDefinition.title}</h1>
                  <p>
                    {
                      view.task.config.stageConfig[view.session.currentStage]
                        .instruction
                    }
                  </p>
                </div>
              </div>
              {!view.session.consented ? (
                <div className="consent-card">
                  <h3>研究參與同意</h3>
                  <p>{view.task.config.consentText}</p>
                  <div className="info-banner">此 session 尚未完成同意。</div>
                </div>
              ) : null}
              {view.concealPriorStages ? (
                <div className="info-banner">
                  <Lock size={15} /> 前測與練習內容目前依研究規則隱藏。
                </div>
              ) : null}
              {visibleMessages.map((message) => (
                <MessageCard message={message} key={message.id} />
              ))}
              <StudentArtifactHistory
                artifacts={visibleArtifacts}
                currentStage={view.session.currentStage}
              />
              {view.session.completed ? (
                <div className="consent-card">
                  <h3>研究流程已完成</h3>
                  <p>此 session 已完成全部學習階段。</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export function FullSessionLearningRecord({
  record,
}: {
  record: AdminSessionLearningRecord;
}) {
  const allArtifacts = record.stages.flatMap((stage) => stage.artifacts);

  return (
    <div className="session-preview-content full-mode">
      <header className="learning-record-title">
        <p className="eyebrow">AI3L Speaking Lab</p>
        <h1>Session 完整學習歷程</h1>
        <p>{record.session.taskTitle}</p>
      </header>
      <SessionMetadata session={record.session} />
      <div className="info-banner session-readonly-banner">
        <ShieldCheck size={16} />
        管理員唯讀資料：包含研究過程中隱藏的逐字稿與口說分析。
      </div>
      <div className="learning-stage-list">
        {record.stages.map((stage) => (
          <section className="learning-stage" key={stage.id}>
            <header className="learning-stage-header">
              <span>{stage.order}</span>
              <div>
                <h2>{stage.title}</h2>
                <p>{stage.description}</p>
              </div>
            </header>
            {stage.messages.length || stage.artifacts.length ? (
              <div className="learning-stage-content">
                {stage.messages.length ? (
                  <div className="learning-record-group">
                    <h3>對話與學生輸入</h3>
                    {stage.messages.map((message) => (
                      <MessageCard
                        message={message}
                        showHiddenFlag
                        key={message.id}
                      />
                    ))}
                  </div>
                ) : null}
                {stage.artifacts.length ? (
                  <div className="learning-record-group">
                    <h3>學習產物</h3>
                    {stage.artifacts.map((artifact) => (
                      <FullArtifactCard
                        artifact={artifact}
                        allArtifacts={allArtifacts}
                        key={artifact.id}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="learning-stage-empty">此階段尚無資料。</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
