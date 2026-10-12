"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AnswerRow, PatternRow } from "@/components/Tiles";
import { PoolToggle, usePool } from "@/components/PoolToggle";
import { Button, Card, CardTitle, EngineGate, Stat } from "@/components/ui";
import type { WordProfile } from "@/lib/engine";
import { getEngine } from "@/lib/engineClient";
import { ALL_GREEN, encodeGrids, greenCount } from "@/lib/wordle";
import answers from "@/words.json";
import validWords from "@/validWords.json";

const answerIndex = new Map(answers.map((w, i) => [w, i]));
const validSet = new Set(validWords);

export function WordLens() {
  const searchParams = useSearchParams();
  const word = (searchParams.get("w") ?? "").toLowerCase();
  // Keyed by word so the search box resets when following a link to another word.
  return <WordLensView key={word} word={word} />;
}

function WordLensView({ word }: { word: string }) {
  const router = useRouter();
  const [input, setInput] = useState(word);

  const go = (w: string) => router.push(`/word?w=${encodeURIComponent(w.trim().toLowerCase())}`);
  const index = answerIndex.get(word);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Word lens</h1>
        <p className="text-ink-2 mt-1">
          Everything the colours can say about one answer: which rows it can produce, the fewest rows that single
          it out, and which words it can never be told apart from.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) go(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={5}
            placeholder="stare"
            list="answer-words"
            className="w-32 rounded-md border border-line bg-panel px-3 py-1.5 font-mono uppercase"
            aria-label="Answer word"
          />
          <datalist id="answer-words">
            {answers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
          <Button type="submit" variant="primary">
            Look
          </Button>
          <Button
            onClick={() => {
              const w = answers[Math.floor(Math.random() * answers.length)];
              setInput(w);
              go(w);
            }}
          >
            Random
          </Button>
        </form>
        <PoolToggle compact />
      </div>

      {!word && <p className="text-ink-2">Pick an answer word to inspect.</p>}
      {word && index === undefined && (
        <Card>
          <p className="text-sm">
            <span className="font-mono uppercase">{word}</span>{" "}
            {validSet.has(word)
              ? "is a valid guess, but not one of the possible answers."
              : "isn't in the word lists."}
          </p>
        </Card>
      )}
      {index !== undefined && (
        <EngineGate>
          <Profile answer={index} />
        </EngineGate>
      )}
    </div>
  );
}

function Profile({ answer }: { answer: number }) {
  const [pool] = usePool();
  const [loaded, setLoaded] = useState<{ pool: string; profile: WordProfile } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const profile = loaded && loaded.pool === pool && loaded.profile.answer === answer ? loaded.profile : null;

  useEffect(() => {
    let alive = true;
    getEngine()
      ?.run({ type: "profile", answer, pool })
      .promise.then((p) => alive && setLoaded({ pool, profile: p }));
    return () => {
      alive = false;
    };
  }, [answer, pool]);

  const byPattern = useMemo(() => new Map(profile?.patterns.map((p) => [p.pattern, p]) ?? []), [profile]);

  if (!profile) return <Card>Working…</Card>;
  const { min } = profile;
  const loadHref = `/?load=${encodeGrids(chunk(min.rows, 5).map((rows) => ({ rows, hard: false })))}`;
  const focused = focus !== null ? byPattern.get(focus) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <AnswerRow word={profile.word} size="lg" />
          <Stat
            value={`${profile.patternCount} / 242`}
            label="rows it can produce"
            sub="out of all non-winning colour patterns"
          />
          {min.identifiable ? (
            <Stat
              value={min.rows.length}
              label="rows needed, at best"
              sub={min.exact ? "proven minimum" : "best found (search limit reached)"}
            />
          ) : (
            <Stat value="Never" label="identifiable" sub="no set of rows singles it out" />
          )}
        </div>
      </Card>

      {min.identifiable ? (
        <Card>
          <CardTitle
            hint={`If you could choose which rows to see, these ${min.rows.length} rule out all ${(answers.length - 1).toLocaleString()} other answers.`}
          >
            The fewest rows that pin down <span className="font-mono uppercase">{profile.word}</span>
          </CardTitle>
          <div className="space-y-1.5">
            {min.rows.map((p) => (
              <div key={p} className="flex items-center gap-3">
                <PatternRow pattern={p} word={byPattern.get(p)?.examples[0]} size="sm" />
                <span className="text-xs text-ink-2">
                  {byPattern.get(p)?.count.toLocaleString()} guess{byPattern.get(p)?.count === 1 ? "" : "es"} make
                  this row
                </span>
              </div>
            ))}
            <AnswerRow word={profile.word} size="sm" />
          </div>
          <div className="mt-4">
            <Link href={loadHref} className="text-sm text-accent hover:underline">
              Try these rows in the Explorer →
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle
            hint={`Every row ${profile.word.toUpperCase()} can produce, these words can produce too. So whatever rows you see, they stay possible.`}
          >
            Shadowed by {min.shadows.length} word{min.shadows.length === 1 ? "" : "s"}
          </CardTitle>
          <WordChips words={min.shadows.map((i) => answers[i])} />
        </Card>
      )}

      <Card>
        <CardTitle hint="Answers with the fewest rows that tell them apart from this one. 0 means they can never be told apart.">
          Closest look-alikes
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {profile.rivals.map((r) => (
            <Link
              key={r.answer}
              href={`/word?w=${r.word}`}
              className="px-2 py-1 rounded-md border border-line bg-panel hover:bg-panel-2 text-sm"
            >
              <span className="font-mono uppercase">{r.word}</span>
              <span className="ml-1.5 text-xs text-muted tabular">{r.distinguishing}</span>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle hint="Faded rows are impossible for this answer, so seeing one rules it out. Click a row for example guesses.">
          All 242 patterns
        </CardTitle>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-4">
            {[0, 1, 2, 3, 4].map((greens) => {
              const codes = Array.from({ length: ALL_GREEN }, (_, p) => p).filter((p) => greenCount(p) === greens);
              const possible = codes.filter((p) => byPattern.has(p)).length;
              return (
                <div key={greens}>
                  <div className="text-xs text-ink-2 mb-1.5 tabular">
                    {greens} green · {possible} of {codes.length} possible
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-2">
                    {codes.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFocus(p)}
                        className={`p-0.5 rounded ${focus === p ? "ring-2 ring-accent" : ""}`}
                        title={
                          byPattern.has(p)
                            ? `${byPattern.get(p)!.count} guesses, e.g. ${byPattern.get(p)!.examples.slice(0, 3).join(", ").toUpperCase()}`
                            : "impossible for this answer"
                        }
                      >
                        <PatternRow pattern={p} size="xs" faded={!byPattern.has(p)} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="md:border-l md:border-line md:pl-5">
            {focus === null ? (
              <p className="text-sm text-muted">Click a pattern.</p>
            ) : focused ? (
              <div className="space-y-2">
                <PatternRow pattern={focus} word={focused.examples[0]} size="sm" />
                <p className="text-sm">
                  {focused.count.toLocaleString()} guess{focused.count === 1 ? "" : "es"} give this row, e.g.
                </p>
                <WordChips words={focused.examples} />
              </div>
            ) : (
              <div className="space-y-2">
                <PatternRow pattern={focus} size="sm" />
                <p className="text-sm text-ink-2">
                  No allowed guess produces this row against{" "}
                  <span className="font-mono uppercase">{profile.word}</span>. Seeing it rules the word out.
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function WordChips({ words }: { words: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w) =>
        answerIndex.has(w) ? (
          <Link
            key={w}
            href={`/word?w=${w}`}
            className="px-2 py-0.5 rounded-md border border-line bg-panel hover:bg-panel-2 font-mono text-sm uppercase"
          >
            {w}
          </Link>
        ) : (
          <span key={w} className="px-2 py-0.5 rounded-md border border-line font-mono text-sm uppercase text-ink-2">
            {w}
          </span>
        ),
      )}
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length ? out : [[]];
}
