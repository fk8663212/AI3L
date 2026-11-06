"use client";

import { uploadPresigned } from "@vercel/blob/client";

type Options = Parameters<typeof uploadPresigned>[2];
type UploadResult = { url: string; pathname: string };

export async function uploadStudentFile(pathname: string, body: Blob, options: Options): Promise<UploadResult> {
  const strategy = await fetch("/api/student/uploads/blob", { signal: options.abortSignal });
  const config = await strategy.json();
  if (!strategy.ok) throw new Error(config.error?.message ?? "無法取得上傳設定。");
  if (config.storage !== "local") return uploadPresigned(pathname, body, options);

  const payload = JSON.parse(options.clientPayload ?? "{}");
  const form = new FormData();
  form.set("file", new Blob([body], { type: options.contentType ?? body.type }), "upload");
  form.set("pathname", pathname);
  form.set("kind", payload.kind);
  form.set("stage", payload.stage);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (options.abortSignal?.aborted) { reject(new DOMException("Upload aborted", "AbortError")); return; }
    xhr.open("POST", "/api/student/uploads/local");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onUploadProgress?.({ loaded: event.loaded, total: event.total, percentage: event.loaded / event.total * 100 });
    };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || !result.ok) throw new Error(result.error?.message ?? "上傳失敗。");
        resolve(result.data);
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error("本機上傳連線失敗。"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.onloadend = () => options.abortSignal?.removeEventListener("abort", abort);
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}
