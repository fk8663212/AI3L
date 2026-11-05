import { describe, expect, it } from "vitest";
import { stageChecklist } from "@/lib/domain/stage-checklist";

const a = (stageId: Parameters<typeof stageChecklist>[0], type: string, data: Record<string, unknown> = {}) => ({
  stageId,
  type,
  data,
});

const done = (steps: ReturnType<typeof stageChecklist>) => steps.map((step) => step.done);

describe("stageChecklist", () => {
  it("shows the recording length for the independent speaking tests", () => {
    const steps = stageChecklist("pretest", [], { minimumSeconds: 30, maximumSeconds: 120 });
    expect(steps).toEqual([{ label: "錄一段 30–120 秒的英文口說", done: false }]);
    expect(done(stageChecklist("posttest", [a("posttest", "audio")]))).toEqual([true]);
  });

  it("needs both the drawing and three saved labels in stage 2", () => {
    expect(done(stageChecklist("visualization", [a("visualization", "image")]))).toEqual([true, false]);
    expect(
      done(
        stageChecklist("visualization", [
          a("visualization", "image"),
          a("visualization", "self_labels", { labels: ["a", "b", "c"] }),
        ]),
      ),
    ).toEqual([true, true]);
  });

  it("keeps the vocabulary review open until every word is decided", () => {
    const ready = a("image_analysis", "annotated_image");
    expect(
      done(
        stageChecklist("image_analysis", [
          ready,
          a("image_analysis", "vocabulary_decisions", { pending: ["v1"], accepted: [], rejected: [] }),
        ]),
      ),
    ).toEqual([true, false]);
    expect(
      done(
        stageChecklist("image_analysis", [
          ready,
          a("image_analysis", "vocabulary_decisions", { pending: [], accepted: [{ id: "v1" }], rejected: [] }),
        ]),
      ),
    ).toEqual([true, true]);
  });

  it("re-opens the concept review when its decisions are pending again", () => {
    expect(
      done(
        stageChecklist("ai_concept_map", [
          a("ai_concept_map", "generated_concept_map"),
          a("ai_concept_map", "concept_decisions", { pending: ["n3"] }),
        ]),
      ),
    ).toEqual([true, false]);
  });

  it("lists the three sentence-stage steps in order", () => {
    const steps = stageChecklist("sentence_scaffold", [
      a("sentence_scaffold", "sentences", { sentences: ["1", "2", "3"] }),
      a("sentence_scaffold", "sentence_scaffold"),
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "寫下並保存至少 3 個自己的英文句子",
      "取得分級提示",
      "錄一段口說練習",
    ]);
    expect(done(steps)).toEqual([true, true, false]);
  });

  it("ignores artifacts from other stages", () => {
    expect(done(stageChecklist("self_concept_map", [a("visualization", "image")]))).toEqual([false]);
  });
});
