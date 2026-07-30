"use client";

import { upload } from "@vercel/blob/client";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { SessionView } from "@/lib/services/session-service";

type UploadStep = "idle" | "preparing" | "uploading" | "fallback" | "saving";
type ImageUploadStage = "visualization" | "self_concept_map";

const DIRECT_UPLOAD_IDLE_TIMEOUT_MS = 12_000;
const DIRECT_UPLOAD_TOTAL_TIMEOUT_MS = 45_000;
const MAX_SOURCE_SIZE_BYTES = 25 * 1024 * 1024;

async function normalizeImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("請選擇 JPG、PNG 或 WebP 圖片。");
  }
  if (file.size > MAX_SOURCE_SIZE_BYTES) {
    throw new Error("原始圖片不可超過 25 MB。");
  }

  const bitmap = await createImageBitmap(file);
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
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setStep("preparing");
    setProgress(0);
    try {
      const normalized = await normalizeImage(file);
      setStep("uploading");

      const directController = new AbortController();
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

      let result: Awaited<ReturnType<typeof upload>>;
      try {
        const filename =
          stage === "visualization" ? "drawing.webp" : "concept-map.webp";
        result = await upload(
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
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        setStep("fallback");
        setProgress(0);
        const fallbackController = new AbortController();
        const fallbackTimer = setTimeout(
          () => fallbackController.abort(),
          DIRECT_UPLOAD_TOTAL_TIMEOUT_MS,
        );
        try {
          const view = await fallbackUpload(
            normalized,
            stage,
            fallbackController.signal,
          );
          onSaved(view);
          return;
        } finally {
          clearTimeout(fallbackTimer);
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(totalTimer);
      }

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
      setBusy(false);
      setStep("idle");
      setProgress(0);
    }
  }

  const busyText =
    step === "preparing"
      ? "正在移除 EXIF 並壓縮圖片…"
      : step === "uploading"
        ? `正在安全上傳${progress > 0 ? ` ${progress}%` : "…"}`
        : step === "fallback"
          ? "直傳較慢，正在切換備援通道…"
          : "正在確認圖片已保存…";

  return (
    <div>
      <label className="upload-drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
              {step === "uploading" && progress > 0 ? (
                <span className="upload-progress" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </span>
              ) : null}
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
              會自動縮放並移除相片定位資訊
            </>
          )}
        </span>
      </label>
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
