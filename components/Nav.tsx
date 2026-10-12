"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEngineStatus } from "@/lib/engineClient";
import answers from "@/words.json";

const LINKS = [
  { href: "/", label: "Explorer" },
  { href: "/word", label: "Word lens" },
  { href: "/theory", label: "Theory" },
  { href: "/simulate", label: "Simulator" },
];

export function Nav() {
  const pathname = usePathname();
  const status = useEngineStatus();

  return (
    <header className="border-b border-line bg-panel">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex gap-0.5" aria-hidden>
            <span className="size-3 rounded-[2px] bg-tile-grey" />
            <span className="size-3 rounded-[2px] bg-tile-yellow" />
            <span className="size-3 rounded-[2px] bg-tile-green" />
          </span>
          Wordle Pattern Lab
        </Link>
        <nav className="flex gap-1 text-sm">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  active ? "bg-panel-2 text-ink font-medium" : "text-ink-2 hover:text-ink hover:bg-panel-2"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-xs text-muted tabular">
          {status.phase === "ready" && (
            <span title="Every answer has been scored against every valid guess">
              {answers.length.toLocaleString()} answers × {status.guesses.toLocaleString()} guesses ready
            </span>
          )}
          {status.phase === "loading" && (
            <span>Building feedback table… {Math.round((status.done / status.total) * 100)}%</span>
          )}
          {status.phase === "error" && <span className="text-danger">Engine error: {status.error}</span>}
        </div>
      </div>
    </header>
  );
}
