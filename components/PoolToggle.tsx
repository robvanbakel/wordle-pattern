"use client";

import type { Pool } from "@/lib/engine";
import { usePersistentState } from "@/lib/usePersistentState";
import answers from "@/words.json";
import validWords from "@/validWords.json";

export function usePool() {
  return usePersistentState<Pool>("wpl:pool", "all");
}

export function PoolToggle({ compact = false }: { compact?: boolean }) {
  const [pool, setPool] = usePool();
  const options: { value: Pool; label: string; hint: string }[] = [
    {
      value: "all",
      label: "Any valid word",
      hint: `${validWords.length.toLocaleString()} words`,
    },
    {
      value: "answers",
      label: "Only answer words",
      hint: `${answers.length.toLocaleString()} words`,
    },
  ];
  return (
    <fieldset className="text-sm">
      {!compact && <legend className="text-ink-2 mb-1.5">Players&apos; guesses can be…</legend>}
      <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
              pool === o.value ? "bg-panel-2 text-ink font-medium" : "text-ink-2 hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="pool"
              className="sr-only"
              checked={pool === o.value}
              onChange={() => setPool(o.value)}
            />
            {o.label} <span className="text-muted font-normal tabular">· {o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
