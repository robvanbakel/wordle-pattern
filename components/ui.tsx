"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEngineStatus } from "@/lib/engineClient";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold tracking-tight">{children}</h2>
      {hint && <p className="text-sm text-ink-2 mt-0.5">{hint}</p>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" };

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-white hover:brightness-110 border border-transparent",
    secondary: "bg-panel border border-line text-ink hover:bg-panel-2",
    ghost: "text-ink-2 hover:text-ink hover:bg-panel-2 border border-transparent",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles} ${className}`}
      {...props}
    />
  );
}

export function Stat({ value, label, sub }: { value: ReactNode; label: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-3xl font-semibold tracking-tight tabular">{value}</div>
      <div className="text-sm text-ink-2">{label}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs text-ink-2 mb-1 tabular">
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-panel-2 overflow-hidden">
        <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Renders children only once the engine worker has finished building its tables. */
export function EngineGate({ children }: { children: ReactNode }) {
  const status = useEngineStatus();
  if (status.phase === "ready") return <>{children}</>;
  if (status.phase === "error") {
    return (
      <Card>
        <p className="text-danger text-sm">The engine failed to start: {status.error}</p>
      </Card>
    );
  }
  return (
    <Card className="max-w-md">
      <ProgressBar done={status.done} total={status.total} label="Scoring every answer against every valid guess…" />
      <p className="text-xs text-muted mt-2">
        About 34 million comparisons. This happens once, in the background.
      </p>
    </Card>
  );
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {children}
    </label>
  );
}
