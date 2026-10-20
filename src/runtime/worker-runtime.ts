/**
 * Per-deployment constants of the running Worker (bindings and the sub-request cache). Content
 * loaders get no request, so the Worker entry stores these once per request for them to read.
 * Undefined outside a Worker, e.g. while prerendering, where loaders fall back to `process.env`
 * and the in-memory cache. `waitUntil` is request-scoped and deliberately not kept here.
 */
import type { OxygenEnv } from '../config.js';

export interface WorkerRuntime {
  env: OxygenEnv;
  cache: Cache | undefined;
}

let runtime: WorkerRuntime | undefined;

export function setWorkerRuntime(value: WorkerRuntime | undefined): void {
  runtime = value;
}

export function getWorkerRuntime(): WorkerRuntime | undefined {
  return runtime;
}
