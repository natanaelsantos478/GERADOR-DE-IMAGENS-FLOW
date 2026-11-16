/** Minimal worker_threads pool (tsx loader in workers). */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ msg: unknown; res: (v: any) => void; rej: (e: Error) => void }> = [];
  private pending = new Map<Worker, { res: (v: any) => void; rej: (e: Error) => void }>();

  constructor(n: number, workerFile = new URL('./worker.ts', import.meta.url)) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(workerFile), { execArgv: ['--import', 'tsx'] });
      w.on('message', (m: { ok: boolean; v?: unknown; e?: string }) => {
        const p = this.pending.get(w)!;
        this.pending.delete(w);
        this.idle.push(w);
        if (m.ok) p.res(m.v); else p.rej(new Error(m.e));
        this.pump();
      });
      w.on('error', (e) => { const p = this.pending.get(w); if (p) p.rej(e); else console.error('worker', e); });
      this.workers.push(w);
    }
    this.idle = [...this.workers];
  }
  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!, job = this.queue.shift()!;
      this.pending.set(w, job);
      w.postMessage(job.msg);
    }
  }
  run<T>(msg: unknown): Promise<T> {
    return new Promise<T>((res, rej) => { this.queue.push({ msg, res, rej }); this.pump(); });
  }
  async close(): Promise<void> { await Promise.all(this.workers.map((w) => w.terminate())); }
}
