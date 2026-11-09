import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
try {
  await pool.query(await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
  process.stdout.write('NearPay schema is ready.\n');
} finally {
  await pool.end();
}
