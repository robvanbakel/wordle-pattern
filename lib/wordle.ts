// Core Wordle primitives shared by the UI and the engine worker.
//
// A pattern (the colours of one row) is encoded as a base-3 number:
// position i contributes digit d_i * 3^i, with 0 = grey, 1 = yellow, 2 = green.
// That gives 3^5 = 243 possible codes, where 242 means "all green".

export const NUM_PATTERNS = 243;
export const ALL_GREEN = 242;

export type Tile = 0 | 1 | 2;
export const GREY: Tile = 0;
export const YELLOW: Tile = 1;
export const GREEN: Tile = 2;

export function encodePattern(tiles: readonly number[]): number {
  let code = 0;
  for (let i = 4; i >= 0; i--) code = code * 3 + tiles[i];
  return code;
}

export function decodePattern(code: number): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < 5; i++) {
    tiles.push((code % 3) as Tile);
    code = Math.floor(code / 3);
  }
  return tiles;
}

/** Wordle feedback for `guess` against `answer`, with the standard duplicate-letter rules. */
export function feedback(guess: string, answer: string): number {
  const tiles = [0, 0, 0, 0, 0];
  const remaining = new Map<string, number>();
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) tiles[i] = GREEN;
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < 5; i++) {
    if (tiles[i] === GREEN) continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      tiles[i] = YELLOW;
      remaining.set(guess[i], left - 1);
    }
  }
  return encodePattern(tiles);
}

export function greenCount(code: number): number {
  return decodePattern(code).filter((t) => t === GREEN).length;
}

/** Bitmask (bit i = position i) of the green tiles in a pattern. */
export function greenMask(code: number): number {
  let mask = 0;
  decodePattern(code).forEach((t, i) => {
    if (t === GREEN) mask |= 1 << i;
  });
  return mask;
}

const TILE_EMOJI = ["⬛", "🟨", "🟩"];
const TILE_LETTER = ["x", "y", "g"];

export function patternToEmoji(code: number): string {
  return decodePattern(code)
    .map((t) => TILE_EMOJI[t])
    .join("");
}

/** Compact text form, e.g. "gyxxg". Used in URLs. */
export function patternToLetters(code: number): string {
  return decodePattern(code)
    .map((t) => TILE_LETTER[t])
    .join("");
}

// Characters accepted when reading a row of colours. Includes Wordle's
// dark/light/high-contrast emoji as well as a few plain-text shorthands.
const CHAR_TO_TILE: Record<string, Tile> = {
  "🟩": GREEN,
  "🟧": GREEN, // high contrast green
  "🟨": YELLOW,
  "🟦": YELLOW, // high contrast yellow
  "⬛": GREY,
  "⬜": GREY,
  "◼": GREY,
  "◻": GREY,
  g: GREEN,
  G: GREEN,
  "2": GREEN,
  y: YELLOW,
  Y: YELLOW,
  "1": YELLOW,
  x: GREY,
  X: GREY,
  b: GREY,
  B: GREY,
  "0": GREY,
  "-": GREY,
  ".": GREY,
  _: GREY,
};

/** Parses one row of colours, e.g. "🟩⬛🟨⬛⬛" or "gxyxx". Returns null if it isn't one. */
export function parsePatternLine(line: string): number | null {
  // Strip variation selectors and whitespace that emoji often carry along.
  const chars = Array.from(line.replace(/[︎️\s]/g, ""));
  if (chars.length !== 5) return null;
  const tiles: number[] = [];
  for (const ch of chars) {
    const tile = CHAR_TO_TILE[ch];
    if (tile === undefined) return null;
    tiles.push(tile);
  }
  return encodePattern(tiles);
}

export interface Grid {
  id: string;
  /** Rows before the winning row. A grid never stores the final all-green row. */
  rows: number[];
  /** Whether this game was played in hard mode. */
  hard: boolean;
  label?: string;
}

let gridCounter = 0;
export function newGridId(): string {
  gridCounter += 1;
  return `g${Date.now().toString(36)}${gridCounter}`;
}

/**
 * Parses one or more pasted Wordle share texts into grids.
 * Consecutive pattern lines form one grid; anything else separates grids.
 * A header like "Wordle 1,234 4/6*" marks the following grid as hard mode.
 */
export function parseShareText(text: string): Grid[] {
  const grids: Grid[] = [];
  let current: number[] = [];
  let hard = false;
  let label: string | undefined;

  const flush = () => {
    if (current.length === 0) return;
    // A solved game ends in an all-green row: that's the answer, not a clue.
    const rows = current[current.length - 1] === ALL_GREEN ? current.slice(0, -1) : current;
    grids.push({ id: newGridId(), rows: rows.filter((r) => r !== ALL_GREEN), hard, label });
    current = [];
    hard = false;
    label = undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const code = parsePatternLine(line);
    if (code !== null) {
      current.push(code);
      continue;
    }
    flush();
    const header = line.match(/wordle\s+[\d,.]+\s+([1-6X])\/6(\*)?/i);
    if (header) {
      hard = Boolean(header[2]);
      label = line;
    }
  }
  flush();
  return grids;
}

/** Encodes grids for a URL: rows as "gyxxg" joined by ".", grids joined by "_", hard grids prefixed with "h". */
export function encodeGrids(grids: Pick<Grid, "rows" | "hard">[]): string {
  return grids.map((g) => (g.hard ? "h" : "") + g.rows.map(patternToLetters).join(".")).join("_");
}

export function decodeGrids(encoded: string): Grid[] {
  return encoded
    .split("_")
    .filter((s) => s.length > 0)
    .map((part) => {
      const hard = part.startsWith("h");
      const body = hard ? part.slice(1) : part;
      const rows = body
        .split(".")
        .map((r) => parsePatternLine(r))
        .filter((r): r is number => r !== null);
      return { id: newGridId(), rows, hard };
    });
}
