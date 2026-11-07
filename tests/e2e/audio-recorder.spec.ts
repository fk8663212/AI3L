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
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
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
});
