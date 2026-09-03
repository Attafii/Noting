import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let cached: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily-created Neon HTTP client. Created on first use (not at import time)
 * so a missing env var produces a clear error instead of a module-load crash.
 * `neon()` is a stateless HTTP function — safe to reuse across serverless calls.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (!cached) {
    const connectionString = process.env.NEON_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('NEON_CONNECTION_STRING environment variable is required');
    }
    cached = neon(connectionString);
  }
  return cached;
}
