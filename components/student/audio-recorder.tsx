"use client";

import { uploadStudentFile } from "@/lib/client/upload-student-file";
import { Mic, Pause, RotateCcw, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StageId } from "@/lib/domain/stages";
import { normalizeAudioMimeType } from "@/lib/domain/recordings";
import type { SessionView } from "@/lib/services/session-service";

type SavePhase = "idle" | "uploading" | "processing";

const UPLOAD_TIMEOUT_MS = 120_000;
const PROCESSING_TIMEOUT_MS = 75_000;
const RECONCILE_TIMEOUT_MS = 15_000;

function preferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/webm",
  ];
  return (
    candidates.find(
      (candidate) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(candidate),
    ) ?? ""
  );
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

function hasSavedRecording(
  view: SessionView,
  stage: StageId,
  stagingPathname: string,
): boolean {
  return view.artifacts.some(
    (artifact) =>
      artifact.stageId === stage &&
      artifact.type === "audio" &&
      artifact.status === "ready" &&
      artifact.data.stagingPathname === stagingPathname,
  );
}

async function fetchSessionView(): Promise<SessionView | null> {
  try {
    const response = await fetch("/api/student/session", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.data ?? null;
  } catch {
    return null;
  }
}

async function reconcileSavedRecording(
  stage: StageId,
  stagingPathname: string,
): Promise<SessionView | null> {
  const deadline = Date.now() + RECONCILE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const view = await fetchSessionView();
    if (view && hasSavedRecording(view, stage, stagingPathname)) return view;
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }
  return null;
}

export function AudioRecorder({
  stage,
  sessionId,
  minimumSeconds = 30,
  maximumSeconds = 120,
  onSaved,
}: {
  stage: StageId;
  sessionId: string;
  minimumSeconds?: number;
  maximumSeconds?: number;
  onSaved: (view: SessionView) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [previewUrl],
  );

  async function start() {
    setError("");
    setBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.start(500);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maximumSeconds) stop();
      }, 250);
    } catch {
      setError("無法使用麥克風，請確認瀏覽器權限後重試。");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setBlob(null);
    setSeconds(0);
    setSavePhase("idle");
    setUploadProgress(0);
    setError("");
  }

  async function save() {
    if (!blob) return;
    if (seconds < minimumSeconds) {
      setError(`錄音至少需要 ${minimumSeconds} 秒。`);
      return;
    }
    setBusy(true);
    setSavePhase("uploading");
    setUploadProgress(0);
    setError("");
    let stagingPathname = "";
    let activePhase: SavePhase = "uploading";
    try {
      const extension = extensionForMime(blob.type);
      const uploadContentType = normalizeAudioMimeType(blob.type);
      const pathname = `student/${sessionId}/${stage}/recording.${extension}`;
      const uploadController = new AbortController();
      const uploadTimeout = window.setTimeout(
        () => uploadController.abort(),
        UPLOAD_TIMEOUT_MS,
      );
      let result: Awaited<ReturnType<typeof uploadStudentFile>>;
      try {
        result = await uploadStudentFile(pathname, blob, {
          access: "private",
          handleUploadUrl: "/api/student/uploads/blob",
          clientPayload: JSON.stringify({ kind: "audio", stage }),
          contentType: uploadContentType,
          abortSignal: uploadController.signal,
          onUploadProgress: ({ percentage }) => {
            setUploadProgress(Math.round(percentage));
          },
        });
      } finally {
        window.clearTimeout(uploadTimeout);
      }
      stagingPathname = result.pathname;
      setUploadProgress(100);
      setSavePhase("processing");
      activePhase = "processing";

      const processingController = new AbortController();
      const processingTimeout = window.setTimeout(
        () => processingController.abort(),
        PROCESSING_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetch("/api/student/uploads/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "audio",
            stage,
            url: result.url,
            durationSeconds: seconds,
          }),
          signal: processingController.signal,
        });
      } finally {
        window.clearTimeout(processingTimeout);
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: SessionView;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ??
            (response.status === 504
              ? "錄音分析逾時，請稍後再試。"
              : "錄音保存失敗。"),
        );
      }
      if (!payload?.data) throw new Error("伺服器未回傳錄音保存結果。");
      onSaved(payload.data);
      reset();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        const recovered = stagingPathname
          ? await reconcileSavedRecording(stage, stagingPathname)
          : null;
        if (recovered) {
          onSaved(recovered);
          reset();
          return;
        }
        setError(
          activePhase === "uploading"
            ? "錄音上傳逾時，請確認網路連線後重試。"
            : "錄音存入錄音儲存庫 超過預期時間，請稍後重試；已完成的錄音不會重複保存。",
        );
      } else {
        setError(cause instanceof Error ? cause.message : "錄音保存失敗。");
      }
    } finally {
      setBusy(false);
      setSavePhase("idle");
    }
  }

  const busyLabel =
    savePhase === "uploading"
      ? `正在上傳錄音 ${uploadProgress}%`
      : "正在存入錄音儲存庫…";

  return (
    <div>
      <div className="audio-recorder">
        {!recording && !blob ? (
          <button
            className="record-button"
            type="button"
            onClick={start}
            aria-label="開始錄音"
          >
            <Mic size={20} />
          </button>
        ) : null}
        {recording ? (
          <button
            className="record-button recording"
            type="button"
            onClick={stop}
            aria-label="停止錄音"
          >
            <Pause size={19} />
          </button>
        ) : null}
        <span className="recording-time">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </span>
        <span style={{ color: "var(--ink-soft)", fontSize: ".78rem" }}>
          {minimumSeconds}–{maximumSeconds} 秒
        </span>
        {previewUrl ? (
          <audio controls src={previewUrl}>
            <track kind="captions" />
          </audio>
        ) : null}
        {blob ? (
          <>
            <button
              className="button secondary"
              type="button"
              onClick={reset}
              disabled={busy}
            >
              <RotateCcw size={16} />
              重錄
            </button>
            <button className="button" type="button" onClick={save} disabled={busy}>
              <UploadCloud size={16} />
              {busy ? busyLabel : "保存錄音"}
            </button>
          </>
        ) : null}
      </div>
      {busy ? (
        <div className="upload-status" role="status" aria-live="polite">
          {savePhase === "uploading"
            ? "正在安全上傳錄音，請勿關閉頁面。"
            : "錄音已上傳，正在存入錄音儲存庫；逐字稿與口說評估會在背景繼續處理。"}
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
