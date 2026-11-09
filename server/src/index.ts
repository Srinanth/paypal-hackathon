import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { captureOrder, createSellerOrder, getOrder, isPayPalConfigured, PayPalGatewayError } from './paypal.js';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT ?? 4310);
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const MODEL_VERSION = 'facenet-128-289bc104-v1';
const PREPROCESSING_VERSION = 'rgb160-prewhiten-v1';
const MATCH_THRESHOLD = 0.72;
const MATCH_MARGIN = 0.08;

const databaseUrl = process.env.DATABASE_URL;
const tokenSecret = process.env.AUTH_TOKEN_SECRET;
const encryptionKeyEncoded = process.env.BIOMETRIC_ENCRYPTION_KEY;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!tokenSecret || Buffer.byteLength(tokenSecret) < 32) throw new Error('AUTH_TOKEN_SECRET must contain at least 32 bytes.');
if (!encryptionKeyEncoded) throw new Error('BIOMETRIC_ENCRYPTION_KEY is required.');
const encryptionKey = Buffer.from(encryptionKeyEncoded, 'base64');
if (encryptionKey.byteLength !== 32) throw new Error('BIOMETRIC_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
if (process.env.NODE_ENV === 'production') {
  const allowedOrigins = process.env.APP_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [];
  if (process.env.DATABASE_SSL !== 'true') throw new Error('DATABASE_SSL=true is required in production.');
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) throw new Error('Configure explicit APP_ORIGINS in production; do not allow wildcard origins.');
  if (process.env.TRUST_PROXY !== 'true') throw new Error('Set TRUST_PROXY=true behind the TLS-terminating HTTPS proxy in production.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

type AuthenticatedRequest = FastifyRequest & { authenticatedUserId?: string };
declare module 'fastify' {
  interface FastifyRequest { authenticatedUserId?: string; }
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.body.password', 'req.body.embedding'] },
  trustProxy: process.env.TRUST_PROXY === 'true',
  bodyLimit: 256 * 1024,
});

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(48),
  paypalRecipient: z.union([z.literal(''), z.string().trim().email().max(128)]),
  facePayEnabled: z.boolean(),
}).superRefine((profile, context) => {
  if (profile.facePayEnabled && !profile.paypalRecipient) {
    context.addIssue({ code: 'custom', path: ['paypalRecipient'], message: 'A PayPal seller email is required to receive face payments.' });
  }
});
const faceTemplateSchema = z.object({
  modelVersion: z.literal(MODEL_VERSION),
  preprocessingVersion: z.literal(PREPROCESSING_VERSION),
  facePayEnabled: z.literal(true),
  embedding: z.array(z.number().finite()).length(128),
});
const probeSchema = z.object({
  modelVersion: z.literal(MODEL_VERSION),
  preprocessingVersion: z.literal(PREPROCESSING_VERSION),
  embedding: z.array(z.number().finite()).length(128),
});
const paymentSchema = z.object({
  recipientId: z.string().uuid(),
  matchSessionId: z.string().uuid(),
  amount: z.string().regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/),
  currency: z.literal('USD'),
  requestId: z.string().uuid(),
});

function encrypt(plain: Buffer): { cipher: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { cipher: encrypted, iv, tag: cipher.getAuthTag() };
}

function decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function signToken(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })).toString('base64url');
  const body = `${header}.${payload}`;
  const signature = createHmac('sha256', tokenSecret!).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readToken(token: string): string | null {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) return null;
  const body = `${header}.${payload}`;
  const expected = createHmac('sha256', tokenSecret!).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
    return typeof parsed.sub === 'string' && typeof parsed.exp === 'number' && parsed.exp > Date.now() / 1000 ? parsed.sub : null;
  } catch { return null; }
}

async function requireAuth(request: AuthenticatedRequest, reply: FastifyReply): Promise<void | FastifyReply> {
  const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  const userId = bearer ? readToken(bearer) : null;
  if (!userId) {
    return reply.code(401).send({ error: 'AUTH_REQUIRED', message: 'Sign in to use face payments.' });
  }
  const account = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (!account.rowCount) {
    return reply.code(401).send({ error: 'AUTH_REQUIRED', message: 'This account is no longer available. Sign in again.' });
  }
  request.authenticatedUserId = userId;
}

async function passwordHash(password: string, salt = randomBytes(16)): Promise<string> {
  const result = await scrypt(password, salt, 64) as Buffer;
  return `${salt.toString('base64')}:${result.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltText, hashText] = stored.split(':');
  if (!saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64'), expected.byteLength) as Buffer;
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function maskedRecipient(value: string): string {
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`;
  }
  return `••••${value.slice(-4)}`;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i]; leftNorm += left[i] * left[i]; rightNorm += right[i] * right[i];
  }
  const denominator = Math.sqrt(leftNorm * rightNorm);
  return denominator > 0 ? dot / denominator : -1;
}

async function main() {
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: process.env.APP_ORIGINS?.split(',').map((origin) => origin.trim()) ?? false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/health', async () => ({ ok: true, service: 'nearpay-api' }));

  app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Enter a valid email and a password of at least 12 characters.' });
    const email = parsed.data.email.toLowerCase();
    const hash = await passwordHash(parsed.data.password);
    try {
      const result = await pool.query<{ id: string }>('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, hash]);
      return reply.code(201).send({ userId: result.rows[0].id, accessToken: signToken(result.rows[0].id), expiresIn: TOKEN_TTL_SECONDS });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'ACCOUNT_EXISTS', message: 'An account already exists for this email.' });
      throw error;
    }
  });

  app.post('/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Enter your email and password.' });
    const result = await pool.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [parsed.data.email.toLowerCase()]);
    if (!result.rowCount || !(await verifyPassword(parsed.data.password, result.rows[0].password_hash))) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    return { userId: result.rows[0].id, accessToken: signToken(result.rows[0].id), expiresIn: TOKEN_TTL_SECONDS };
  });

  app.get('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as AuthenticatedRequest).authenticatedUserId!;
    const result = await pool.query<{
      id: string; email: string; display_name: string; paypal_recipient_cipher: Buffer | null; paypal_recipient_iv: Buffer | null; paypal_recipient_tag: Buffer | null; face_pay_enabled: boolean; has_template: boolean;
    }>(`SELECT u.id, u.email, u.display_name, u.paypal_recipient_cipher, u.paypal_recipient_iv, u.paypal_recipient_tag, u.face_pay_enabled,
      EXISTS(SELECT 1 FROM face_templates f WHERE f.user_id = u.id) AS has_template FROM users u WHERE u.id = $1`, [userId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'PROFILE_NOT_FOUND' });
    const row = result.rows[0];
    let paypalRecipient = '';
    if (row.paypal_recipient_cipher && row.paypal_recipient_iv && row.paypal_recipient_tag) {
      paypalRecipient = decrypt(row.paypal_recipient_cipher, row.paypal_recipient_iv, row.paypal_recipient_tag).toString('utf8');
    }
    return { userId: row.id, email: row.email, displayName: row.display_name, paypalRecipient, facePayEnabled: row.face_pay_enabled, faceEnrolled: row.has_template };
  });

  app.put('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Check your display name and PayPal email. A PayPal email is required only when receiving face payments.' });
    const userId = (request as AuthenticatedRequest).authenticatedUserId!;
    let protectedValue: ReturnType<typeof encrypt> | null = null;
    if (parsed.data.paypalRecipient) {
      const clear = Buffer.from(parsed.data.paypalRecipient, 'utf8');
      protectedValue = encrypt(clear);
      clear.fill(0);
    }
    await pool.query(`UPDATE users SET display_name = $1, paypal_recipient_cipher = $2, paypal_recipient_iv = $3,
      paypal_recipient_tag = $4, face_pay_enabled = $5, updated_at = now() WHERE id = $6`,
    [parsed.data.displayName, protectedValue?.cipher ?? null, protectedValue?.iv ?? null, protectedValue?.tag ?? null, parsed.data.facePayEnabled, userId]);
    return { ok: true };
  });

  app.put('/profile/face-template', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = faceTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_TEMPLATE', message: 'The face template format is not supported.' });
    const userId = (request as AuthenticatedRequest).authenticatedUserId!;
    const profile = await pool.query<{ face_pay_enabled: boolean; paypal_recipient_cipher: Buffer | null }>('SELECT face_pay_enabled, paypal_recipient_cipher FROM users WHERE id = $1', [userId]);
    if (!profile.rowCount || !profile.rows[0].face_pay_enabled || !profile.rows[0].paypal_recipient_cipher) {
      return reply.code(409).send({ error: 'PROFILE_INCOMPLETE', message: 'Save a PayPal recipient and explicitly opt in to face payments first.' });
    }
    const norm = Math.sqrt(parsed.data.embedding.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.01) return reply.code(400).send({ error: 'INVALID_TEMPLATE', message: 'The face template is not normalized.' });
    const clear = Buffer.from(JSON.stringify(parsed.data.embedding), 'utf8');
    try {
      const protectedValue = encrypt(clear);
      await pool.query(`INSERT INTO face_templates (user_id, model_version, preprocessing_version, template_cipher, template_iv, template_tag)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO UPDATE SET model_version = EXCLUDED.model_version,
        preprocessing_version = EXCLUDED.preprocessing_version, template_cipher = EXCLUDED.template_cipher,
        template_iv = EXCLUDED.template_iv, template_tag = EXCLUDED.template_tag, updated_at = now()`,
      [userId, parsed.data.modelVersion, parsed.data.preprocessingVersion, protectedValue.cipher, protectedValue.iv, protectedValue.tag]);
      return { ok: true };
    } finally {
      clear.fill(0);
      parsed.data.embedding.fill(0);
      const original = request.body as { embedding?: unknown };
      if (Array.isArray(original?.embedding)) original.embedding.fill(0);
    }
  });

  app.delete('/profile/face-template', { preHandler: requireAuth }, async (request) => {
    const userId = (request as AuthenticatedRequest).authenticatedUserId!;
    await pool.query('DELETE FROM face_templates WHERE user_id = $1', [userId]);
    await pool.query('UPDATE users SET face_pay_enabled = FALSE, updated_at = now() WHERE id = $1', [userId]);
    return { ok: true };
  });

  app.delete('/account', { preHandler: requireAuth }, async (request) => {
    const userId = (request as AuthenticatedRequest).authenticatedUserId!;
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return { ok: true };
  });

  app.post('/match', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = probeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PROBE', message: 'The face scan could not be processed.' });
    const payerId = (request as AuthenticatedRequest).authenticatedUserId!;
    const probe = parsed.data.embedding;
    const matches: { row: { id: string; display_name: string; paypal_recipient_cipher: Buffer; paypal_recipient_iv: Buffer; paypal_recipient_tag: Buffer }; score: number }[] = [];
    try {
      const candidates = await pool.query<{
      id: string; display_name: string; paypal_recipient_cipher: Buffer; paypal_recipient_iv: Buffer; paypal_recipient_tag: Buffer;
      template_cipher: Buffer; template_iv: Buffer; template_tag: Buffer;
      }>(`SELECT u.id, u.display_name, u.paypal_recipient_cipher, u.paypal_recipient_iv, u.paypal_recipient_tag,
      f.template_cipher, f.template_iv, f.template_tag FROM users u JOIN face_templates f ON f.user_id = u.id
      WHERE u.face_pay_enabled = TRUE AND u.id <> $1`, [payerId]);
      for (const row of candidates.rows) {
        const clear = decrypt(row.template_cipher, row.template_iv, row.template_tag);
        try {
          const candidate = JSON.parse(clear.toString('utf8')) as number[];
          try {
            if (candidate.length !== 128 || candidate.some((value) => !Number.isFinite(value))) continue;
            const score = cosineSimilarity(probe, candidate);
            if (score >= MATCH_THRESHOLD) matches.push({ row, score });
          } finally { candidate.fill(0); }
        } finally { clear.fill(0); }
      }
      matches.sort((left, right) => right.score - left.score);
      const best = matches[0];
      const next = matches[1];
      if (!best || (next && best.score - next.score < MATCH_MARGIN)) return reply.code(404).send({ error: 'NO_UNIQUE_MATCH', message: 'No single enrolled face matched clearly. Try again with a clear view.' });
      const recipientBytes = decrypt(best.row.paypal_recipient_cipher, best.row.paypal_recipient_iv, best.row.paypal_recipient_tag);
      const masked = maskedRecipient(recipientBytes.toString('utf8'));
      recipientBytes.fill(0);
      const matchSessionId = randomUUID();
      await pool.query('DELETE FROM face_match_sessions WHERE expires_at < now() - interval \'1 day\'');
      await pool.query(`INSERT INTO face_match_sessions (session_id, payer_user_id, recipient_user_id, expires_at)
        VALUES ($1, $2, $3, now() + interval '2 minutes')`, [matchSessionId, payerId, best.row.id]);
      return { recipient: { id: best.row.id, displayName: best.row.display_name, maskedPayPalRecipient: masked }, similarity: Number(best.score.toFixed(3)), matchSessionId };
    } catch (error) {
      request.log.error({ err: error }, 'face match processing failed');
      return reply.code(500).send({ error: 'MATCH_UNAVAILABLE', message: 'Face matching is temporarily unavailable.' });
    } finally {
      probe.fill(0);
      const original = request.body as { embedding?: unknown };
      if (Array.isArray(original?.embedding)) original.embedding.fill(0);
      matches.length = 0;
    }
  });

  app.get('/payments/recent', { preHandler: requireAuth }, async (request) => {
    const payerId = (request as AuthenticatedRequest).authenticatedUserId!;
    const result = await pool.query<{
      recipient_name: string; amount: string; currency: string; status: 'COMPLETED' | 'PENDING'; created_at: Date;
    }>(`SELECT u.display_name AS recipient_name, p.amount::text, p.currency, p.status, p.created_at
      FROM paypal_payment_intents p
      JOIN users u ON u.id = p.recipient_user_id
      WHERE p.payer_user_id = $1 AND p.status IN ('COMPLETED', 'PENDING')
      ORDER BY p.created_at DESC LIMIT 5`, [payerId]);
    return { payments: result.rows.map((row) => ({
      recipientName: row.recipient_name || 'NearPay recipient',
      amount: row.amount,
      currency: 'USD' as const,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    })) };
  });

  app.post('/payments', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success || Number(parsed.data?.amount) <= 0) {
      return reply.code(400).send({ error: 'INVALID_PAYMENT', message: 'Check the recipient match and enter a positive USD amount.' });
    }
    if (!isPayPalConfigured()) {
      return reply.code(503).send({ error: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal Sandbox is not ready. Add the server credentials and public API origin, then restart the API.' });
    }

    const payerId = (request as AuthenticatedRequest).authenticatedUserId!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ paypal_order_id: string; approval_url: string; status: 'PAYER_ACTION_REQUIRED' | 'APPROVAL_REQUIRED' | 'COMPLETED' | 'PENDING'; recipient_user_id: string; amount: string; currency: string }>(
        'SELECT paypal_order_id, approval_url, status, recipient_user_id, amount::text, currency FROM paypal_payment_intents WHERE request_id = $1 AND payer_user_id = $2',
        [parsed.data.requestId, payerId],
      );
      if (existing.rowCount) {
        const previous = existing.rows[0];
        if (previous.recipient_user_id !== parsed.data.recipientId || Number(previous.amount).toFixed(2) !== Number(parsed.data.amount).toFixed(2) || previous.currency !== parsed.data.currency) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'REQUEST_ID_REUSED', message: 'This payment request was already used for different details. Scan the recipient again.' });
        }
        await client.query('COMMIT');
        const intent = previous;
        return { id: intent.paypal_order_id, approvalUrl: intent.approval_url, status: intent.status };
      }

      const session = await client.query<{ recipient_user_id: string; consumed_at: Date | null }>(
        `SELECT recipient_user_id, consumed_at FROM face_match_sessions
          WHERE session_id = $1 AND payer_user_id = $2 AND recipient_user_id = $3 AND expires_at > now()
          FOR UPDATE`,
        [parsed.data.matchSessionId, payerId, parsed.data.recipientId],
      );
      if (!session.rowCount || session.rows[0].consumed_at) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'MATCH_EXPIRED', message: 'This face match has expired or was already used. Scan the recipient again.' });
      }

      const recipient = await client.query<{
        paypal_recipient_cipher: Buffer; paypal_recipient_iv: Buffer; paypal_recipient_tag: Buffer;
      }>(`SELECT u.paypal_recipient_cipher, u.paypal_recipient_iv, u.paypal_recipient_tag
        FROM users u JOIN face_templates f ON f.user_id = u.id
        WHERE u.id = $1 AND u.id <> $2 AND u.face_pay_enabled = TRUE`, [parsed.data.recipientId, payerId]);
      if (!recipient.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'RECIPIENT_UNAVAILABLE', message: 'This recipient is no longer accepting face payments.' });
      }
      const recipientBytes = decrypt(recipient.rows[0].paypal_recipient_cipher, recipient.rows[0].paypal_recipient_iv, recipient.rows[0].paypal_recipient_tag);
      const recipientEmail = recipientBytes.toString('utf8').trim();
      recipientBytes.fill(0);
      if (!z.string().email().safeParse(recipientEmail).success) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'RECIPIENT_PAYPAL_EMAIL_REQUIRED', message: 'The recipient must add a valid PayPal email address before receiving payments.' });
      }

      try {
        const paypalOrder = await createSellerOrder({
          requestId: parsed.data.requestId,
          amount: Number(parsed.data.amount).toFixed(2),
          currency: parsed.data.currency,
          recipientEmail,
        });
        await client.query(`INSERT INTO paypal_payment_intents
          (paypal_order_id, request_id, payer_user_id, recipient_user_id, amount, currency, approval_url, capture_request_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [paypalOrder.id, parsed.data.requestId, payerId, parsed.data.recipientId, Number(parsed.data.amount).toFixed(2), parsed.data.currency, paypalOrder.approvalUrl, randomUUID()]);
        await client.query('UPDATE face_match_sessions SET consumed_at = now() WHERE session_id = $1', [parsed.data.matchSessionId]);
        await client.query('COMMIT');
        return reply.code(201).send({ id: paypalOrder.id, approvalUrl: paypalOrder.approvalUrl, status: 'PAYER_ACTION_REQUIRED' });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof PayPalGatewayError && error.code === 'NOT_CONFIGURED') {
          return reply.code(503).send({ error: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal Sandbox is not ready. Check the server credentials and public API origin.' });
        }
        request.log.warn({ code: error instanceof PayPalGatewayError ? error.code : 'ORDER_FAILED' }, 'PayPal order creation failed');
        return reply.code(502).send({ error: 'PAYPAL_ORDER_FAILED', message: 'PayPal could not start this payment. Check the recipient Sandbox seller setup and try again.' });
      }
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally { client.release(); }
  });

  app.post('/payments/:orderId/capture', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const orderId = (request.params as { orderId?: string }).orderId ?? '';
    if (!/^[A-Z0-9-]{5,64}$/i.test(orderId)) return reply.code(400).send({ error: 'INVALID_ORDER', message: 'This PayPal order reference is invalid.' });
    if (!isPayPalConfigured()) return reply.code(503).send({ error: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal Sandbox is not ready. Add the server credentials and public API origin.' });
    const payerId = (request as AuthenticatedRequest).authenticatedUserId!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const payment = await client.query<{
        paypal_order_id: string; payer_user_id: string; recipient_user_id: string; amount: string; currency: string;
        status: 'PAYER_ACTION_REQUIRED' | 'APPROVAL_REQUIRED' | 'COMPLETED' | 'PENDING'; capture_request_id: string; capture_id: string | null;
      }>(`SELECT paypal_order_id, payer_user_id, recipient_user_id, amount::text, currency, status, capture_request_id, capture_id
        FROM paypal_payment_intents WHERE paypal_order_id = $1 AND payer_user_id = $2 FOR UPDATE`, [orderId, payerId]);
      if (!payment.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PAYMENT_NOT_FOUND', message: 'This order does not belong to your account or has expired.' });
      }
      const row = payment.rows[0];
      if (row.status === 'COMPLETED') {
        await client.query('COMMIT');
        return { id: row.paypal_order_id, status: row.status, captureId: row.capture_id };
      }
      const recipient = await client.query<{
        paypal_recipient_cipher: Buffer; paypal_recipient_iv: Buffer; paypal_recipient_tag: Buffer;
      }>('SELECT paypal_recipient_cipher, paypal_recipient_iv, paypal_recipient_tag FROM users WHERE id = $1', [row.recipient_user_id]);
      if (!recipient.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'RECIPIENT_UNAVAILABLE', message: 'The recipient account is no longer available.' });
      }
      const recipientBytes = decrypt(recipient.rows[0].paypal_recipient_cipher, recipient.rows[0].paypal_recipient_iv, recipient.rows[0].paypal_recipient_tag);
      const recipientEmail = recipientBytes.toString('utf8').trim();
      recipientBytes.fill(0);

      const order = await getOrder(row.paypal_order_id);
      const purchase = order.purchase_units?.[0];
      const payeeEmail = purchase?.payee?.email_address?.toLowerCase();
      const expectedEmail = recipientEmail.toLowerCase();
      const orderAmount = purchase?.amount;
      if (order.intent !== 'CAPTURE' || !purchase || payeeEmail !== expectedEmail || orderAmount?.currency_code !== row.currency || Number(orderAmount.value).toFixed(2) !== Number(row.amount).toFixed(2)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'ORDER_DETAILS_MISMATCH', message: 'The PayPal order details do not match the reviewed recipient and amount.' });
      }

      let result: { status: 'COMPLETED' | 'PENDING'; captureId: string | null };
      if (order.status === 'COMPLETED') {
        const capture = purchase.payments?.captures?.[0];
        result = { status: capture?.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING', captureId: capture?.id ?? null };
      } else {
        if (order.status !== 'APPROVED') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'PAYPAL_APPROVAL_REQUIRED', message: 'Approve this payment in PayPal before completing it.' });
        }
        const captured = await captureOrder(row.paypal_order_id, row.capture_request_id);
        result = captured;
      }
      await client.query(`UPDATE paypal_payment_intents SET status = $1, capture_id = $2, updated_at = now()
        WHERE paypal_order_id = $3`, [result.status, result.captureId, row.paypal_order_id]);
      await client.query('COMMIT');
      return { id: row.paypal_order_id, status: result.status, captureId: result.captureId };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      if (error instanceof PayPalGatewayError) {
        request.log.warn({ code: error.code }, 'PayPal capture verification failed');
        return reply.code(error.code === 'NOT_CONFIGURED' ? 503 : 502).send({
          error: error.code === 'NOT_CONFIGURED' ? 'PAYPAL_NOT_CONFIGURED' : 'PAYPAL_CAPTURE_FAILED',
          message: error.code === 'NOT_CONFIGURED' ? 'PayPal Sandbox is not ready.' : 'PayPal could not verify or capture this order. Check its status and try again.',
        });
      }
      throw error;
    } finally { client.release(); }
  });

  app.get('/paypal/return', async (request, reply) => {
    const token = (request.query as { token?: string }).token ?? '';
    if (!/^[A-Z0-9-]{5,64}$/i.test(token)) return reply.code(400).type('text/plain').send('PayPal did not return a valid order reference. Reopen NearPay to check the payment.');
    return reply.redirect(`nearpay://payment-return?token=${encodeURIComponent(token)}`);
  });

  app.get('/paypal/cancel', async (_request, reply) => reply.redirect('nearpay://payment-cancelled'));

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, route: request.routeOptions.url }, 'request failed');
    void reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'The server could not complete this request.' });
  });

  await app.listen({ port: PORT, host: process.env.HOST ?? '0.0.0.0' });
  app.log.info({ port: PORT }, 'NearPay API listening');
}

main().catch(async (error: unknown) => {
  app.log.error({ err: error }, 'NearPay API failed to start');
  await pool.end();
  process.exitCode = 1;
});
