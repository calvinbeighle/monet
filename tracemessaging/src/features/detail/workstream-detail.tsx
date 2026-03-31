import { useWorkstreamStore } from "../../lib/stores";
import { useActivityStore } from "../../lib/stores";
import { useAppStore } from "../../lib/stores";

export function WorkstreamDetail({ workstreamId }: { workstreamId: string }) {
  const workstream = useWorkstreamStore((s) => s.getWorkstream(workstreamId));
  const navigate = useAppStore((s) => s.navigate);
  const activities = useActivityStore((s) =>
    s.getActivitiesByWorkstream(workstreamId),
  );

  if (!workstream) {
    return (
      <div className="mx-auto max-w-[800px] px-8 pt-16 text-center">
        <p className="font-mono text-[0.85rem] text-[rgba(255,255,255,0.45)]">
          Workstream not found
        </p>
        <button
          onClick={() => navigate({ view: "timeline" })}
          className="mt-4 cursor-pointer rounded-md border border-[rgba(255,255,255,0.12)] bg-[#111113] px-4 py-2 font-mono text-[0.75rem] text-[rgba(255,255,255,0.55)] transition-all hover:border-[rgba(255,255,255,0.2)]"
        >
          Back to timeline
        </button>
      </div>
    );
  }

  const sortedActivities = [...activities].sort(
    (a, b) => b.timestamp - a.timestamp,
  );

  return (
    <div className="mx-auto max-w-[800px] px-8 py-6">
      {/* Back button */}
      <button
        onClick={() => navigate({ view: "timeline" })}
        className="mb-4 cursor-pointer border-none bg-transparent font-mono text-[0.75rem] text-[rgba(255,255,255,0.3)] transition-colors hover:text-[rgba(255,255,255,0.55)]"
      >
        &lt;- back to timeline
      </button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-serif text-[1.5rem] font-normal text-[rgba(255,255,255,0.92)]">
          {workstream.name}
        </h1>
        <p className="mt-1 font-mono text-[0.75rem] text-[rgba(255,255,255,0.3)]">
          {workstream.activityIds.length} activities from{" "}
          {Object.keys(workstream.sourceBreakdown).length} sources
        </p>
      </div>

      {/* AI Summary */}
      {workstream.summary && (
        <div className="mb-6 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111113] p-5">
          <p className="mb-3 font-serif text-[0.9rem] italic leading-relaxed text-[rgba(255,255,255,0.55)]">
            {workstream.summary.statusSummary}
          </p>
          {workstream.summary.keyDevelopments.length > 0 && (
            <ul className="list-none space-y-1">
              {workstream.summary.keyDevelopments.map((dev, i) => (
                <li
                  key={i}
                  className="font-mono text-[0.78rem] text-[rgba(255,255,255,0.45)] before:mr-2 before:content-['-']"
                >
                  {dev}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Activity timeline */}
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.3)]">
          Activities
        </span>
        <span className="rounded bg-[#18181b] px-2 py-0.5 text-[0.6rem] text-[rgba(255,255,255,0.3)]">
          {sortedActivities.length}
        </span>
        <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
      </div>

      {sortedActivities.map((activity) => (
        <div
          key={activity.activityId}
          className="mb-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111113] p-4"
        >
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                {activity.source}
              </span>
              <span className="font-mono text-[0.85rem] text-[rgba(255,255,255,0.7)]">
                {activity.title}
              </span>
            </div>
            <span className="text-[0.65rem] text-[rgba(255,255,255,0.25)]">
              {new Date(activity.timestamp).toLocaleString()}
            </span>
          </div>
          {activity.preview && (
            <p className="mt-1 font-mono text-[0.78rem] text-[rgba(255,255,255,0.4)]">
              {activity.preview}
            </p>
          )}
        </div>
      ))}

      {sortedActivities.length === 0 && (
        <p className="py-8 text-center font-mono text-[0.8rem] text-[rgba(255,255,255,0.25)]">
          No activities in this workstream yet.
        </p>
      )}
    </div>
  );
}
