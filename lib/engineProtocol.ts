import type {
  AnalysisResult,
  CandidatesResult,
  GridExplanation,
  GridInput,
  Pool,
  SimOptions,
  SimResult,
  WordProfile,
} from "./engine.ts";

export type WorkerRequest =
  | { id: number; type: "candidates"; grids: GridInput[]; pool: Pool }
  | { id: number; type: "explain"; answer: number; grids: GridInput[]; pool: Pool }
  | { id: number; type: "profile"; answer: number; pool: Pool }
  | { id: number; type: "playGame"; answer: number; options: SimOptions }
  | { id: number; type: "analyze"; pool: Pool }
  | { id: number; type: "cachedAnalysis"; pool: Pool }
  | { id: number; type: "simulate"; options: SimOptions }
  | { id: number; type: "cancel"; target: number };

export interface ResultTypes {
  candidates: CandidatesResult;
  explain: GridExplanation[];
  profile: WordProfile;
  playGame: number[];
  analyze: AnalysisResult | null;
  cachedAnalysis: AnalysisResult | null;
  simulate: SimResult | null;
}

export type WorkerResponse =
  | { kind: "init-progress"; done: number; total: number }
  | { kind: "ready"; answers: number; guesses: number }
  | { kind: "init-error"; message: string }
  | { kind: "progress"; id: number; done: number; total: number }
  | { kind: "result"; id: number; data: unknown }
  | { kind: "error"; id: number; message: string };
