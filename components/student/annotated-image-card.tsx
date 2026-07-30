"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AnnotatedImage } from "@/lib/ai/schemas";

const categoryColors: Record<string, string> = {
  person: "#b84a3a",
  object: "#2f6da3",
  event: "#7d4da3",
  place: "#2f7d65",
  feeling: "#bd6f21",
  quality: "#82621b",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedRegion(region: AnnotatedImage["annotations"][number]["region"]) {
  const x = clamp(region.x, 0, 999);
  const y = clamp(region.y, 0, 999);
  return {
    x,
    y,
    width: clamp(region.width, 1, 1000 - x),
    height: clamp(region.height, 1, 1000 - y),
  };
}

export function AnnotatedImageCard({
  sourceUrl,
  annotatedUrl,
  annotated,
}: {
  sourceUrl: string;
  annotatedUrl?: string | null;
  annotated: AnnotatedImage;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function downloadComposite() {
    setDownloading(true);
    setError("");
    try {
      if (annotatedUrl) {
        const response = await fetch(annotatedUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("無法讀取 AI 標記版本。");
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "ai-annotated-drawing.webp";
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }

      const response = await fetch(sourceUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("無法讀取原始手繪圖。");
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("瀏覽器無法建立標記圖片。");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const lineWidth = Math.max(2, Math.round(canvas.width / 420));
      const fontSize = Math.max(15, Math.round(canvas.width / 55));
      context.lineWidth = lineWidth;
      context.font = `700 ${fontSize}px sans-serif`;
      context.textBaseline = "top";

      for (const item of annotated.annotations) {
        const region = boundedRegion(item.region);
        const x = (region.x / 1000) * canvas.width;
        const y = (region.y / 1000) * canvas.height;
        const width = (region.width / 1000) * canvas.width;
        const height = (region.height / 1000) * canvas.height;
        const color = categoryColors[item.category] ?? "#b84a3a";
        const label = `${item.labelEn} · ${item.labelZh}`;
        const padding = Math.max(4, Math.round(fontSize * 0.3));
        const labelWidth = Math.min(
          canvas.width,
          context.measureText(label).width + padding * 2,
        );
        const labelHeight = fontSize + padding * 2;
        const labelX = clamp(x, 0, canvas.width - labelWidth);
        const labelY = y >= labelHeight ? y - labelHeight : y;

        context.strokeStyle = color;
        context.strokeRect(x, y, width, height);
        context.fillStyle = color;
        context.fillRect(labelX, labelY, labelWidth, labelHeight);
        context.fillStyle = "#ffffff";
        context.fillText(
          label,
          labelX + padding,
          labelY + padding,
          labelWidth - padding * 2,
        );
      }

      const output = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!output) throw new Error("標記圖片輸出失敗。");
      const url = URL.createObjectURL(output);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ai-annotated-drawing.png";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "標記圖片下載失敗。");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="artifact-card annotated-image-card">
      <div className="artifact-card-header">
        <div>
          <span>AI 標記後的手繪圖</span>
          <small>{annotated.annotations.length} 個可辨識元素</small>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={downloadComposite}
          disabled={downloading}
        >
          {downloading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Download size={15} />
          )}
          下載標記版本
        </button>
      </div>
      <div className="annotated-image-stage">
        <div className="annotated-image-canvas">
          {/* Authenticated private artifact route; image optimization is intentionally skipped. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={annotatedUrl ?? sourceUrl}
            alt="學生手繪圖的 AI 英文標記版本"
          />
          {!annotatedUrl ? (
            <div className="annotation-layer" aria-label="AI 圖像標記">
              {annotated.annotations.map((item) => {
                const region = boundedRegion(item.region);
                return (
                  <div
                    className="annotation-box"
                    data-category={item.category}
                    key={item.id}
                    style={{
                      left: `${region.x / 10}%`,
                      top: `${region.y / 10}%`,
                      width: `${region.width / 10}%`,
                      height: `${region.height / 10}%`,
                    }}
                  >
                    <span>
                      {item.labelEn}
                      <small>{item.labelZh}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="artifact-card-body annotation-legend">
        {annotated.annotations.map((item) => (
          <span data-category={item.category} key={item.id}>
            {item.labelEn} · {item.labelZh}
          </span>
        ))}
      </div>
    </div>
  );
}
