"use client";

import { upload } from "@vercel/blob/client";
import { Mic, Pause, RotateCcw, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StageId } from "@/lib/domain/stages";
import type { SessionView } from "@/lib/services/session-service";

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
    setError("");
  }

  async function save() {
    if (!blob) return;
    if (seconds < minimumSeconds) {
      setError(`錄音至少需要 ${minimumSeconds} 秒。`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const extension = extensionForMime(blob.type);
      const pathname = `student/${sessionId}/${stage}/recording.${extension}`;
      const result = await upload(pathname, blob, {
        access: "private",
        handleUploadUrl: "/api/student/uploads/blob",
        clientPayload: JSON.stringify({ kind: "audio", stage }),
        contentType: blob.type || "audio/webm",
      });
      const response = await fetch("/api/student/uploads/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "audio",
          stage,
          url: result.url,
          durationSeconds: seconds,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "錄音保存失敗。");
      }
      onSaved(payload.data);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "錄音保存失敗。");
    } finally {
      setBusy(false);
    }
  }

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
              {busy ? "正在存入 Drive…" : "保存錄音"}
            </button>
          </>
        ) : null}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
