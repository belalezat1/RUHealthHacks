import { WorkflowSteps } from "../ui";
export function ProductPreview({ stage }: { stage: 0 | 1 | 2 }) {
  return (
    <div className="lp-preview" aria-label="Workflow overview">
      <div className="lp-preview-bar">
        <strong>Official data → Verified decisions</strong>
      </div>
      <div className="lp-preview-block">
        <h3>Detect</h3>
        <p>
          Replay organizer CSV records. Inspect observed queues and modeled
          coverage forecasts.
        </p>
      </div>
      <div className="lp-preview-block">
        <h3>Decide</h3>
        <p>
          Review server-calculated credentials, rest, weekly hours, and
          availability.
        </p>
      </div>
      <div className="lp-preview-block">
        <h3>Act</h3>
        <p>
          Coordinator proposes → Clinical lead approves → Physician responds.
        </p>
      </div>
      <WorkflowSteps stage={stage} />
    </div>
  );
}
