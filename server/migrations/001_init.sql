CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  paypal_recipient_cipher BYTEA,
  paypal_recipient_iv BYTEA,
  paypal_recipient_tag BYTEA,
  face_pay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS face_templates (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  preprocessing_version TEXT NOT NULL,
  template_cipher BYTEA NOT NULL,
  template_iv BYTEA NOT NULL,
  template_tag BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS face_pay_enabled_idx ON users(face_pay_enabled) WHERE face_pay_enabled = TRUE;

CREATE TABLE IF NOT EXISTS face_match_sessions (
  session_id UUID PRIMARY KEY,
  payer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS face_match_session_expiry_idx ON face_match_sessions(expires_at);

CREATE TABLE IF NOT EXISTS paypal_payment_intents (
  paypal_order_id TEXT PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  payer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(7, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'USD'),
  approval_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAYER_ACTION_REQUIRED' CHECK (status IN ('PAYER_ACTION_REQUIRED', 'APPROVAL_REQUIRED', 'COMPLETED', 'PENDING')),
  capture_request_id UUID NOT NULL,
  capture_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paypal_payment_payer_idx ON paypal_payment_intents(payer_user_id, created_at DESC);
