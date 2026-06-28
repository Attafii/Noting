import { neon } from '@neondatabase/serverless';

if (!process.env.NEON_CONNECTION_STRING) {
  throw new Error('NEON_CONNECTION_STRING environment variable is required');
}

export const sql = neon(process.env.NEON_CONNECTION_STRING);
