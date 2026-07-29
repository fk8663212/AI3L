"use client";

import { upload } from "@vercel/blob/client";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { SessionView } from "@/lib/services/session-service";

async function normalizeImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const maximum = 2048;
  const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法處理圖片。");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const output = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  if (!output) throw new Error("圖片壓縮失敗。");
  return new File([output], "drawing.webp", { type: "image/webp" });
}

export function ImageUploader({
  sessionId,
  onSaved,
}: {
  sessionId: string;
  onSaved: (view: SessionView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const normalized = await normalizeImage(file);
      const result = await upload(
        `student/${sessionId}/visualization/drawing.webp`,
        normalized,
        {
          access: "private",
          handleUploadUrl: "/api/student/uploads/blob",
          clientPayload: JSON.stringify({
            kind: "image",
            stage: "visualization",
          }),
          contentType: "image/webp",
        },
      );
      const response = await fetch("/api/student/uploads/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          stage: "visualization",
          url: result.url,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "圖片保存失敗。");
      }
      onSaved(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "圖片保存失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="upload-drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => choose(event.target.files?.[0])}
          disabled={busy}
        />
        <span>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={22} />
              <br />
              正在移除 EXIF 並安全上傳…
            </>
          ) : (
            <>
              <ImagePlus size={25} />
              <br />
              <strong>點此拍攝或選擇手繪圖</strong>
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
