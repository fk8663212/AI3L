import { describe, expect, it } from "vitest";
import {
  isSupportedAudioMimeType,
  normalizeAudioMimeType,
  withRecordingAnalysisStatus,
} from "@/lib/domain/recordings";
import { presignedPayloadFromUrl } from "@/lib/domain/blob-upload";

describe("recording upload validation", () => {
  it("reconstructs the payload expected by OIDC-compatible client uploads", () => {
    const payload = presignedPayloadFromUrl(
      "https://blob.example.test/?pathname=student%2Fs1%2Frecording.webm&access=private&validUntil=123&vercel-blob-delegation=delegation&vercel-blob-signature=signature",
    );
    expect(payload).toEqual({
      delegationToken: "delegation",
      signature: "signature",
      params: { access: "private", validUntil: "123" },
    });
  });

  it("normalizes MediaRecorder codec parameters before Blob validation", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeAudioMimeType(" Audio/MP4 ")).toBe("audio/mp4");
    expect(isSupportedAudioMimeType("audio/ogg; codecs=opus")).toBe(true);
    expect(isSupportedAudioMimeType("audio/mpeg")).toBe(false);
  });

  it("tracks background analysis without discarding Drive metadata", () => {
    const now = new Date("2026-08-01T10:00:00.000Z");
    const pending = withRecordingAnalysisStatus(
      { driveName: "pretest.webm", durationSeconds: 42 },
      "pending",
      now,
    );
    expect(pending).toMatchObject({
      driveName: "pretest.webm",
      durationSeconds: 42,
      analysisStatus: "pending",
      analysisUpdatedAt: now.toISOString(),
    });
    expect(pending).not.toHaveProperty("analysisCompletedAt");

    const ready = withRecordingAnalysisStatus(pending, "ready", now);
    expect(ready.analysisStatus).toBe("ready");
    expect(ready.analysisCompletedAt).toBe(now.toISOString());
  });
});
