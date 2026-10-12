"use client";

// Main-thread side of the engine worker: a singleton shared by every page, so
// the expensive feedback matrix is only built once per browser session.

import { useSyncExternalStore } from "react";
import type { ResultTypes, WorkerRequest, WorkerResponse } from "./engineProtocol.ts";

export interface EngineStatus {
  phase: "loading" | "ready" | "error";
  done: number;
  total: number;
  guesses: number;
  error?: string;
}

type RequestBody = WorkerRequest extends infer R ? (R extends { type: "cancel" } ? never : Omit<R, "id">) : never;
type RequestType = RequestBody["type"];

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface EngineTask<T> {
  promise: Promise<T>;
  cancel: () => void;
}

class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  status: EngineStatus = { phase: "loading", done: 0, total: 1, guesses: 0 };

  constructor() {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      this.setStatus({ ...this.status, phase: "error", error: event.message || "Worker crashed" });
    };
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    this.listeners.forEach((l) => l());
  }

  private handle(msg: WorkerResponse) {
    switch (msg.kind) {
      case "init-progress":
        this.setStatus({ ...this.status, done: msg.done, total: msg.total });
        return;
      case "ready":
        this.setStatus({ phase: "ready", done: 1, total: 1, guesses: msg.guesses });
        return;
      case "init-error":
        this.setStatus({ ...this.status, phase: "error", error: msg.message });
        return;
      case "progress":
        this.pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
        return;
      case "result":
        this.pending.get(msg.id)?.resolve(msg.data);
        this.pending.delete(msg.id);
        return;
      case "error":
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
        return;
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  run<K extends RequestType>(
    body: Extract<RequestBody, { type: K }>,
    onProgress?: (done: number, total: number) => void,
  ): EngineTask<ResultTypes[K]> {
    const id = this.nextId++;
    const promise = new Promise<ResultTypes[K]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject, onProgress });
    });
    this.worker.postMessage({ ...body, id } as WorkerRequest);
    return {
      promise,
      cancel: () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        this.worker.postMessage({ type: "cancel", id: 0, target: id } as WorkerRequest);
      },
    };
  }
}

let client: EngineClient | null = null;

export function getEngine(): EngineClient | null {
  if (typeof window === "undefined") return null;
  client ??= new EngineClient();
  return client;
}

const SERVER_STATUS: EngineStatus = { phase: "loading", done: 0, total: 1, guesses: 0 };
const noopSubscribe = () => () => {};

export function useEngineStatus(): EngineStatus {
  const engine = getEngine();
  return useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    () => engine?.status ?? SERVER_STATUS,
    () => SERVER_STATUS,
  );
}
