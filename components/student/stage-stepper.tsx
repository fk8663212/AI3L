import { Check } from "lucide-react";

type StepperStage = {
  id: string;
  order: number;
  shortLabel: string;
  title: string;
  status: "locked" | "active" | "completed";
};

/**
 * The seven-stage progress shown in the app bar. On wide screens: done
 * stages as check dots, the current one as a labelled pill. On narrow
 * screens it collapses to seven segments (CSS), so it never squeezes the
 * task area.
 */
export function StageStepper({ stages }: { stages: StepperStage[] }) {
  return (
    <ol className="stage-stepper" aria-label="階段進度">
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className={`stepper-step ${stage.status}`}
          aria-current={stage.status === "active" ? "step" : undefined}
          title={`${stage.order}. ${stage.title}`}
        >
          {index > 0 ? <span className="stepper-line" aria-hidden="true" /> : null}
          <span className="stepper-node">
            <span className="stepper-dot" aria-hidden="true">
              {stage.status === "completed" ? <Check size={14} strokeWidth={3} /> : stage.order}
            </span>
            {stage.status === "active" ? (
              <span className="stepper-label" aria-hidden="true">{stage.shortLabel}</span>
            ) : null}
          </span>
          <span className="visually-hidden">
            第 {stage.order} 階段 {stage.title}（
            {stage.status === "completed" ? "已完成" : stage.status === "active" ? "進行中" : "尚未開始"}）
          </span>
        </li>
      ))}
    </ol>
  );
}
