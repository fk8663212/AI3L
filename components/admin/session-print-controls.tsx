"use client";
/* eslint-disable @next/next/no-img-element */

import { ArrowLeft, Eye, FileText, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdminSessionViewMode } from "@/lib/services/admin-session-service";

async function waitForPrintAssets(): Promise<void> {
  await document.fonts?.ready;
  await Promise.all(
    [...document.images].map(async (image) => {
      if (image.complete) return;
      try {
        await image.decode();
      } catch {
        // Image components supply a printable error state on load failure.
      }
    }),
  );
}

export function SessionPrintControls({
  sessionId,
  mode,
  autoPrint,
}: {
  sessionId: string;
  mode: AdminSessionViewMode;
  autoPrint: boolean;
}) {
  const autoPrintStarted = useRef(false);
  const [preparing, setPreparing] = useState(false);

  async function print() {
    setPreparing(true);
    await waitForPrintAssets();
    setPreparing(false);
    window.print();
  }

  useEffect(() => {
    if (!autoPrint || autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    void print();
  }, [autoPrint]);

  return (
    <div className="session-preview-toolbar" data-print-hidden>
      <Link className="button secondary" href="/admin">
        <ArrowLeft size={16} />
        返回後台
      </Link>
      <div className="session-view-switcher" aria-label="Session 檢視模式">
        <Link
          className={mode === "student" ? "active" : ""}
          href={`/admin/sessions/${sessionId}?mode=student`}
        >
          <Eye size={16} />
          學生視角
        </Link>
        <Link
          className={mode === "full" ? "active" : ""}
          href={`/admin/sessions/${sessionId}?mode=full`}
        >
          <FileText size={16} />
          完整學習歷程
        </Link>
      </div>
      <button className="button" type="button" onClick={print} disabled={preparing}>
        <Printer size={16} />
        {preparing ? "準備列印…" : "列印 PDF"}
      </button>
    </div>
  );
}

export function SessionArtifactImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="artifact-load-error" role="img" aria-label={alt}>
        圖片無法載入
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
