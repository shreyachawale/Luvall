import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { StatusBadge } from "@/components/ui";
import { fmtDay, timeRange } from "@/lib/format";

export function SessionList({ sessions, hrefBase, empty = "No sessions." }: { sessions: any[]; hrefBase: string; empty?: string }) {
  if (!sessions.length) return <p className="px-5 py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => (
        <li key={s.id}>
          <Link to={`${hrefBase}/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-court-50">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.batch_name}</p>
              <p className="text-sm text-muted">
                {fmtDay(s.session_date)} · {timeRange(s.start_time, s.end_time)} · {s.venue_name}
              </p>
            </div>
            <div className="flex items-center gap-2 text-right">
              {s.status === "completed" ? (
                <span className="num text-xs text-muted">{s.present_count}/{s.present_count + s.absent_count} present</span>
              ) : (
                s.expected_count !== undefined && <span className="num text-xs text-muted">{s.expected_count} expected</span>
              )}
              <StatusBadge status={s.status} />
              <ChevronRight size={16} className="text-muted" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
