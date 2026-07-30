import { describe, expect, it } from "vitest";
import {
  taskDeletionAllowed,
  taskDeletionConfirmation,
} from "@/lib/domain/task-deletion";

describe("task deletion confirmation", () => {
  it("binds confirmation to both slug and immutable version", () => {
    expect(taskDeletionConfirmation("dadaocheng-lunar-new-year", 2)).toBe(
      "dadaocheng-lunar-new-year@v2",
    );
  });

  it("allows deletion only before any research session exists", () => {
    expect(taskDeletionAllowed(0)).toBe(true);
    expect(taskDeletionAllowed(1)).toBe(false);
    expect(taskDeletionAllowed(12)).toBe(false);
  });
});
