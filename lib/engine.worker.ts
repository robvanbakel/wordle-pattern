/// <reference lib="webworker" />
// Hosts the Engine off the main thread. Builds the full feedback matrix
// (every answer x every valid guess) once on startup, then answers requests.

import answers from "../words.json";
import validWords from "../validWords.json";
import { Engine, type AnalysisResult, type Pool } from "./engine.ts";
import type { WorkerRequest, WorkerResponse } from "./engineProtocol.ts";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse) => ctx.postMessage(msg);

const cancelled = new Set<number>();
const analysisCache = new Map<Pool, AnalysisResult>();
let engine: Engine | null = null;

try {
  engine = new Engine(answers as string[], validWords as string[], (done, total) =>
    post({ kind: "init-progress", done, total }),
  );
  engine.pool("all");
  engine.pool("answers");
  post({ kind: "ready", answers: engine.N, guesses: engine.G });
} catch (err) {
  post({ kind: "init-error", message: String(err) });
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === "cancel") {
    cancelled.add(req.target);
    return;
  }
  if (!engine) {
    post({ kind: "error", id: req.id, message: "Engine failed to start" });
    return;
  }
  const progress = (done: number, total: number) => post({ kind: "progress", id: req.id, done, total });
  const isCancelled = () => cancelled.has(req.id);

  try {
    let data: unknown;
    switch (req.type) {
      case "candidates":
        data = engine.candidates(req.grids, req.pool);
        break;
      case "explain":
        data = engine.explain(req.answer, req.grids, req.pool);
        break;
      case "profile":
        data = engine.profile(req.answer, req.pool);
        break;
      case "playGame":
        data = engine.playOnce(req.answer, req.options, Math.floor(Math.random() * 2 ** 31));
        break;
      case "analyze": {
        const cached = analysisCache.get(req.pool);
        if (cached) {
          data = cached;
          break;
        }
        const result = await engine.analyze(req.pool, progress, isCancelled);
        if (result) analysisCache.set(req.pool, result);
        data = result;
        break;
      }
      case "cachedAnalysis":
        data = analysisCache.get(req.pool) ?? null;
        break;
      case "simulate":
        data = await engine.simulate(req.options, progress, isCancelled);
        break;
    }
    if (isCancelled()) {
      cancelled.delete(req.id);
      return;
    }
    post({ kind: "result", id: req.id, data });
  } catch (err) {
    post({ kind: "error", id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
