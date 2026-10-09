import type { WorkerMessage, WorkerProgress, WorkerRequest, WorkerResultMap } from './protocol.ts';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: WorkerProgress) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') p.onProgress?.(msg.progress);
    else if (msg.type === 'done') { pending.delete(msg.id); p.resolve(msg.result); }
    else { pending.delete(msg.id); p.reject(new Error(msg.message)); }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Worker crashed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Run an engine job off the main thread, streaming progress. */
export function runInWorker<K extends WorkerRequest['kind']>(
  req: Extract<WorkerRequest, { kind: K }>,
  onProgress?: (p: WorkerProgress) => void,
): Promise<WorkerResultMap[K]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ id, req });
  });
}
