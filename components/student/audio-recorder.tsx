"use client";

import { uploadPresigned } from "@vercel/blob/client";
import { LoaderCircle, Mic, Pause, RotateCcw, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StageId } from "@/lib/domain/stages";
import { normalizeAudioMimeType } from "@/lib/domain/recordings";
import {
  isSilentRecording,
  rmsLevel,
  VOICE_LEVEL_THRESHOLD,
  type VoiceActivity,
} from "@/lib/domain/voice-activity";
import type { SessionView } from "@/lib/services/session-service";

type SavePhase = "idle" | "uploading" | "processing";
/**
 * idle: nothing in progress (a finished take may be shown).
 * starting: waiting for microphone permission and the recorder.
 * recording: capturing audio.
 * finishing: stop was pressed; waiting for the recorder's last chunk.
 */
type RecordPhase = "idle" | "starting" | "recording" | "finishing";

const UPLOAD_TIMEOUT_MS = 120_000;
const PROCESSING_TIMEOUT_MS = 75_000;
const RECONCILE_TIMEOUT_MS = 15_000;
const RECONCILE_REQUEST_TIMEOUT_MS = 5_000;
const METER_INTERVAL_MS = 100;
/** If the recorder never reports its last chunk, finish with what we have. */
const FINISH_TIMEOUT_MS = 3_000;

class UploadCancelledError extends Error {}

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
    const response = await fetch("/api/student/session", {
      cache: "no-store",
      signal: AbortSignal.timeout(RECONCILE_REQUEST_TIMEOUT_MS),
    });
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

/**
 * Creates the AudioContext for the level meter. It must be created and resumed
 * inside the tap itself: iOS Safari keeps a context made after an await
 * suspended, and a suspended meter reads every recording as silent.
 */
function createMeterContext(): AudioContext | null {
  try {
    const context = new AudioContext();
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

type Meter = {
  context: AudioContext;
  timer: ReturnType<typeof setInterval>;
  voicedMs: number;
  peak: number;
  /** Frames read while the context was running; 0 means no measurement. */
  frames: number;
};

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
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const meterRef = useRef<Meter | null>(null);
  const previewUrlRef = useRef("");
  // Read and written synchronously, so a double tap cannot start twice.
  const phaseRef = useRef<RecordPhase>("idle");
  const uploadControllerRef = useRef<AbortController | null>(null);
  const uploadCancelledRef = useRef(false);
  const [phase, setPhaseState] = useState<RecordPhase>("idle");
  const [level, setLevel] = useState(0);
  const [voice, setVoice] = useState<VoiceActivity | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrlState] = useState("");
  const [busy, setBusy] = useState(false);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  function setPhase(next: RecordPhase) {
    phaseRef.current = next;
    setPhaseState(next);
  }

  function setPreviewUrl(next: string) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrlState(next);
  }

  // Releases the microphone, timers and meter. Safe to call more than once.
  function releaseCapture() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    finishTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Unmount only: stop everything that could keep running.
  useEffect(
    () => () => {
      // A start() still waiting for permission sees this and gives up.
      phaseRef.current = "idle";
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const meter = meterRef.current;
      meterRef.current = null;
      if (meter) {
        clearInterval(meter.timer);
        void meter.context.close().catch(() => undefined);
      }
      uploadControllerRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  /** Measures how much of the recording is voiced, so silence is caught here. */
  function startMeter(stream: MediaStream, context: AudioContext | null) {
    if (!context) {
      // No Web Audio: record without the silence check; the server and the
      // transcription prompt still refuse to invent speech.
      meterRef.current = null;
      return;
    }
    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter: Meter = {
        context,
        voicedMs: 0,
        peak: 0,
        frames: 0,
        timer: setInterval(() => {
          if (context.state !== "running") {
            void context.resume().catch(() => undefined);
            return;
          }
          analyser.getFloatTimeDomainData(samples);
          const current = rmsLevel(samples);
          meter.frames += 1;
          if (current > VOICE_LEVEL_THRESHOLD) meter.voicedMs += METER_INTERVAL_MS;
          meter.peak = Math.max(meter.peak, current);
          setLevel(current);
        }, METER_INTERVAL_MS),
      };
      meterRef.current = meter;
    } catch {
      void context.close().catch(() => undefined);
      meterRef.current = null;
    }
  }

  function stopMeter(): VoiceActivity | null {
    const meter = meterRef.current;
    meterRef.current = null;
    setLevel(0);
    if (!meter) return null;
    clearInterval(meter.timer);
    void meter.context.close().catch(() => undefined);
    // A meter that never ran measured nothing: report no measurement rather
    // than a silent recording.
    if (meter.frames === 0) return null;
    return {
      voicedSeconds: Math.round(meter.voicedMs / 100) / 10,
      peakLevel: Math.min(1, Math.round(meter.peak * 1000) / 1000),
    };
  }

  async function start() {
    if (phaseRef.current !== "idle" || busy) return;
    setPhase("starting");
    setError("");
    setBlob(null);
    setPreviewUrl("");
    setVoice(null);
    setSeconds(0);
    const context = createMeterContext();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      void context?.close().catch(() => undefined);
      setPhase("idle");
      setError("無法使用麥克風，請確認瀏覽器權限後重試。");
      return;
    }
    // Unmounted, or reset, while the permission prompt was open.
    // (Read through a widened type: TypeScript narrows the ref across the await.)
    if ((phaseRef.current as RecordPhase) !== "starting") {
      stream.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      return;
    }
    streamRef.current = stream;
    startMeter(stream, context);
    let recorder: MediaRecorder;
    try {
      const mimeType = preferredMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (recorderRef.current === recorder && event.data.size) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => finish(recorder);
      recorder.onerror = () => {
        if (recorderRef.current !== recorder) return;
        setError("錄音中斷了，請重新錄音。");
        stop();
      };
      recorderRef.current = recorder;
      recorder.start(500);
    } catch {
      recorderRef.current = null;
      stopMeter();
      releaseCapture();
      setPhase("idle");
      setError("這個瀏覽器無法錄音，請改用最新版的 Chrome 或 Safari。");
      return;
    }
    // The microphone can disappear mid-take (headset unplugged, another app,
    // a phone call). Treat that as pressing stop.
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (recorderRef.current === recorder && phaseRef.current === "recording") stop();
      };
    });
    startedAtRef.current = Date.now();
    setPhase("recording");
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maximumSeconds) stop();
    }, 250);
  }

  // Builds the take from the recorded chunks. Runs once per recorder.
  function finish(recorder: MediaRecorder) {
    if (recorderRef.current !== recorder) return;
    recorderRef.current = null;
    releaseCapture();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (chunks.length) {
      const recorded = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      setBlob(recorded);
      setPreviewUrl(URL.createObjectURL(recorded));
    } else {
      setError("沒有錄到聲音資料，請再錄一次。");
    }
    setPhase("idle");
  }

  function stop() {
    if (phaseRef.current !== "recording") return;
    setPhase("finishing");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    setVoice(stopMeter());
    const recorder = recorderRef.current;
    if (!recorder) {
      releaseCapture();
      setPhase("idle");
      return;
    }
    if (recorder.state === "inactive") {
      finish(recorder);
      return;
    }
    recorder.stop();
    // Some browsers drop the stop event when the stream already ended.
    finishTimerRef.current = setTimeout(() => finish(recorder), FINISH_TIMEOUT_MS);
  }

  function reset() {
    setPreviewUrl("");
    setBlob(null);
    setSeconds(0);
    setSavePhase("idle");
    setUploadProgress(0);
    setError("");
    setVoice(null);
  }

  function cancelUpload() {
    uploadCancelledRef.current = true;
    uploadControllerRef.current?.abort();
  }

  async function save() {
    if (!blob || busy) return;
    if (seconds < minimumSeconds) {
      setError(`錄音至少需要 ${minimumSeconds} 秒。`);
      return;
    }
    setBusy(true);
    setSavePhase("uploading");
    setUploadProgress(0);
    setError("");
    uploadCancelledRef.current = false;
    let stagingPathname = "";
    let activePhase: SavePhase = "uploading";
    try {
      const extension = extensionForMime(blob.type);
      const uploadContentType = normalizeAudioMimeType(blob.type);
      const pathname = `student/${sessionId}/${stage}/recording.${extension}`;
      const uploadController = new AbortController();
      uploadControllerRef.current = uploadController;
      const uploadTimeout = window.setTimeout(
        () => uploadController.abort(),
        UPLOAD_TIMEOUT_MS,
      );
      let result: Awaited<ReturnType<typeof uploadPresigned>>;
      try {
        result = await uploadPresigned(pathname, blob, {
          access: "private",
          handleUploadUrl: "/api/student/uploads/blob",
          clientPayload: JSON.stringify({ kind: "audio", stage }),
          contentType: uploadContentType,
          abortSignal: uploadController.signal,
          onUploadProgress: ({ percentage }) => {
            setUploadProgress(Math.round(percentage));
          },
        });
      } catch (cause) {
        if (uploadCancelledRef.current) throw new UploadCancelledError();
        throw cause;
      } finally {
        window.clearTimeout(uploadTimeout);
        uploadControllerRef.current = null;
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
            ...(voice ? { voice } : {}),
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
      if (cause instanceof UploadCancelledError) {
        setError("已取消上傳，錄音還在，可以再按一次保存。");
      } else if (cause instanceof DOMException && cause.name === "AbortError") {
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
            : "錄音存入 Google Drive 超過預期時間，請稍後重試；已完成的錄音不會重複保存。",
        );
      } else {
        setError(cause instanceof Error ? cause.message : "錄音保存失敗。");
      }
    } finally {
      setBusy(false);
      setSavePhase("idle");
    }
  }

  const silent = isSilentRecording(voice ?? undefined);
  const busyLabel =
    savePhase === "uploading"
      ? `正在上傳錄音 ${uploadProgress}%`
      : "正在存入 Google Drive…";
  const showStart = !blob && (phase === "idle" || phase === "starting");

  return (
    <div>
      <div className="audio-recorder">
        {showStart ? (
          <button
            className="record-button"
            type="button"
            onClick={start}
            disabled={phase === "starting"}
            aria-label={phase === "starting" ? "正在開啟麥克風" : "開始錄音"}
          >
            {phase === "starting" ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <Mic size={20} />
            )}
          </button>
        ) : null}
        {phase === "recording" || phase === "finishing" ? (
          <button
            className="record-button recording"
            type="button"
            onClick={stop}
            disabled={phase === "finishing"}
            aria-label={phase === "finishing" ? "正在整理錄音" : "停止錄音"}
          >
            {phase === "finishing" ? (
              <LoaderCircle className="spin" size={19} />
            ) : (
              <Pause size={19} />
            )}
          </button>
        ) : null}
        <span className="recording-time">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </span>
        <span style={{ color: "var(--ink-soft)", fontSize: ".78rem" }}>
          {phase === "starting"
            ? "正在開啟麥克風…"
            : `${minimumSeconds}–${maximumSeconds} 秒`}
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
              {busy ? busyLabel : silent ? "仍要保存" : "保存錄音"}
            </button>
            {busy && savePhase === "uploading" ? (
              <button
                className="button secondary"
                type="button"
                onClick={cancelUpload}
              >
                <X size={16} aria-hidden="true" />
                取消上傳
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {phase === "recording" ? (
        <div className="voice-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.round((level / 0.2) * 100))}%` }} />
        </div>
      ) : null}
      {blob && silent ? (
        <div className="error-banner" role="alert">
          這段錄音幾乎沒有聽到你的聲音。請確認麥克風沒有靜音、靠近一點，再按「重錄」。沒有聲音的錄音不會產生逐字稿或口說分析。
        </div>
      ) : null}
      {busy ? (
        <div className="upload-status" role="status" aria-live="polite">
          {savePhase === "uploading"
            ? "正在安全上傳錄音，請勿關閉頁面。"
            : "錄音已上傳，正在存入 Google Drive；逐字稿與口說評估會在背景繼續處理。"}
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
