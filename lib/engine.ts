// The computational heart of the playground. Runs inside a Web Worker (see
// engine.worker.ts) but has no browser dependencies, so it can also run in Node.
//
// Key idea: for every possible answer A we know the full set S(A) of colour
// patterns that *some* allowed guess can produce against A. Given observed
// rows P (in normal mode the order doesn't matter), the answers consistent
// with them are exactly those A with P ⊆ S(A).

import { ALL_GREEN, NUM_PATTERNS } from "./wordle.ts";

export type Pool = "all" | "answers";

export interface GridInput {
  rows: number[];
  hard: boolean;
}

/** 243 patterns fit in 8 x 32-bit words. */
const W = 8;

interface PoolData {
  /** Guess indices (into `guesses`) that players are assumed to choose from. */
  guessIdx: Int32Array;
  /** The same guesses, answer words first: used to pick familiar example words. */
  familiarFirst: Int32Array;
  /** S(A) as a bitset per answer: N * W words. Excludes the all-green pattern. */
  S: Uint32Array;
  /** Number of pool guesses producing pattern p for answer a: N * 243. */
  count: Uint32Array;
  /** |S(A)| per answer. */
  patternCount: Uint16Array;
}

interface HardOptions {
  /** Number of distinct letters in the answer. */
  L: number;
  /** Options for pattern p are at indices offsets[p] .. offsets[p+1]-1. */
  offsets: Int32Array;
  sigs: Int32Array;
  /** An example guess index for each option. */
  guess: Int32Array;
}

export interface CandidatesResult {
  /** Consistent answers, most plausible first. */
  candidates: number[];
  /**
   * Log-likelihood of the observed rows per candidate (parallel to `candidates`),
   * assuming each row came from a uniformly random guess in the pool. Higher = more plausible.
   */
  scores: number[];
  /** Distinct non-final patterns across all grids. */
  distinctPatterns: number;
  /** Set when hard-mode rules make a grid impossible regardless of the answer. */
  hardProblem?: string;
}

export interface RowExplanation {
  pattern: number;
  count: number;
  examples: string[];
}

export interface GridExplanation {
  hard: boolean;
  /** Normal mode: per-row example guesses. */
  rows?: RowExplanation[];
  /** Hard mode: one complete sequence of guesses that obeys the hard-mode rules. */
  witness?: string[] | null;
}

export interface MinRowsResult {
  identifiable: boolean;
  /** Answers whose pattern set contains all of this answer's patterns. */
  shadows: number[];
  /** A smallest set of patterns that rules out every other answer. */
  rows: number[];
  /** False when the search hit its node limit and `rows` is a greedy upper bound. */
  exact: boolean;
}

export interface ProfilePattern {
  pattern: number;
  count: number;
  examples: string[];
}

export interface WordProfile {
  answer: number;
  word: string;
  patternCount: number;
  patterns: ProfilePattern[];
  min: MinRowsResult;
  /** Answers that are hardest to tell apart: fewest patterns that distinguish them. */
  rivals: { answer: number; word: string; distinguishing: number }[];
}

export interface AnalysisEntry {
  patternCount: number;
  /** -1 when the answer can never be identified. */
  minRows: number;
  exact: boolean;
  rows: number[];
  shadows: number[];
}

export interface AnalysisResult {
  pool: Pool;
  entries: AnalysisEntry[];
}

export type Strategy = "consistent" | "random";

export interface SimOptions {
  trials: number;
  /** Simulate every answer once instead of `trials` random answers. */
  allAnswers: boolean;
  strategy: Strategy;
  /** Opening words players choose from (empty = no special opener). */
  openers: string[];
  /** Players play in hard mode, and the observer knows it. */
  hard: boolean;
  maxGrids: number;
  /** Which guesses the observer assumes players can make. */
  pool: Pool;
  seed: number;
}

export interface SimTrial {
  answer: number;
  /** Rows of every simulated grid (excluding the final all-green row). */
  grids: number[][];
  /** Candidates left after pooling the first k+1 grids. */
  afterGrid: number[];
  /** Candidates left after each row of the first grid alone. */
  firstGridRows: number[];
  /** Rank of the true answer by likelihood among the candidates after each grid (1 = most plausible). */
  rankAfterGrid: number[];
  /** Number of grids needed until one candidate remained, or null. */
  resolvedAt: number | null;
  /** Distinct patterns pooled at the moment of resolution (or at the end). */
  distinctPatterns: number;
  /** Whether the answer can be identified at all in normal mode with this pool. */
  identifiable: boolean;
  /** Sanity check: the true answer was ruled out (observer assumptions don't match play). */
  answerLost: boolean;
}

export interface SimResult {
  options: SimOptions;
  trials: SimTrial[];
  /** Openers that aren't valid guesses and were ignored. */
  ignoredOpeners: string[];
}

export type ProgressFn = (done: number, total: number) => void;
export type CancelFn = () => boolean;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Engine {
  readonly answers: string[];
  readonly guesses: string[];
  readonly N: number;
  readonly G: number;
  /** F[a * G + g] = pattern code of guess g against answer a. */
  readonly F: Uint8Array;
  /** Index of each answer in `guesses`. */
  readonly answerToGuess: Int32Array;
  readonly answerIndex: Map<string, number>;
  readonly guessIndex: Map<string, number>;
  private readonly pools = new Map<Pool, PoolData>();
  private readonly hardCache = new Map<Pool, Map<number, HardOptions>>();
  /** Letter codes (0-25) of every guess, 5 per word. */
  private guessCodes = new Uint8Array(0);

  constructor(answers: string[], validGuesses: string[], onProgress?: ProgressFn) {
    this.answers = answers.map((w) => w.toLowerCase());
    const guessSet = new Set(validGuesses.map((w) => w.toLowerCase()));
    for (const a of this.answers) guessSet.add(a);
    this.guesses = [...guessSet].sort();
    this.N = this.answers.length;
    this.G = this.guesses.length;
    this.answerIndex = new Map(this.answers.map((w, i) => [w, i]));
    this.guessIndex = new Map(this.guesses.map((w, i) => [w, i]));
    this.answerToGuess = Int32Array.from(this.answers, (w) => this.guessIndex.get(w)!);
    this.F = this.buildMatrix(onProgress);
  }

  private buildMatrix(onProgress?: ProgressFn): Uint8Array {
    const { N, G } = this;
    const gc = new Uint8Array(G * 5);
    this.guessCodes = gc;
    this.guesses.forEach((w, i) => {
      for (let k = 0; k < 5; k++) gc[i * 5 + k] = w.charCodeAt(k) - 97;
    });
    const F = new Uint8Array(N * G);
    const cnt = new Int8Array(26);
    const res = new Uint8Array(5);
    for (let a = 0; a < N; a++) {
      const w = this.answers[a];
      const a0 = w.charCodeAt(0) - 97;
      const a1 = w.charCodeAt(1) - 97;
      const a2 = w.charCodeAt(2) - 97;
      const a3 = w.charCodeAt(3) - 97;
      const a4 = w.charCodeAt(4) - 97;
      const ac = [a0, a1, a2, a3, a4];
      const row = a * G;
      for (let g = 0; g < G; g++) {
        const o = g * 5;
        for (let k = 0; k < 5; k++) {
          if (gc[o + k] === ac[k]) res[k] = 2;
          else {
            res[k] = 0;
            cnt[ac[k]]++;
          }
        }
        for (let k = 0; k < 5; k++) {
          if (res[k] === 2) continue;
          const c = gc[o + k];
          if (cnt[c] > 0) {
            res[k] = 1;
            cnt[c]--;
          }
        }
        cnt[a0] = cnt[a1] = cnt[a2] = cnt[a3] = cnt[a4] = 0;
        F[row + g] = res[0] + 3 * res[1] + 9 * res[2] + 27 * res[3] + 81 * res[4];
      }
      if (onProgress && (a % 100 === 0 || a === N - 1)) onProgress(a + 1, N);
    }
    return F;
  }

  pool(pool: Pool): PoolData {
    const cached = this.pools.get(pool);
    if (cached) return cached;
    const { N, G, F } = this;
    const guessIdx =
      pool === "all" ? Int32Array.from({ length: G }, (_, i) => i) : Int32Array.from(this.answerToGuess);
    const S = new Uint32Array(N * W);
    const count = new Uint32Array(N * NUM_PATTERNS);
    const patternCount = new Uint16Array(N);
    for (let a = 0; a < N; a++) {
      const row = a * G;
      const cbase = a * NUM_PATTERNS;
      for (let i = 0; i < guessIdx.length; i++) count[cbase + F[row + guessIdx[i]]]++;
      let n = 0;
      for (let p = 0; p < ALL_GREEN; p++) {
        if (count[cbase + p] > 0) {
          S[a * W + (p >>> 5)] |= 1 << (p & 31);
          n++;
        }
      }
      patternCount[a] = n;
    }
    const isAnswer = (g: number) => this.answerIndex.has(this.guesses[g]);
    const familiarFirst = Int32Array.from([...guessIdx].sort((x, y) => Number(isAnswer(y)) - Number(isAnswer(x)) || x - y));
    const data = { guessIdx, familiarFirst, S, count, patternCount };
    this.pools.set(pool, data);
    return data;
  }

  canProduce(a: number, p: number, pool: Pool): boolean {
    const { S } = this.pool(pool);
    return ((S[a * W + (p >>> 5)] >>> (p & 31)) & 1) === 1;
  }

  // ---------------------------------------------------------------- candidates

  /** Answers consistent with all the given grids. */
  candidates(grids: GridInput[], pool: Pool): CandidatesResult {
    const { S } = this.pool(pool);
    const required = new Uint32Array(W);
    const distinct = new Set<number>();
    for (const grid of grids) {
      for (const p of grid.rows) {
        if (p === ALL_GREEN) continue;
        distinct.add(p);
        required[p >>> 5] |= 1 << (p & 31);
      }
    }

    let candidates: number[] = [];
    for (let a = 0; a < this.N; a++) {
      const base = a * W;
      let ok = true;
      for (let k = 0; k < W; k++) {
        if ((required[k] & ~S[base + k]) !== 0) {
          ok = false;
          break;
        }
      }
      if (ok) candidates.push(a);
    }

    const hardGrids = grids.filter((g) => g.hard && g.rows.length > 1);
    for (const grid of hardGrids) {
      const problem = this.hardSequenceProblem(grid.rows);
      if (problem) return { candidates: [], scores: [], distinctPatterns: distinct.size, hardProblem: problem };
    }
    if (hardGrids.length > 0) {
      candidates = candidates.filter((a) =>
        hardGrids.every((grid) => this.hardWitness(a, grid.rows, pool) !== null),
      );
    }
    const scored = candidates.map((a) => ({ a, score: this.logLikelihood(a, grids, pool) }));
    scored.sort((x, y) => y.score - x.score || x.a - y.a);
    return {
      candidates: scored.map((x) => x.a),
      scores: scored.map((x) => x.score),
      distinctPatterns: distinct.size,
    };
  }

  /** Sum over all rows of log P(row | answer), for a guess drawn uniformly from the pool. */
  logLikelihood(a: number, grids: GridInput[], pool: Pool): number {
    const { count, guessIdx } = this.pool(pool);
    const logSize = Math.log(guessIdx.length);
    let score = 0;
    for (const grid of grids) {
      for (const p of grid.rows) {
        if (p === ALL_GREEN) continue;
        score += Math.log(count[a * NUM_PATTERNS + p]) - logSize;
      }
    }
    return score;
  }

  /**
   * In hard mode a green tile must stay green: the letter is fixed in place, so
   * it produces green again. That's checkable from the colours alone.
   */
  hardSequenceProblem(rows: number[]): string | undefined {
    let greens = 0;
    for (let i = 0; i < rows.length; i++) {
      let mask = 0;
      let code = rows[i];
      for (let k = 0; k < 5; k++) {
        if (code % 3 === 2) mask |= 1 << k;
        code = Math.floor(code / 3);
      }
      if ((greens & ~mask) !== 0) {
        return `Row ${i + 1} loses a green tile from an earlier row, which hard mode doesn't allow.`;
      }
      greens |= mask;
    }
    return undefined;
  }

  /**
   * Finds guesses g1..gn (one per row) producing the given patterns against
   * answer `a` while obeying hard mode: every letter revealed green or yellow
   * must be reused in later guesses (as often as it was revealed). Greens
   * staying in place is implied by the patterns themselves.
   * Returns null if no such sequence exists.
   */
  hardWitness(a: number, rows: number[], pool: Pool): string[] | null {
    const steps = rows.filter((p) => p !== ALL_GREEN);
    if (steps.length === 0) return [];
    if (this.hardSequenceProblem(steps)) return null;
    const { L, offsets, sigs, guess } = this.hardOptions(a, pool);
    const failed = new Set<number>();
    const path: number[] = [];
    // `req` packs, per letter of the answer, how many copies later guesses must contain.
    const dfs = (i: number, req: number): boolean => {
      if (i === steps.length) return true;
      const memoKey = i * 32768 + req;
      if (failed.has(memoKey)) return false;
      const p = steps[i];
      for (let j = offsets[p]; j < offsets[p + 1]; j++) {
        const sig = sigs[j];
        let ok = true;
        let next = 0;
        for (let l = 0; l < L; l++) {
          const need = (req >>> (3 * l)) & 7;
          if (((sig >>> (3 * l)) & 7) < need) {
            ok = false;
            break;
          }
          next |= Math.max(need, (sig >>> (15 + 3 * l)) & 7) << (3 * l);
        }
        if (!ok) continue;
        path.push(guess[j]);
        if (dfs(i + 1, next)) return true;
        path.pop();
      }
      failed.add(memoKey);
      return false;
    };
    return dfs(0, 0) ? path.map((g) => this.guesses[g]) : null;
  }

  /**
   * Hard mode only cares about how a guess uses the answer's letters. Per
   * pattern, we keep one guess for each distinct "signature": for each distinct
   * letter l of the answer, how often the guess contains it (bits 3l..3l+2) and
   * how often it was revealed green/yellow (bits 15+3l..15+3l+2).
   */
  private hardOptions(a: number, pool: Pool): HardOptions {
    let cache = this.hardCache.get(pool);
    if (!cache) {
      cache = new Map();
      this.hardCache.set(pool, cache);
    }
    const cached = cache.get(a);
    if (cached) return cached;

    const { familiarFirst } = this.pool(pool);
    const word = this.answers[a];
    const letterIdx = new Int8Array(26).fill(-1);
    let L = 0;
    for (let k = 0; k < 5; k++) {
      const c = word.charCodeAt(k) - 97;
      if (letterIdx[c] < 0) letterIdx[c] = L++;
    }
    const SHIFT = 1 << 30;
    const firstGuess = new Map<number, number>();
    const base = a * this.G;
    const gc = this.guessCodes;
    for (let i = 0; i < familiarFirst.length; i++) {
      const g = familiarFirst[i];
      const p = this.F[base + g];
      if (p === ALL_GREEN) continue;
      let sig = 0;
      let code = p;
      for (let k = 0; k < 5; k++) {
        const tile = code % 3;
        code = (code - tile) / 3;
        const li = letterIdx[gc[g * 5 + k]];
        if (li < 0) continue;
        sig += 1 << (3 * li);
        if (tile > 0) sig += 1 << (15 + 3 * li);
      }
      const key = p * SHIFT + sig;
      if (!firstGuess.has(key)) firstGuess.set(key, g);
    }

    const offsets = new Int32Array(NUM_PATTERNS + 1);
    for (const key of firstGuess.keys()) offsets[Math.floor(key / SHIFT) + 1]++;
    for (let p = 0; p < NUM_PATTERNS; p++) offsets[p + 1] += offsets[p];
    const cursor = offsets.slice(0, NUM_PATTERNS);
    const sigs = new Int32Array(firstGuess.size);
    const guess = new Int32Array(firstGuess.size);
    for (const [key, g] of firstGuess) {
      const p = Math.floor(key / SHIFT);
      const j = cursor[p]++;
      sigs[j] = key - p * SHIFT;
      guess[j] = g;
    }
    const result = { L, offsets, sigs, guess };
    cache.set(a, result);
    return result;
  }

  // ---------------------------------------------------------------- explanations

  examplesFor(a: number, p: number, pool: Pool, limit: number): string[] {
    const { familiarFirst } = this.pool(pool);
    const base = a * this.G;
    const out: string[] = [];
    for (let i = 0; i < familiarFirst.length && out.length < limit; i++) {
      const g = familiarFirst[i];
      if (this.F[base + g] === p) out.push(this.guesses[g]);
    }
    return out;
  }

  explain(a: number, grids: GridInput[], pool: Pool): GridExplanation[] {
    const { count } = this.pool(pool);
    return grids.map((grid) => {
      if (grid.hard) return { hard: true, witness: this.hardWitness(a, grid.rows, pool) };
      return {
        hard: false,
        rows: grid.rows.map((p) => ({
          pattern: p,
          count: p === ALL_GREEN ? 1 : count[a * NUM_PATTERNS + p],
          examples: p === ALL_GREEN ? [this.answers[a]] : this.examplesFor(a, p, pool, 4),
        })),
      };
    });
  }

  // ---------------------------------------------------------------- theory

  /**
   * The smallest set of rows that leaves only answer `a`. For every other
   * answer b, the rows must include a pattern a can produce but b can't
   * (a "hitting set"). Solved exactly with iterative deepening; falls back to
   * a greedy answer if the search gets too big.
   */
  minRows(a: number, pool: Pool, nodeLimit = 3_000_000): MinRowsResult {
    const { S } = this.pool(pool);
    const N = this.N;
    const aBase = a * W;
    const kills = new Uint32Array(N * W);
    const shadows: number[] = [];
    const others: number[] = [];
    for (let b = 0; b < N; b++) {
      if (b === a) continue;
      let any = 0;
      for (let k = 0; k < W; k++) {
        const v = S[aBase + k] & ~S[b * W + k];
        kills[b * W + k] = v;
        any |= v;
      }
      if (any === 0) shadows.push(b);
      else others.push(b);
    }
    if (shadows.length > 0) return { identifiable: false, shadows, rows: [], exact: true };

    const has = (b: number, p: number) => ((kills[b * W + (p >>> 5)] >>> (p & 31)) & 1) === 1;
    const bitsOf = (b: number): number[] => {
      const out: number[] = [];
      for (let k = 0; k < W; k++) {
        let v = kills[b * W + k];
        while (v !== 0) {
          const low = v & -v;
          out.push(k * 32 + (31 - Math.clz32(low)));
          v ^= low;
        }
      }
      return out;
    };
    const sizeOf = (b: number) => {
      let n = 0;
      for (let k = 0; k < W; k++) n += popcount32(kills[b * W + k]);
      return n;
    };
    const sizes = new Int32Array(N);
    for (const b of others) sizes[b] = sizeOf(b);

    // Greedy upper bound.
    const greedy: number[] = [];
    {
      let rem = others;
      const allP: number[] = [];
      for (let p = 0; p < ALL_GREEN; p++) if (this.canProduce(a, p, pool)) allP.push(p);
      while (rem.length > 0) {
        let bestP = -1;
        let bestHits = -1;
        for (const p of allP) {
          let hits = 0;
          for (const b of rem) if (has(b, p)) hits++;
          if (hits > bestHits) {
            bestHits = hits;
            bestP = p;
          }
        }
        greedy.push(bestP);
        rem = rem.filter((b) => !has(b, bestP));
      }
    }

    // Exact: iterative deepening, always branching on the hardest-to-hit answer.
    let nodes = 0;
    let aborted = false;
    const chosen: number[] = [];
    const search = (rem: number[], depth: number): boolean => {
      if (rem.length === 0) return true;
      if (depth === 0) return false;
      if (++nodes > nodeLimit) {
        aborted = true;
        return false;
      }
      if (depth === 1) {
        // One pattern must hit everything that's left: intersect their kill sets.
        const inter = new Uint32Array(W).fill(0xffffffff);
        for (const b of rem) for (let k = 0; k < W; k++) inter[k] &= kills[b * W + k];
        for (let k = 0; k < W; k++) {
          if (inter[k] !== 0) {
            chosen.push(k * 32 + (31 - Math.clz32(inter[k] & -inter[k])));
            return true;
          }
        }
        return false;
      }
      let best = rem[0];
      for (const b of rem) if (sizes[b] < sizes[best]) best = b;
      for (const p of bitsOf(best)) {
        chosen.push(p);
        if (search(rem.filter((b) => !has(b, p)), depth - 1)) return true;
        chosen.pop();
        if (aborted) return false;
      }
      return false;
    };

    for (let depth = 1; depth < greedy.length; depth++) {
      chosen.length = 0;
      if (search(others, depth)) return { identifiable: true, shadows, rows: [...chosen], exact: true };
      if (aborted) return { identifiable: true, shadows, rows: greedy, exact: false };
    }
    return { identifiable: true, shadows, rows: greedy, exact: true };
  }

  profile(a: number, pool: Pool): WordProfile {
    const { S, count, patternCount } = this.pool(pool);
    const patterns: ProfilePattern[] = [];
    for (let p = 0; p < ALL_GREEN; p++) {
      const c = count[a * NUM_PATTERNS + p];
      if (c > 0) patterns.push({ pattern: p, count: c, examples: this.examplesFor(a, p, pool, 6) });
    }
    const rivals: WordProfile["rivals"] = [];
    for (let b = 0; b < this.N; b++) {
      if (b === a) continue;
      let n = 0;
      for (let k = 0; k < W; k++) n += popcount32(S[a * W + k] & ~S[b * W + k]);
      rivals.push({ answer: b, word: this.answers[b], distinguishing: n });
    }
    rivals.sort((x, y) => x.distinguishing - y.distinguishing || x.word.localeCompare(y.word));
    return {
      answer: a,
      word: this.answers[a],
      patternCount: patternCount[a],
      patterns,
      min: this.minRows(a, pool),
      rivals: rivals.slice(0, 12),
    };
  }

  async analyze(pool: Pool, onProgress?: ProgressFn, cancelled?: CancelFn): Promise<AnalysisResult | null> {
    const { patternCount } = this.pool(pool);
    const entries: AnalysisEntry[] = [];
    let last = Date.now();
    for (let a = 0; a < this.N; a++) {
      const min = this.minRows(a, pool);
      entries.push({
        patternCount: patternCount[a],
        minRows: min.identifiable ? min.rows.length : -1,
        exact: min.exact,
        rows: min.rows,
        shadows: min.shadows,
      });
      if (Date.now() - last > 50) {
        onProgress?.(a + 1, this.N);
        await yieldToEventLoop();
        if (cancelled?.()) return null;
        last = Date.now();
      }
    }
    onProgress?.(this.N, this.N);
    return { pool, entries };
  }

  isIdentifiable(a: number, pool: Pool): boolean {
    const { S } = this.pool(pool);
    for (let b = 0; b < this.N; b++) {
      if (b === a) continue;
      let any = 0;
      for (let k = 0; k < W; k++) any |= S[a * W + k] & ~S[b * W + k];
      if (any === 0) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- simulation

  /**
   * Plays one game of Wordle for answer `a`. Returns the pattern of every guess.
   * "consistent" players always guess an answer-list word that fits all feedback so far;
   * "random" players guess any word from the pool (obeying hard mode if enabled).
   */
  playGame(a: number, opts: SimOptions, openers: number[], rng: () => number): number[] {
    const { G, F } = this;
    const rows: number[] = [];
    let consistent: number[] = Array.from({ length: this.N }, (_, i) => i);
    // Hard-mode bookkeeping for random players: fixed letters and minimum letter counts.
    const fixed: (string | null)[] = [null, null, null, null, null];
    const minCount = new Map<string, number>();
    const randomPool = this.pool(opts.pool).guessIdx;

    const obeysHard = (w: string) => {
      for (let k = 0; k < 5; k++) if (fixed[k] && w[k] !== fixed[k]) return false;
      for (const [ch, n] of minCount) {
        let c = 0;
        for (let k = 0; k < 5; k++) if (w[k] === ch) c++;
        if (c < n) return false;
      }
      return true;
    };

    for (let turn = 0; turn < 6; turn++) {
      let g: number;
      if (turn === 0 && openers.length > 0) {
        g = openers[Math.floor(rng() * openers.length)];
      } else if (opts.strategy === "consistent") {
        g = this.answerToGuess[consistent[Math.floor(rng() * consistent.length)]];
      } else {
        const allowed = opts.hard ? randomPool.filter((i) => obeysHard(this.guesses[i])) : randomPool;
        g = allowed[Math.floor(rng() * allowed.length)];
      }
      const p = F[a * G + g];
      rows.push(p);
      if (p === ALL_GREEN) break;
      consistent = consistent.filter((b) => F[b * G + g] === p);

      const word = this.guesses[g];
      const revealed = new Map<string, number>();
      let code = p;
      for (let k = 0; k < 5; k++) {
        const tile = code % 3;
        code = Math.floor(code / 3);
        if (tile === 2) fixed[k] = word[k];
        if (tile > 0) revealed.set(word[k], (revealed.get(word[k]) ?? 0) + 1);
      }
      for (const [ch, n] of revealed) minCount.set(ch, Math.max(minCount.get(ch) ?? 0, n));
    }
    return rows;
  }

  /** Maps opener words to guess indices, dropping any that aren't in the pool. */
  private resolveOpeners(opts: SimOptions): { openers: number[]; ignoredOpeners: string[] } {
    const inPool = new Set(this.pool(opts.pool).guessIdx);
    const openers: number[] = [];
    const ignoredOpeners: string[] = [];
    for (const raw of opts.openers) {
      const w = raw.trim().toLowerCase();
      if (!w) continue;
      const g = this.guessIndex.get(w);
      // An opener outside the observer's assumed pool would contradict that assumption.
      if (g === undefined || !inPool.has(g)) ignoredOpeners.push(w);
      else openers.push(g);
    }
    return { openers, ignoredOpeners };
  }

  /** One game for answer `a`, including the final all-green row if the player won. */
  playOnce(a: number, opts: SimOptions, seed: number): number[] {
    return this.playGame(a, opts, this.resolveOpeners(opts).openers, mulberry32(seed));
  }

  async simulate(
    opts: SimOptions,
    onProgress?: ProgressFn,
    cancelled?: CancelFn,
  ): Promise<SimResult | null> {
    const rng = mulberry32(opts.seed);
    const { S } = this.pool(opts.pool);
    const { openers, ignoredOpeners } = this.resolveOpeners(opts);

    let answersToRun: number[];
    if (opts.allAnswers) {
      answersToRun = Array.from({ length: this.N }, (_, i) => i);
    } else {
      answersToRun = Array.from({ length: Math.max(1, opts.trials) }, () => Math.floor(rng() * this.N));
    }

    const { count } = this.pool(opts.pool);
    const producible = (b: number, p: number) => ((S[b * W + (p >>> 5)] >>> (p & 31)) & 1) === 1;
    const score = new Float64Array(this.N);
    const trials: SimTrial[] = [];
    let last = Date.now();

    for (let t = 0; t < answersToRun.length; t++) {
      const a = answersToRun[t];
      let survivors: number[] = Array.from({ length: this.N }, (_, i) => i);
      const grids: number[][] = [];
      const afterGrid: number[] = [];
      const rankAfterGrid: number[] = [];
      score.fill(0);
      const firstGridRows: number[] = [];
      const pooled = new Set<number>();
      let resolvedAt: number | null = null;
      let distinctAtResolution = 0;

      for (let k = 0; k < opts.maxGrids; k++) {
        const rows = this.playGame(a, opts, openers, rng).filter((p) => p !== ALL_GREEN);
        grids.push(rows);
        for (let r = 0; r < rows.length; r++) {
          const p = rows[r];
          pooled.add(p);
          survivors = survivors.filter((b) => producible(b, p));
          for (const b of survivors) score[b] += Math.log(count[b * NUM_PATTERNS + p]);
          // A single row never violates hard mode, so only check from the second row on.
          // Later grids are checked once complete (a full sequence implies its prefixes).
          if (opts.hard && r > 0 && (k === 0 || r === rows.length - 1)) {
            const prefix = rows.slice(0, r + 1);
            survivors = survivors.filter((b) => this.hardWitness(b, prefix, opts.pool) !== null);
          }
          if (k === 0) firstGridRows.push(survivors.length);
        }
        afterGrid.push(survivors.length);
        let rank = 1;
        for (const b of survivors) if (score[b] > score[a]) rank++;
        rankAfterGrid.push(rank);
        if (survivors.length <= 1 && resolvedAt === null) {
          resolvedAt = k + 1;
          distinctAtResolution = pooled.size;
          break;
        }
      }

      trials.push({
        answer: a,
        grids,
        afterGrid,
        rankAfterGrid,
        firstGridRows,
        resolvedAt: resolvedAt !== null && survivors[0] === a ? resolvedAt : null,
        distinctPatterns: resolvedAt !== null ? distinctAtResolution : pooled.size,
        identifiable: this.isIdentifiable(a, opts.pool),
        answerLost: !survivors.includes(a),
      });

      if (Date.now() - last > 50) {
        onProgress?.(t + 1, answersToRun.length);
        await yieldToEventLoop();
        if (cancelled?.()) return null;
        last = Date.now();
      }
    }
    onProgress?.(answersToRun.length, answersToRun.length);
    return { options: opts, trials, ignoredOpeners };
  }
}
