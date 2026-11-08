import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";

loadEnvConfig(process.cwd(), true);

type AudioHarness = Window & {
  recorderTestMode: "tone" | "silence";
  recorderTestContexts: AudioContext[];
  recorderTestStreams: MediaStream[];
  recorderTestCalls: number;
  recorderTestDelayMs: number;
  recorderTestSuppressStop: boolean;
};

// Exercise the real browser encoder with generated audio. Never upload it or
// send a request to an AI provider; use only an isolated temporary session.
test.describe("microphone recording", () => {
  let db: Pool;
  let taskId: string;
  let sessionId: string;

  test.beforeAll(async () => {
    test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET, "Local database and auth settings are required.");
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    const config = structuredClone(DEFAULT_TASK_CONFIG);
    config.stageConfig.pretest.minimumRecordingSeconds = 1;
    config.stageConfig.pretest.maximumRecordingSeconds = 10;
    taskId = (await db.query(
      "insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Recorder browser test','Synthetic audio only','published','google','synthetic-test',$2,now()) returning id",
      [`recorder-test-${randomUUID()}`, config],
    )).rows[0].id;
    const codeId = (await db.query(
      "insert into access_codes(task_id,code_hash,label) values($1,$2,'Recorder test') returning id",
      [taskId, randomUUID()],
    )).rows[0].id;
    sessionId = (await db.query(
      "insert into student_sessions(task_id,access_code_id,consented_at,consent_version) values($1,$2,now(),'test') returning id",
      [taskId, codeId],
    )).rows[0].id;
    await db.query("insert into stage_attempts(session_id,stage_id) values($1,'pretest')", [sessionId]);
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      if (taskId) {
        await db.query("delete from student_sessions where task_id=$1", [taskId]);
        await db.query("delete from tasks where id=$1", [taskId]);
      }
    } finally { await db.end(); }
  });

  test.beforeEach(async ({ context, page, baseURL }) => {
    const token = await new SignJWT({ role: "student", sessionId })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: "ai3l_student", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(() => {
      const harness = window as unknown as AudioHarness;
      harness.recorderTestMode = "tone";
      harness.recorderTestContexts = [];
      harness.recorderTestStreams = [];
      harness.recorderTestCalls = 0;
      harness.recorderTestDelayMs = 0;
      harness.recorderTestSuppressStop = false;
      const onstop = Object.getOwnPropertyDescriptor(MediaRecorder.prototype, "onstop")!;
      Object.defineProperty(MediaRecorder.prototype, "onstop", {
        configurable: true,
        get() { return onstop.get!.call(this); },
        set(callback) { onstop.set!.call(this, harness.recorderTestSuppressStop ? null : callback); },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
        harness.recorderTestCalls += 1;
        await new Promise(resolve => setTimeout(resolve, harness.recorderTestDelayMs));
        const audio = new AudioContext();
        await audio.resume();
        harness.recorderTestContexts.push(audio);
        const source = audio.createOscillator();
        source.frequency.value = 440;
        const gain = audio.createGain();
        gain.gain.value = harness.recorderTestMode === "tone" ? 0.15 : 0;
        const destination = audio.createMediaStreamDestination();
        source.connect(gain).connect(destination);
        source.start();
        harness.recorderTestStreams.push(destination.stream);
        return destination.stream;
      } });
    });
    await page.route("**/api/student/uploads/**", (route) => route.abort());
    await page.goto("/learn");
  });

  test("records and re-records without truncation, with finite playback duration", async ({ page }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "開始錄音", exact: true }).click();
      const stop = page.getByRole("button", { name: "停止錄音", exact: true });
      await expect(stop).toBeVisible();
      await expect.poll(() => page.locator("meter").evaluate((meter) => (meter as HTMLMeterElement).value)).toBeGreaterThan(0.1);
      await expect(page.locator(".recording-time")).toHaveText("00:01");
      await stop.click();
      const audio = page.locator("audio");
      await expect(audio).toBeVisible();
      await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration)).toBeGreaterThan(1);
      expect(await audio.evaluate((element) => (element as HTMLAudioElement).duration)).toBeLessThan(4);
      await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
      if (attempt === 0) await page.getByRole("button", { name: "重錄", exact: true }).click();
    }
  });

  test("detects an entirely silent microphone before saving", async ({ page }) => {
    await page.evaluate(() => { (window as unknown as AudioHarness).recorderTestMode = "silence"; });
    await page.getByRole("button", { name: "開始錄音", exact: true }).click();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    await page.getByRole("button", { name: "停止錄音", exact: true }).click();
    await expect(page.getByText("這段錄音沒有偵測到聲音。", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeDisabled();
    expect((await db.query("select count(*)::int as count from artifacts where session_id=$1", [sessionId])).rows[0].count).toBe(0);
  });

  test("ignores rapid taps while microphone permission and finishing are pending", async ({ page }) => {
    await page.evaluate(() => { (window as unknown as AudioHarness).recorderTestDelayMs = 300; });
    await page.getByRole("button", { name: "開始錄音", exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByRole("button", { name: "正在開啟麥克風", exact: true })).toBeDisabled();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    expect(await page.evaluate(() => (window as unknown as AudioHarness).recorderTestCalls)).toBe(1);
    await page.getByRole("button", { name: "停止錄音", exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.locator("audio")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
  });

  test("recovers a take when the browser drops its stop event", async ({ page }) => {
    await page.evaluate(() => { (window as unknown as AudioHarness).recorderTestSuppressStop = true; });
    await page.getByRole("button", { name: "開始錄音", exact: true }).click();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    await page.getByRole("button", { name: "停止錄音", exact: true }).click();
    await expect(page.getByRole("button", { name: "正在整理錄音", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "開始錄音", exact: true })).toHaveCount(0);
    await expect(page.locator("audio")).toBeVisible({ timeout: 8000 });
    await expect.poll(() => page.locator("audio").evaluate(audio => (audio as HTMLAudioElement).duration)).toBeGreaterThan(1);
    expect(await page.locator("audio").evaluate(audio => (audio as HTMLAudioElement).duration)).toBeLessThan(3);
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
  });

  test("keeps a playable take when the microphone disconnects", async ({ page }) => {
    await page.getByRole("button", { name: "開始錄音", exact: true }).click();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    await page.evaluate(() => {
      const track = (window as unknown as AudioHarness).recorderTestStreams[0].getAudioTracks()[0];
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await expect(page.locator("audio")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
  });

  test("cancels local upload without discarding the recorded take", async ({ page }) => {
    await page.route("**/api/student/uploads/blob", route => route.fulfill({ json: { storage: "local" } }));
    await page.route("**/api/student/uploads/local", async route => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      await route.abort().catch(() => undefined);
    });
    await page.getByRole("button", { name: "開始錄音", exact: true }).click();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    await page.getByRole("button", { name: "停止錄音", exact: true }).click();
    const uploading = page.waitForRequest("**/api/student/uploads/local");
    await page.getByRole("button", { name: "保存錄音", exact: true }).click();
    await uploading;
    await page.getByRole("button", { name: "取消上傳", exact: true }).click();
    await expect(page.getByText("已取消上傳，錄音還在，可以再按一次保存。", { exact: true })).toBeVisible();
    await expect(page.locator("audio")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
    expect((await db.query("select count(*)::int as count from artifacts where session_id=$1", [sessionId])).rows[0].count).toBe(0);
  });
});
