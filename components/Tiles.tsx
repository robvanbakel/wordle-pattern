"use client";

import { decodePattern, ALL_GREEN, type Tile } from "@/lib/wordle";

const TILE_BG: Record<Tile, string> = {
  0: "bg-tile-grey",
  1: "bg-tile-yellow",
  2: "bg-tile-green",
};
const TILE_NAME: Record<Tile, string> = { 0: "grey", 1: "yellow", 2: "green" };

const SIZES = {
  xs: "size-3 rounded-[2px] text-[0px]",
  sm: "size-6 rounded-[3px] text-xs",
  md: "size-9 rounded-[4px] text-base",
  lg: "size-12 rounded-[5px] text-2xl",
};

export type TileSize = keyof typeof SIZES;

interface PatternRowProps {
  pattern: number;
  /** Optional letters to print on the tiles (e.g. an example guess). */
  word?: string;
  size?: TileSize;
  /** Makes tiles clickable. Called with the new pattern. */
  onChange?: (pattern: number) => void;
  faded?: boolean;
  className?: string;
}

export function PatternRow({ pattern, word, size = "md", onChange, faded, className = "" }: PatternRowProps) {
  const tiles = decodePattern(pattern);
  const gap = size === "xs" ? "gap-[2px]" : size === "sm" ? "gap-0.5" : "gap-1";

  const cycle = (index: number, direction: 1 | -1) => {
    if (!onChange) return;
    const next = [...tiles];
    next[index] = (((next[index] + direction) % 3) + 3) % 3 as Tile;
    let code = 0;
    for (let i = 4; i >= 0; i--) code = code * 3 + next[i];
    onChange(code);
  };

  return (
    <div
      className={`flex ${gap} ${faded ? "opacity-25" : ""} ${className}`}
      role={onChange ? "group" : "img"}
      aria-label={tiles.map((t) => TILE_NAME[t]).join(", ")}
    >
      {tiles.map((t, i) => {
        const base = `${SIZES[size]} ${TILE_BG[t]} flex items-center justify-center font-bold uppercase text-white select-none`;
        if (!onChange) {
          return (
            <span key={i} className={base}>
              {word?.[i]}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={`${base} cursor-pointer transition-transform active:scale-90 hover:brightness-110`}
            onClick={(e) => cycle(i, e.shiftKey ? -1 : 1)}
            onContextMenu={(e) => {
              e.preventDefault();
              cycle(i, -1);
            }}
            aria-label={`Tile ${i + 1}: ${TILE_NAME[t]}. Click to change.`}
          >
            {word?.[i]}
          </button>
        );
      })}
    </div>
  );
}

/** A word shown as all-green tiles (the answer row). */
export function AnswerRow({ word, size = "md" }: { word?: string; size?: TileSize }) {
  return <PatternRow pattern={ALL_GREEN} word={word} size={size} />;
}

/** Plain letter tiles with a neutral outline, e.g. for an unknown answer. */
export function UnknownRow({ size = "md" }: { size?: TileSize }) {
  return (
    <div className="flex gap-1" aria-label="unknown answer">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`${SIZES[size]} border-2 border-dashed border-tile-green flex items-center justify-center font-bold text-tile-green`}
        >
          ?
        </span>
      ))}
    </div>
  );
}
