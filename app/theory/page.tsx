"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart } from "@/components/BarChart";
import { PoolToggle, usePool } from "@/components/PoolToggle";
import { Button, Card, CardTitle, EngineGate, ProgressBar, Stat } from "@/components/ui";
import type { AnalysisResult } from "@/lib/engine";
import { getEngine } from "@/lib/engineClient";
import answers from "@/words.json";

export default function TheoryPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Theory: is it always possible?</h1>
        <p className="text-ink-2 mt-1">
          Suppose you could see <em>any</em> rows you like for an answer. For each of the{" "}
          {answers.length.toLocaleString()} answers, this finds the smallest set of rows that rules out every
          other answer. In normal mode the order of rows doesn&apos;t matter, only which patterns appear, so this is
          the best case.
        </p>
      </div>
      <PoolToggle />
      <EngineGate>
        <Analysis />
      </EngineGate>
    </div>
  );
}

type SortKey = "word" | "patterns" | "min";

function Analysis() {
  const [pool] = usePool();
  // Results and progress are tagged with their pool so switching pools never shows stale numbers.
  const [loaded, setLoaded] = useState<AnalysisResult | null>(null);
  const [progressState, setProgress] = useState({ pool, done: 0, total: 1 });
  const result = loaded?.pool === pool ? loaded : null;
  const progress = progressState.pool === pool ? progressState : { done: 0, total: 1 };
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "min", desc: true });
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;
    const task = engine.run({ type: "analyze", pool }, (done, total) => setProgress({ pool, done, total }));
    task.promise.then((r) => r && setLoaded(r));
    return () => task.cancel();
  }, [pool]);

  const stats = useMemo(() => {
    if (!result) return null;
    const mins = result.entries.map((e) => e.minRows);
    const identifiable = mins.filter((m) => m >= 0).sort((a, b) => a - b);
    const never = mins.length - identifiable.length;
    const max = identifiable[identifiable.length - 1] ?? 0;
    const histogram = Array.from({ length: max }, (_, i) => identifiable.filter((m) => m === i + 1).length);
    return {
      identifiable: identifiable.length,
      never,
      median: identifiable[Math.floor(identifiable.length / 2)] ?? 0,
      min: identifiable[0] ?? 0,
      max,
      histogram,
      inexact: result.entries.filter((e) => !e.exact).length,
    };
  }, [result]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    const items = result.entries
      .map((e, i) => ({ ...e, word: answers[i] }))
      .filter((e) => !q || e.word.includes(q));
    const minKey = (m: number) => (m < 0 ? 999 : m);
    items.sort((a, b) => {
      let d = 0;
      if (sort.key === "word") d = a.word.localeCompare(b.word);
      if (sort.key === "patterns") d = a.patternCount - b.patternCount;
      if (sort.key === "min") d = minKey(a.minRows) - minKey(b.minRows);
      if (d === 0) d = a.word.localeCompare(b.word);
      return sort.desc ? -d : d;
    });
    return items;
  }, [result, query, sort]);

  if (!result || !stats) {
    return (
      <Card className="max-w-md">
        <ProgressBar done={progress.done} total={progress.total} label="Finding the fewest rows for every answer…" />
        <p className="text-xs text-muted mt-2">An exact search per answer. This takes a few seconds the first time.</p>
      </Card>
    );
  }

  const pct = (n: number) => `${((n / answers.length) * 100).toFixed(1)}%`;
  const bars = [
    ...stats.histogram.map((count, i) => ({
      label: String(i + 1),
      value: count,
      tooltip: (
        <>
          <div className="font-medium">
            {i + 1} row{i === 0 ? "" : "s"}
          </div>
          <div className="text-ink-2 tabular">
            {count.toLocaleString()} answers ({pct(count)})
          </div>
        </>
      ),
    })),
    {
      label: "never",
      value: stats.never,
      muted: true,
      tooltip: (
        <>
          <div className="font-medium">Never identifiable</div>
          <div className="text-ink-2 tabular">
            {stats.never.toLocaleString()} answers ({pct(stats.never)})
          </div>
        </>
      ),
    },
  ];

  const header = (key: SortKey, label: string, className = "") => (
    <th className={`py-2 pr-4 font-medium ${className}`}>
      <button
        type="button"
        className="hover:text-ink"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "word" }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat
            value={stats.never.toLocaleString()}
            label="answers can never be deduced"
            sub={`${pct(stats.never)} of all answers, whatever rows you see`}
          />
          <Stat
            value={stats.median}
            label="rows needed (median), at best"
            sub={`for the ${stats.identifiable.toLocaleString()} that can be deduced`}
          />
          <Stat value={`${stats.min}–${stats.max}`} label="range of rows needed" sub="plus the winning row" />
        </div>
      </Card>

      <Card>
        <CardTitle hint="Number of answers by the smallest number of rows that singles them out.">
          How many rows does it take, at best?
        </CardTitle>
        <BarChart bars={bars} xLabel="rows needed (besides the winning row)" labelBars />
        {stats.inexact > 0 && (
          <p className="text-xs text-muted mt-2">
            {stats.inexact} answers hit the search limit; their count is an upper bound.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Why some answers can never be deduced</CardTitle>
        <div className="text-sm text-ink-2 space-y-2 max-w-3xl">
          <p>
            Each answer A has a set S(A) of rows that some guess can produce against it. Seeing a row rules out
            every answer that can&apos;t produce it. If S(A) is entirely contained in S(B) for another answer B,
            then any rows that fit A also fit B, so A can never be singled out. We say B <em>shadows</em> A.
          </p>
          <p>
            Typical culprits are words with rare letters or repeated letters (like HUMPH or FLUFF): few guesses
            interact with them in unusual ways, so they produce fewer distinct rows than a common-lettered
            neighbour like HEATH.
          </p>
          <p>
            For the rest, the fewest rows is a <em>hitting set</em> problem: for every other answer B you need at
            least one row that A can produce but B can&apos;t. It&apos;s solved exactly here by a depth-first
            search.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-semibold tracking-tight">Every answer</h2>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(100);
            }}
            placeholder="Filter…"
            className="ml-auto w-40 rounded-md border border-line bg-bg px-3 py-1 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-2 border-b border-line">
                {header("word", "Answer")}
                {header("patterns", "Rows it can produce", "text-right")}
                {header("min", "Fewest rows needed", "text-right")}
                <th className="py-2 font-medium">Shadowed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.word} className="border-b border-line/60">
                  <td className="py-1.5 pr-4">
                    <Link href={`/word?w=${r.word}`} className="font-mono uppercase text-accent hover:underline">
                      {r.word}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular">{r.patternCount}</td>
                  <td className="py-1.5 pr-4 text-right tabular">
                    {r.minRows < 0 ? <span className="text-muted">never</span> : r.minRows}
                    {!r.exact && <span className="text-muted"> (≤)</span>}
                  </td>
                  <td className="py-1.5 font-mono uppercase text-xs text-ink-2">
                    {r.shadows.slice(0, 4).map((i) => answers[i]).join(", ")}
                    {r.shadows.length > 4 && <span className="normal-case"> +{r.shadows.length - 4} more</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
              Show more ({(rows.length - limit).toLocaleString()} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
