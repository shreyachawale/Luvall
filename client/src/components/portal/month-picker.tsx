import { ChevronLeft, ChevronRight } from "lucide-react";

import { monthLabel, shiftMonth } from "@/lib/format";

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-white">
      <button className="rounded-l-full p-2 hover:bg-court-50" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
      <span className="min-w-36 px-2 text-center text-sm font-semibold">{monthLabel(value)}</span>
      <button className="rounded-r-full p-2 hover:bg-court-50" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
    </div>
  );
}
