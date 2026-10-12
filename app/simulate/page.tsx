"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { BarChart } from "@/components/BarChart";
import { PoolToggle, usePool } from "@/components/PoolToggle";
import { Button, Card, CardTitle, EngineGate, ProgressBar, Stat, Toggle } from "@/components/ui";
import type { SimOptions, SimResult, Strategy } from "@/lib/engine";
import { getEngine, type EngineTask } from "@/lib/engineClient";
import { POPULAR_OPENERS } from "@/lib/constants";
import { usePersistentState } from "@/lib/usePersistentState";
import { encodeGrids } from "@/lib/wordle";
import answers from "@/words.json";

interface Settings {
  strategy: Strategy;
  useOpeners: boolean;
  openers: string;
  hard: boolean;
  allAnswers: boolean;
  trials: number;
  maxGrids: number;
  seed: number;
}

const DEFAULT_SETTINGS: Settings = {
  strategy: "consistent",
  useOpeners: true,
  openers: POPULAR_OPENERS.join(", "),
  hard: false,
  allAnswers: false,
  trials: 200,
  maxGrids: 30,
  seed: 1,
};

export default function SimulatePage() {
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Simulator</h1>
        <p className="text-ink-2 mt-1">
          The Theory page assumes you get to pick the most useful rows. Real grids come from people trying to
          win, which tends to produce the same common rows. Here simulated players share their grids for the same
          answer, and we count how many grids it takes before only one answer fits.
        </p>
      </div>
      <EngineGate>
        <Simulator />
      </EngineGate>
    </div>
  );
}

function Simulator() {
  const [pool] = usePool();
  const [settings, setSettings] = usePersistentState<Settings>("wpl:sim", DEFAULT_SETTINGS);
  const [result, setResult] = useState<SimResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const task = useRef<EngineTask<SimResult | null> | null>(null);
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const set = (patch: Partial<Settings>) => setSettings((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...patch }));

  const run = () => {
    const engine = getEngine();
    if (!engine) return;
    task.current?.cancel();
    const options: SimOptions = {
      trials: Math.max(1, Math.min(5000, s.trials)),
      allAnswers: s.allAnswers,
      strategy: s.strategy,
      openers: s.useOpeners ? s.openers.split(/[\s,]+/).filter(Boolean) : [],
      hard: s.hard,
      maxGrids: Math.max(1, Math.min(200, s.maxGrids)),
      pool,
      seed: s.seed,
    };
    setProgress({ done: 0, total: 1 });
    const t = engine.run({ type: "simulate", options }, (done, total) => setProgress({ done, total }));
    task.current = t;
    t.promise
      .then((r) => {
        if (task.current === t && r) setResult(r);
      })
      .finally(() => {
        if (task.current === t) {
          setProgress(null);
          task.current = null;
        }
      });
  };

  const cancel = () => {
    task.current?.cancel();
    task.current = null;
    setProgress(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-5 md:grid-cols-2">
          <fieldset className="space-y-2 text-sm">
            <legend className="text-ink-2 mb-1.5">How players guess</legend>
            <label className="flex gap-2 cursor-pointer">
              <input
                type="radio"
                checked={s.strategy === "consistent"}
                onChange={() => set({ strategy: "consistent" })}
                className="accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">Sensibly</span>
                <span className="text-ink-2"> · always an answer word that fits every clue so far</span>
              </span>
            </label>
            <label className="flex gap-2 cursor-pointer">
              <input
                type="radio"
                checked={s.strategy === "random"}
                onChange={() => set({ strategy: "random" })}
                className="accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">Randomly</span>
                <span className="text-ink-2"> · any word from the guess pool (rarely wins)</span>
              </span>
            </label>
            <div className="pt-2 space-y-2">
              <Toggle checked={s.useOpeners} onChange={(useOpeners) => set({ useOpeners })}>
                Start with one of these openers
              </Toggle>
              <input
                value={s.openers}
                onChange={(e) => set({ openers: e.target.value })}
                disabled={!s.useOpeners}
                className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-sm font-mono disabled:opacity-50"
              />
              <Toggle checked={s.hard} onChange={(hard) => set({ hard })}>
                Players use hard mode (and you know it)
              </Toggle>
            </div>
          </fieldset>

          <div className="space-y-3 text-sm">
            <PoolToggle />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2">
                <span className="text-ink-2">Answers</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={s.trials}
                  disabled={s.allAnswers}
                  onChange={(e) => set({ trials: Number(e.target.value) })}
                  className="w-20 rounded-md border border-line bg-bg px-2 py-1 tabular disabled:opacity-50"
                />
                <span className="text-ink-2">random</span>
              </label>
              <Toggle checked={s.allAnswers} onChange={(allAnswers) => set({ allAnswers })}>
                or all {answers.length.toLocaleString()}
              </Toggle>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2">
                <span className="text-ink-2">Up to</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={s.maxGrids}
                  onChange={(e) => set({ maxGrids: Number(e.target.value) })}
                  className="w-16 rounded-md border border-line bg-bg px-2 py-1 tabular"
                />
                <span className="text-ink-2">grids per answer</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-ink-2">Seed</span>
                <input
                  type="number"
                  value={s.seed}
                  onChange={(e) => set({ seed: Number(e.target.value) })}
                  className="w-20 rounded-md border border-line bg-bg px-2 py-1 tabular"
                />
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {progress ? (
                <Button onClick={cancel}>Cancel</Button>
              ) : (
                <Button variant="primary" onClick={run}>
                  Run simulation
                </Button>
              )}
              <Button variant="ghost" onClick={() => setSettings(DEFAULT_SETTINGS)}>
                Reset
              </Button>
            </div>
            {progress && <ProgressBar done={progress.done} total={progress.total} label="Simulating…" />}
          </div>
        </div>
      </Card>

      {result && <Results result={result} />}
    </div>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function Results({ result }: { result: SimResult }) {
  const { trials, options } = result;
  const [limit, setLimit] = useState(50);

  const stats = useMemo(() => {
    const T = trials.length;
    const at = (arr: number[], k: number) => arr[Math.min(k, arr.length) - 1];
    const resolved = trials.filter((t) => t.resolvedAt !== null);
    const unresolved = trials.filter((t) => t.resolvedAt === null);
    const maxRows = Math.max(0, ...trials.map((t) => t.firstGridRows.length));
    return {
      T,
      oneGridMedian: median(trials.map((t) => t.afterGrid[0])),
      oneGridSolved: trials.filter((t) => t.afterGrid[0] === 1).length,
      resolved: resolved.length,
      resolvedMedian: median(resolved.map((t) => t.resolvedAt!)),
      unresolvedNever: unresolved.filter((t) => !t.identifiable).length,
      lost: trials.filter((t) => t.answerLost).length,
      rank1: (k: number) => trials.filter((t) => at(t.rankAfterGrid, k) === 1).length,
      gridsHistogram: Array.from(
        { length: options.maxGrids },
        (_, i) => resolved.filter((t) => t.resolvedAt === i + 1).length,
      ),
      rowCurve: Array.from({ length: maxRows }, (_, r) =>
        median(trials.filter((t) => t.firstGridRows.length > r).map((t) => t.firstGridRows[r])),
      ),
      gridCurve: Array.from({ length: options.maxGrids }, (_, k) => median(trials.map((t) => at(t.afterGrid, k + 1)))),
    };
  }, [trials, options.maxGrids]);

  const pct = (n: number) => `${Math.round((n / stats.T) * 100)}%`;

  return (
    <div className="space-y-4">
      {result.ignoredOpeners.length > 0 && (
        <Card className="!py-3">
          <p className="text-sm text-ink-2">
            Ignored openers that aren&apos;t in the guess pool:{" "}
            <span className="font-mono uppercase">{result.ignoredOpeners.join(", ")}</span>
          </p>
        </Card>
      )}
      {stats.lost > 0 && (
        <Card className="!py-3">
          <p className="text-sm text-danger">
            In {stats.lost} trials the true answer was ruled out. The guess-pool assumption doesn&apos;t match how
            these players guess.
          </p>
        </Card>
      )}

      <Card>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            value={stats.oneGridMedian.toLocaleString()}
            label="answers still possible after one grid"
            sub={`median · solved by a single grid in ${pct(stats.oneGridSolved)}`}
          />
          <Stat
            value={pct(stats.resolved)}
            label={`pinned down within ${options.maxGrids} grids`}
            sub={`${stats.resolved} of ${stats.T} answers`}
          />
          <Stat
            value={stats.resolved ? stats.resolvedMedian : "–"}
            label="grids needed (median)"
            sub="among the answers that got pinned down"
          />
          <Stat
            value={pct(stats.rank1(options.maxGrids))}
            label="ranked most plausible"
            sub={`after all grids · ${pct(stats.rank1(1))} after one`}
          />
        </div>
        {stats.T - stats.resolved > 0 && (
          <p className="text-xs text-muted mt-4">
            Of the {stats.T - stats.resolved} answers not pinned down, {stats.unresolvedNever} can never be
            deduced at all with this guess pool (see Theory).
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Median answers still possible after each row of a single shared grid. Later rows only include games that lasted that long.">
            Within one grid
          </CardTitle>
          <BarChart
            bars={stats.rowCurve.map((v, r) => ({ label: `row ${r + 1}`, value: v }))}
            xLabel="rows seen"
            labelBars
          />
        </Card>
        <Card>
          <CardTitle hint="Median answers still possible as more players' grids are pooled.">
            Pooling grids
          </CardTitle>
          <BarChart
            bars={stats.gridCurve.map((v, k) => ({ label: String(k + 1), value: v }))}
            xLabel="grids pooled"
          />
        </Card>
      </div>

      <Card>
        <CardTitle
          hint={`Number of answers by how many grids it took until only one answer fit.${
            stats.T - stats.resolved > 0
              ? ` Not shown: ${stats.T - stats.resolved} answers that weren't pinned down within ${options.maxGrids} grids.`
              : ""
          }`}
        >
          Grids needed to pin down the answer
        </CardTitle>
        {stats.resolved > 0 ? (
          <BarChart
            bars={stats.gridsHistogram.map((v, k) => ({
              label: String(k + 1),
              value: v,
              tooltip: (
                <>
                  <div className="font-medium">
                    {k + 1} grid{k === 0 ? "" : "s"}
                  </div>
                  <div className="text-ink-2 tabular">
                    {v} answer{v === 1 ? "" : "s"}
                  </div>
                </>
              ),
            }))}
            xLabel="grids"
          />
        ) : (
          <p className="text-sm text-muted">No answer was pinned down within {options.maxGrids} grids.</p>
        )}
      </Card>

      <Card>
        <CardTitle hint="Open any trial in the Explorer to see its grids.">Trials</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-2 border-b border-line">
                <th className="py-2 pr-4 font-medium">Answer</th>
                <th className="py-2 pr-4 font-medium text-right">After 1 grid</th>
                <th className="py-2 pr-4 font-medium text-right">Grids needed</th>
                <th className="py-2 pr-4 font-medium text-right">Distinct rows</th>
                <th className="py-2 pr-4 font-medium text-right">Plausibility rank</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {trials.slice(0, limit).map((t, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="py-1.5 pr-4">
                    <Link href={`/word?w=${answers[t.answer]}`} className="font-mono uppercase text-accent hover:underline">
                      {answers[t.answer]}
                    </Link>
                    {!t.identifiable && <span className="ml-2 text-xs text-muted">never deducible</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular">{t.afterGrid[0].toLocaleString()}</td>
                  <td className="py-1.5 pr-4 text-right tabular">
                    {t.resolvedAt ?? <span className="text-muted">&gt;{options.maxGrids}</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular">{t.distinctPatterns}</td>
                  <td className="py-1.5 pr-4 text-right tabular">
                    #{t.rankAfterGrid[t.rankAfterGrid.length - 1]}
                    <span className="text-muted"> of {t.afterGrid[t.afterGrid.length - 1]}</span>
                  </td>
                  <td className="py-1.5 text-right">
                    <Link
                      href={`/?load=${encodeGrids(t.grids.map((rows) => ({ rows, hard: options.hard })))}`}
                      className="text-xs text-accent hover:underline"
                    >
                      Explorer →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {trials.length > limit && (
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
              Show more ({trials.length - limit} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
