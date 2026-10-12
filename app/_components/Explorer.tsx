"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PatternRow, AnswerRow, UnknownRow } from "@/components/Tiles";
import { PoolToggle, usePool } from "@/components/PoolToggle";
import { Button, Card, CardTitle, EngineGate, Toggle } from "@/components/ui";
import type { CandidatesResult, GridExplanation } from "@/lib/engine";
import { getEngine, useEngineStatus } from "@/lib/engineClient";
import { POPULAR_OPENERS, formatShare } from "@/lib/constants";
import { usePersistentState } from "@/lib/usePersistentState";
import {
  ALL_GREEN,
  decodeGrids,
  encodePattern,
  newGridId,
  parseShareText,
  type Grid,
} from "@/lib/wordle";
import answers from "@/words.json";

const EXAMPLE_GRIDS: Grid[] = [{ id: "example", rows: [encodePattern([2, 2, 2, 2, 0])], hard: false }];
const CHIP_LIMIT = 300;

export function Explorer() {
  const [grids, setGrids] = usePersistentState<Grid[]>("wpl:grids", EXAMPLE_GRIDS);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Grids handed over from another page via ?load=...
  useEffect(() => {
    const load = searchParams.get("load");
    if (load) {
      setGrids(decodeGrids(load));
      router.replace("/");
    }
  }, [searchParams, setGrids, router]);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Explorer</h1>
        <p className="text-ink-2 mt-1">
          Enter only the colours people saw. Each row is a clue: the answer must be a word that some guess turns
          into exactly that row. Click a tile to cycle grey → yellow → green (shift-click or right-click goes
          back).
        </p>
      </div>
      <EngineGate>
        <ExplorerBody grids={grids} setGrids={setGrids} />
      </EngineGate>
    </div>
  );
}

function ExplorerBody({ grids, setGrids }: { grids: Grid[]; setGrids: (g: Grid[] | ((p: Grid[]) => Grid[])) => void }) {
  const [pool] = usePool();
  const status = useEngineStatus();
  const [result, setResult] = useState<CandidatesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [mystery, setMystery] = useState<{ answer: number; revealed: boolean; hard: boolean } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const engine = getEngine();
    if (!engine || status.phase !== "ready") return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => setBusy(true), 150);
    engine
      .run({ type: "candidates", grids: grids.map(({ rows, hard }) => ({ rows, hard })), pool })
      .promise.then((r) => {
        if (ticket === latest.current) setResult(r);
      })
      .finally(() => {
        clearTimeout(timer);
        if (ticket === latest.current) setBusy(false);
      });
    return () => clearTimeout(timer);
  }, [grids, pool, status.phase]);

  const updateGrid = (id: string, update: (g: Grid) => Grid) =>
    setGrids((prev) => prev.map((g) => (g.id === id ? update(g) : g)));

  const startMystery = () => {
    const hasWork = grids.some((g) => g.rows.length > 0);
    if (hasWork && !window.confirm("Start a mystery game? This replaces your current grids.")) return;
    setGrids([]);
    setSelected(null);
    setMystery({ answer: Math.floor(Math.random() * answers.length), revealed: false, hard: mystery?.hard ?? false });
  };

  const addMysteryGrid = async () => {
    const engine = getEngine();
    if (!engine || !mystery) return;
    const rows = await engine.run({
      type: "playGame",
      answer: mystery.answer,
      options: {
        trials: 1,
        allAnswers: false,
        strategy: "consistent",
        openers: POPULAR_OPENERS,
        hard: mystery.hard,
        maxGrids: 1,
        pool,
        seed: 0,
      },
    }).promise;
    const clues = rows.filter((p) => p !== ALL_GREEN);
    const solved = rows[rows.length - 1] === ALL_GREEN;
    setGrids((prev) => [
      ...prev,
      {
        id: newGridId(),
        rows: clues,
        hard: mystery.hard,
        label: `Player ${prev.length + 1} · ${solved ? rows.length : "X"}/6${mystery.hard ? "*" : ""}`,
      },
    ]);
  };

  const totalRows = grids.reduce((n, g) => n + g.rows.filter((p) => p !== ALL_GREEN).length, 0);
  const selectedValid = selected !== null && result?.candidates.includes(selected) ? selected : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-start">
      <div className="space-y-4">
        <Card>
          <PoolToggle />
          <p className="text-xs text-muted mt-2">
            Fewer possible guesses means each row says more. The answer is always one of the{" "}
            {answers.length.toLocaleString()} answer words.
          </p>
        </Card>

        <MysteryPanel
          mystery={mystery}
          onStart={startMystery}
          onAdd={addMysteryGrid}
          onReveal={() => mystery && setMystery({ ...mystery, revealed: true })}
          onHardChange={(hard) => mystery && setMystery({ ...mystery, hard })}
          onEnd={() => setMystery(null)}
        />

        {grids.map((grid, index) => (
          <GridEditor
            key={grid.id}
            grid={grid}
            index={index}
            onChange={(update) => updateGrid(grid.id, update)}
            onRemove={() => setGrids((prev) => prev.filter((g) => g.id !== grid.id))}
          />
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => setGrids((prev) => [...prev, { id: newGridId(), rows: [0], hard: false }])}
          >
            + Add grid
          </Button>
          {grids.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Remove all grids?")) setGrids([]);
              }}
            >
              Clear all
            </Button>
          )}
        </div>

        <PastePanel onAdd={(parsed) => setGrids((prev) => [...prev, ...parsed])} />
      </div>

      <div className="space-y-4 lg:sticky lg:top-4">
        <ResultsPanel
          result={result}
          busy={busy}
          totalRows={totalRows}
          gridCount={grids.length}
          selected={selectedValid}
          onSelect={setSelected}
          secret={mystery?.revealed ? mystery.answer : null}
        />
        {selectedValid !== null && <ExplanationPanel answer={selectedValid} grids={grids} pool={pool} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ grid editor

function GridEditor({
  grid,
  index,
  onChange,
  onRemove,
}: {
  grid: Grid;
  index: number;
  onChange: (update: (g: Grid) => Grid) => void;
  onRemove: () => void;
}) {
  const clueRows = grid.rows.length;
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-medium text-sm">
          Grid {index + 1}
          {grid.label && <span className="text-muted font-normal"> · {grid.label}</span>}
        </h3>
        <div className="ml-auto flex items-center gap-3">
          <Toggle checked={grid.hard} onChange={(hard) => onChange((g) => ({ ...g, hard }))}>
            <span className="text-ink-2">Hard mode</span>
          </Toggle>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted hover:text-danger text-sm"
            aria-label={`Remove grid ${index + 1}`}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {grid.rows.map((pattern, r) => (
          <div key={r} className="flex items-center gap-3 group">
            <PatternRow
              pattern={pattern}
              onChange={(p) => onChange((g) => ({ ...g, rows: g.rows.map((x, i) => (i === r ? p : x)) }))}
            />
            <button
              type="button"
              onClick={() => onChange((g) => ({ ...g, rows: g.rows.filter((_, i) => i !== r) }))}
              className="text-muted hover:text-danger text-lg leading-none opacity-60 group-hover:opacity-100"
              aria-label={`Remove row ${r + 1}`}
            >
              ×
            </button>
            {pattern === ALL_GREEN && <span className="text-xs text-muted">winning row, not a clue</span>}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange((g) => ({ ...g, rows: [...g.rows, 0] }))}
          className="h-9 w-[196px] rounded-[4px] border-2 border-dashed border-line text-sm text-muted hover:text-ink hover:border-muted"
        >
          + Add row
        </button>
        <div className="pt-1.5 flex items-center gap-3">
          <UnknownRow />
          <span className="text-xs text-muted">the answer</span>
        </div>
      </div>
      {clueRows > 6 && (
        <p className="text-xs text-muted mt-3">
          A real game has at most 6 rows. Fine for experimenting; for real data, split rows over several grids.
        </p>
      )}
      {grid.hard && clueRows > 1 && (
        <p className="text-xs text-muted mt-3">
          Hard mode: every revealed letter must be reused, so the order of these rows matters.
        </p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ paste

function PastePanel({ onAdd }: { onAdd: (grids: Grid[]) => void }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card className="!p-4">
      <CardTitle hint="Paste one or more Wordle share texts. A * after the score (e.g. 4/6*) marks hard mode.">
        Paste shared grids
      </CardTitle>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"Wordle 1,234 4/6\n\n⬛🟨⬛⬛⬛\n⬛⬛🟩🟨⬛\n🟩🟩🟩⬛🟩\n🟩🟩🟩🟩🟩"}
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono placeholder:text-muted"
      />
      <div className="flex items-center gap-3 mt-2">
        <Button
          onClick={() => {
            const parsed = parseShareText(text);
            if (parsed.length === 0) {
              setMessage("No rows of colours found. Use emoji squares or letters like gyxxg.");
              return;
            }
            onAdd(parsed);
            setText("");
            setMessage(`Added ${parsed.length} grid${parsed.length === 1 ? "" : "s"}.`);
          }}
          disabled={!text.trim()}
        >
          Add grids
        </Button>
        {message && <span className="text-xs text-ink-2">{message}</span>}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ mystery

function MysteryPanel({
  mystery,
  onStart,
  onAdd,
  onReveal,
  onHardChange,
  onEnd,
}: {
  mystery: { answer: number; revealed: boolean; hard: boolean } | null;
  onStart: () => void;
  onAdd: () => Promise<void>;
  onReveal: () => void;
  onHardChange: (hard: boolean) => void;
  onEnd: () => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!mystery) {
    return (
      <Card className="!p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h3 className="font-medium text-sm">Mystery game</h3>
            <p className="text-xs text-ink-2">
              A secret answer is picked and simulated players share their grids, one at a time.
            </p>
          </div>
          <Button onClick={onStart}>Start</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="!p-4 border-tile-green">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-medium text-sm flex-1">Mystery game</h3>
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={onEnd}>
          End
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            try {
              await onAdd();
            } finally {
              setAdding(false);
            }
          }}
        >
          + Another player&apos;s grid
        </Button>
        {mystery.revealed ? (
          <AnswerRow word={answers[mystery.answer]} size="sm" />
        ) : (
          <Button variant="ghost" onClick={onReveal}>
            Reveal answer
          </Button>
        )}
        <span className="ml-auto">
          <Toggle checked={mystery.hard} onChange={onHardChange}>
            <span className="text-ink-2 text-xs">Players use hard mode</span>
          </Toggle>
        </span>
      </div>
      <p className="text-xs text-muted mt-2">
        Players open with a popular word, then always guess an answer word that fits the clues so far.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ results

function ResultsPanel({
  result,
  busy,
  totalRows,
  gridCount,
  selected,
  onSelect,
  secret,
}: {
  result: CandidatesResult | null;
  busy: boolean;
  totalRows: number;
  gridCount: number;
  selected: number | null;
  onSelect: (a: number | null) => void;
  secret: number | null;
}) {
  const [sort, setSort] = usePersistentState<"plausible" | "alpha">("wpl:sort", "plausible");
  const [showAll, setShowAll] = useState(false);

  const shares = useMemo(() => {
    if (!result || result.candidates.length === 0) return [];
    const best = result.scores[0];
    const weights = result.scores.map((s) => Math.exp(s - best));
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => w / total);
  }, [result]);

  const ordered = useMemo(() => {
    if (!result) return [];
    const items = result.candidates.map((a, i) => ({ a, share: shares[i] }));
    if (sort === "alpha") items.sort((x, y) => answers[x.a].localeCompare(answers[y.a]));
    return items;
  }, [result, shares, sort]);

  if (!result) return <Card>Working…</Card>;
  const n = result.candidates.length;
  const visible = showAll ? ordered : ordered.slice(0, CHIP_LIMIT);

  return (
    <Card className={busy ? "opacity-70 transition-opacity" : ""}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-4">
        <div>
          <div className="text-4xl font-semibold tracking-tight tabular">{n.toLocaleString()}</div>
          <div className="text-sm text-ink-2">
            possible answer{n === 1 ? "" : "s"} of {answers.length.toLocaleString()}
          </div>
        </div>
        <div className="text-xs text-muted tabular pb-1">
          {totalRows} clue row{totalRows === 1 ? "" : "s"} in {gridCount} grid{gridCount === 1 ? "" : "s"} ·{" "}
          {result.distinctPatterns} distinct pattern{result.distinctPatterns === 1 ? "" : "s"}
        </div>
        {n === 1 && (
          <div className="pb-1">
            <AnswerRow word={answers[result.candidates[0]]} size="sm" />
          </div>
        )}
      </div>

      {result.hardProblem && <p className="text-sm text-danger mb-3">{result.hardProblem}</p>}
      {n === 0 && !result.hardProblem && (
        <p className="text-sm text-ink-2">
          No answer can produce all of these rows. With &ldquo;only answer words&rdquo; selected, try allowing any
          valid word.
        </p>
      )}

      {n > 1 && (
        <div className="mb-3 text-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-ink-2">Sort:</span>
            {(["plausible", "alpha"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`px-2 py-0.5 rounded ${sort === s ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {s === "plausible" ? "most plausible" : "A–Z"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            &ldquo;Plausible&rdquo; weighs how many guesses could produce each row: if a row needs a rare guess
            for some word, that word becomes less likely (assuming guesses were random words). The percentage is
            that likelihood share.
          </p>
        </div>
      )}

      {n > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visible.map(({ a, share }) => {
            const isSelected = selected === a;
            const isSecret = secret === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onSelect(isSelected ? null : a)}
                className={`px-2 py-1 rounded-md font-mono text-sm uppercase border transition-colors ${
                  isSelected
                    ? "bg-accent text-white border-accent"
                    : isSecret
                      ? "border-tile-green border-2 bg-panel"
                      : "border-line bg-panel hover:bg-panel-2"
                }`}
                title={`Plausibility share: ${formatShare(share)}`}
              >
                {answers[a]}
                {n > 1 && sort === "plausible" && share >= 0.01 && (
                  <span className={`ml-1.5 normal-case text-xs ${isSelected ? "text-white/80" : "text-muted"}`}>
                    {formatShare(share)}
                  </span>
                )}
              </button>
            );
          })}
          {!showAll && ordered.length > CHIP_LIMIT && (
            <button type="button" onClick={() => setShowAll(true)} className="px-2 py-1 text-sm text-accent">
              show all {ordered.length.toLocaleString()}
            </button>
          )}
        </div>
      )}
      {secret !== null && result.candidates.length > 0 && !result.candidates.includes(secret) && (
        <p className="text-xs text-danger mt-3">
          The secret answer was ruled out: the guess-pool setting doesn&apos;t match how the simulated players
          guessed.
        </p>
      )}
      {n > 0 && <p className="text-xs text-muted mt-3">Click a word to see guesses that explain each row.</p>}
    </Card>
  );
}

function ExplanationPanel({ answer, grids, pool }: { answer: number; grids: Grid[]; pool: "all" | "answers" }) {
  const [explanation, setExplanation] = useState<GridExplanation[] | null>(null);
  const word = answers[answer];

  useEffect(() => {
    let alive = true;
    getEngine()
      ?.run({ type: "explain", answer, grids: grids.map(({ rows, hard }) => ({ rows, hard })), pool })
      .promise.then((r) => alive && setExplanation(r));
    return () => {
      alive = false;
    };
  }, [answer, grids, pool]);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-semibold tracking-tight">
          Why <span className="font-mono uppercase">{word}</span> fits
        </h2>
        <Link href={`/word?w=${word}`} className="ml-auto text-sm text-accent hover:underline">
          Open in Word lens →
        </Link>
      </div>
      {!explanation && <p className="text-sm text-muted">Working…</p>}
      <div className="space-y-4">
        {explanation?.map((g, gi) => (
          <div key={gi}>
            {grids.length > 1 && <div className="text-xs text-muted mb-1.5">Grid {gi + 1}</div>}
            {g.hard ? (
              g.witness ? (
                <div className="space-y-1">
                  {g.witness.map((w, r) => (
                    <PatternRow key={r} pattern={grids[gi].rows.filter((p) => p !== ALL_GREEN)[r]} word={w} size="sm" />
                  ))}
                  <AnswerRow word={word} size="sm" />
                  <p className="text-xs text-muted">One hard-mode game that produces these rows.</p>
                </div>
              ) : (
                <p className="text-sm text-danger">No hard-mode game fits.</p>
              )
            ) : (
              <div className="space-y-1">
                {g.rows?.map((row, r) => (
                  <div key={r} className="flex items-center gap-3">
                    <PatternRow pattern={row.pattern} word={row.examples[0]} size="sm" />
                    <span className="text-xs text-ink-2">
                      {row.pattern === ALL_GREEN ? (
                        "winning row"
                      ) : (
                        <>
                          {row.examples.slice(1).map((w) => w.toUpperCase()).join(", ")}
                          {row.count > row.examples.length && (
                            <span className="text-muted">
                              {row.examples.length > 1 ? " and " : ""}
                              {(row.count - row.examples.length).toLocaleString()} other guess
                              {row.count - row.examples.length === 1 ? "" : "es"}
                            </span>
                          )}
                          {row.count === 1 && <span className="text-muted">the only guess that does this</span>}
                        </>
                      )}
                    </span>
                  </div>
                ))}
                <AnswerRow word={word} size="sm" />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
