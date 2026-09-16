/**
 * Shared DB resilience helpers for API routes.
 *
 * Serverless functions die with a generic 500 when a Neon query hangs
 * (sleeping project, cold connection). Bounding every query converts that
 * into a fast, truthful 503 the client already handles ("waking up, retry").
 */

/** Reject if `promise` takes longer than `ms`. The underlying query is abandoned, not aborted. */
export function withQueryTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('database query timeout')), ms);
    promise.then(
      (v) => {
        if (timer) clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (timer) clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Connection-class failures (sleeping DB, DNS, socket, timeouts) — worth a retry / a 503. */
export function isColdStartError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /fetch failed|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|sleep|wake|connection|terminat|socket|server closed/i.test(
    msg,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
