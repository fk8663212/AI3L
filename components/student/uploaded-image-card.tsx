"use client";

import Image from "next/image";
import { CheckCircle2, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  ArtifactView,
  SessionView,
} from "@/lib/services/session-service";

export function UploadedImageCard({
  artifact,
  title,
  alt,
  onDeleted,
}: {
  artifact: ArtifactView;
  title: string;
  alt: string;
  onDeleted: (view: SessionView) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteImage() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/student/uploads/image", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId: artifact.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "圖片刪除失敗。");
      }
      onDeleted(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "圖片刪除失敗。");
      setDeleting(false);
    }
  }

  return (
    <div className="artifact-card handdrawn-concept-card uploaded-image-card">
      <div className="artifact-card-header">
        <div>
          <strong>{title}</strong>
          <small>已完成私人上傳</small>
        </div>
        <CheckCircle2 size={20} aria-hidden="true" />
      </div>
      {artifact.downloadUrl ? (
        <a
          className="handdrawn-concept-link"
          href={artifact.downloadUrl}
          target="_blank"
          rel="noreferrer"
          title="開啟原尺寸圖片"
        >
          <Image
            className="handdrawn-concept-image"
            src={artifact.downloadUrl}
            alt={alt}
            width={640}
            height={480}
            unoptimized
          />
          <span>點擊預覽可查看原尺寸</span>
        </a>
      ) : null}
      <div className="artifact-card-body uploaded-image-actions">
        {confirming ? (
          <div className="delete-image-confirm">
            <span>確定刪除這張圖片？刪除後需要重新上傳。</span>
            <div>
              <button
                className="button secondary compact"
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
              >
                保留圖片
              </button>
              <button
                className="button danger compact"
                type="button"
                disabled={deleting}
                onClick={() => void deleteImage()}
              >
                {deleting ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <Trash2 size={15} aria-hidden="true" />
                )}
                確認刪除
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button danger-outline compact"
            type="button"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={15} aria-hidden="true" />
            刪除圖片
          </button>
        )}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
