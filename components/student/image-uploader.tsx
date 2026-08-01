"use client";

import { uploadPresigned } from "@vercel/blob/client";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import type { SessionView } from "@/lib/services/session-service";

type UploadStep =
  | "idle"
  | "converting"
  | "preparing"
  | "uploading"
  | "fallback"
  | "saving";
type ImageUploadStage = "visualization" | "self_concept_map";

const DIRECT_UPLOAD_IDLE_TIMEOUT_MS = 12_000;
const DIRECT_UPLOAD_TOTAL_TIMEOUT_MS = 45_000;
const FALLBACK_UPLOAD_TOTAL_TIMEOUT_MS = 75_000;
const MAX_SOURCE_SIZE_BYTES = 25 * 1024 * 1024;
const STANDARD_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const HEIC_IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

class UploadCancelledError extends Error {}

function isHeicFile(file: File): boolean {
  return (
    HEIC_IMAGE_TYPES.has(file.type.toLowerCase()) ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

async function normalizeImage(file: File): Promise<File> {
  if (file.size > MAX_SOURCE_SIZE_BYTES) {
    throw new Error("原始圖片不可超過 25 MB。");
  }
  if (file.size < 1) {
    throw new Error("圖片檔案是空的，請重新選擇。");
  }

  let source: Blob = file;
  if (isHeicFile(file)) {
    try {
      const { heicTo } = await import("heic-to/csp");
      source = await heicTo({
        blob: file,
        type: "image/jpeg",
        quality: 0.9,
      });
    } catch {
      throw new Error(
        "HEIC／HEIF 圖片轉換失敗，請改用 JPG、PNG 或 WebP 後重試。",
      );
    }
  } else if (!STANDARD_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error("請選擇 HEIC、HEIF、JPG、PNG 或 WebP 圖片。");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error("瀏覽器無法讀取這張圖片，請改用其他圖片後重試。");
  }
  const maximum = 1800;
  const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法處理圖片。");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const output = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!output) throw new Error("圖片壓縮失敗。");
  return new File([output], "drawing.webp", { type: "image/webp" });
}

async function readApiPayload(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "圖片保存失敗。");
  }
  return payload;
}

async function fallbackUpload(
  normalized: File,
  stage: ImageUploadStage,
  signal: AbortSignal,
): Promise<SessionView> {
  const formData = new FormData();
  formData.set("file", normalized);
  formData.set("stage", stage);
  const response = await fetch("/api/student/uploads/image", {
    method: "POST",
    body: formData,
    signal,
  });
  const payload = await readApiPayload(response);
  return payload.data;
}

export function ImageUploader({
  sessionId,
  stage,
  onSaved,
}: {
  sessionId: string;
  stage: ImageUploadStage;
  onSaved: (view: SessionView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);
  const activeController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);

  function cancelUpload() {
    cancelRequested.current = true;
    activeController.current?.abort();
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    cancelRequested.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    setStep(isHeicFile(file) ? "converting" : "preparing");
    setProgress(0);
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      const normalized = await normalizeImage(file);
      if (cancelRequested.current) throw new UploadCancelledError();
      setStep("uploading");

      const directController = new AbortController();
      activeController.current = directController;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => directController.abort(),
          DIRECT_UPLOAD_IDLE_TIMEOUT_MS,
        );
      };
      resetIdleTimer();
      const totalTimer = setTimeout(
        () => directController.abort(),
        DIRECT_UPLOAD_TOTAL_TIMEOUT_MS,
      );

      let result: Awaited<ReturnType<typeof uploadPresigned>>;
      try {
        const filename =
          stage === "visualization" ? "drawing.webp" : "concept-map.webp";
        result = await uploadPresigned(
          `student/${sessionId}/${stage}/${filename}`,
          normalized,
          {
            access: "private",
            handleUploadUrl: "/api/student/uploads/blob",
            clientPayload: JSON.stringify({
              kind: "image",
              stage,
            }),
            contentType: "image/webp",
            abortSignal: directController.signal,
            onUploadProgress: ({ percentage }) => {
              resetIdleTimer();
              setProgress(Math.max(1, Math.min(100, Math.round(percentage))));
            },
          },
        );
      } catch {
        if (cancelRequested.current) throw new UploadCancelledError();
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        setStep("fallback");
        setProgress(0);
        const fallbackController = new AbortController();
        activeController.current = fallbackController;
        const fallbackTimer = setTimeout(
          () => fallbackController.abort(),
          FALLBACK_UPLOAD_TOTAL_TIMEOUT_MS,
        );
        try {
          const view = await fallbackUpload(
            normalized,
            stage,
            fallbackController.signal,
          );
          if (cancelRequested.current) throw new UploadCancelledError();
          onSaved(view);
          return;
        } finally {
          clearTimeout(fallbackTimer);
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(totalTimer);
      }

      activeController.current = null;
      setStep("saving");
      const response = await fetch("/api/student/uploads/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          stage,
          url: result.url,
        }),
      });
      const payload = await readApiPayload(response);
      onSaved(payload.data);
    } catch (cause) {
      if (cause instanceof UploadCancelledError || cancelRequested.current) {
        setNotice("已取消上傳，可重新選擇圖片。");
        return;
      }
      const timedOut =
        cause instanceof DOMException && cause.name === "AbortError";
      setError(
        timedOut
          ? "上傳逾時，請確認網路後再試一次。"
          : cause instanceof Error
            ? cause.message
            : "圖片保存失敗。",
      );
    } finally {
      activeController.current = null;
      cancelRequested.current = false;
      setBusy(false);
      setStep("idle");
      setProgress(0);
    }
  }

  const busyText =
    step === "converting"
      ? "正在將 HEIC／HEIF 轉為可上傳格式…"
      : step === "preparing"
        ? "正在移除 EXIF 並壓縮圖片…"
        : step === "uploading"
          ? `正在安全上傳${progress > 0 ? ` ${progress}%` : "…"}`
          : step === "fallback"
            ? "直傳較慢，正在切換備援通道…"
            : stage === "visualization"
              ? "圖片已保存，正在請 AI 預先辨識更多單字…"
              : "正在確認圖片已保存…";
  const progressIsDeterminate =
    step === "uploading" || step === "saving";
  const displayedProgress =
    step === "saving" ? 100 : progress;

  return (
    <div>
      <label className="upload-drop">
        <input
          type="file"
          accept=".heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            void choose(selected);
          }}
          disabled={busy}
        />
        <span>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={22} />
              <br />
              <span role="status" aria-live="polite">
                {busyText}
              </span>
              <span
                className={`upload-progress${
                  progressIsDeterminate ? "" : " indeterminate"
                }`}
                role="progressbar"
                aria-label={busyText}
                aria-valuemin={progressIsDeterminate ? 0 : undefined}
                aria-valuemax={progressIsDeterminate ? 100 : undefined}
                aria-valuenow={
                  progressIsDeterminate ? displayedProgress : undefined
                }
              >
                <span
                  style={
                    progressIsDeterminate
                      ? { width: `${displayedProgress}%` }
                      : undefined
                  }
                />
              </span>
            </>
          ) : (
            <>
              <ImagePlus size={25} />
              <br />
              <strong>
                {stage === "visualization"
                  ? "點此拍攝或選擇手繪情境圖"
                  : "點此拍攝或選擇手繪概念圖"}
              </strong>
              <br />
              支援 HEIC、HEIF、JPG、PNG、WebP，並會移除相片定位資訊
            </>
          )}
        </span>
      </label>
      {busy && step !== "saving" ? (
        <button
          className="button secondary upload-cancel-button"
          type="button"
          onClick={cancelUpload}
        >
          <X size={16} aria-hidden="true" />
          取消上傳
        </button>
      ) : null}
      {notice ? <div className="info-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
