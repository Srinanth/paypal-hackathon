import { randomBytes } from 'node:crypto';

process.stdout.write(`AUTH_TOKEN_SECRET=${randomBytes(48).toString('base64url')}\n`);
process.stdout.write(`BIOMETRIC_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`);
