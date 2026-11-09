# NearPay architecture

NearPay uses server-side recipient discovery to remove recipient-side foreground, background, BLE, and per-payment confirmation work. An enrolled recipient is searchable only after explicitly opting in. The recipient device may be offline and the app may be closed.

## Components

- `src/app`: account creation/sign-in, profile/consent, face enrollment, scan, and amount review.
- `src/features/face`: local face detection, FaceNet embedding, and enrollment sample averaging.
- `src/features/profile`: profile types and Android SecureStore for the signed-in session and non-biometric display metadata. Face vectors are not retained in client storage.
- `src/features/server`: authenticated HTTPS API adapter, short-lived match endpoint, and payment endpoints client.
- `server/src`: Fastify authentication, profile management, encrypted template storage, and server-side cosine matching.
- `server/migrations`: PostgreSQL schema; templates and PayPal recipient references are application-encrypted AES-256-GCM with a server-held key.
- `src/features/payments`: mobile adapter for server-created PayPal Orders and server capture.
- `server/src/paypal.ts`: OAuth client credentials, order creation, approved-order lookup, capture, and approval URL checks.
- `GET /payments/recent`: authenticated payer activity feed. It returns at most five pending or completed payments without exposing PayPal order IDs or recipient payout emails.

## Enrollment and match flow

1. User creates an account or signs in. API returns a seven-day signed bearer token; the app stores it in Android SecureStore.
2. User enters a display name. A user who wants to receive face payments adds a PayPal seller email and explicitly opts in to face discovery; payer-only users can leave that field blank.
3. Three camera samples are detected and embedded on the phone. Only the averaged normalized vector is uploaded over HTTPS. Camera captures are deleted after inference and mutable vectors are overwritten as best effort; runtime copies may persist until garbage collection. The API encrypts the vector before storing it in PostgreSQL.
4. The enrolled recipient needs no ongoing app process, BLE advertisement, or network connection for someone else to find them.
5. Payer scans a face. Camera image processing and embedding run locally; one temporary vector is sent to the rate-limited match endpoint over HTTPS in hosted deployments, or over loopback HTTP through ADB reverse during local Android development.
6. API decrypts opted-in templates in memory, compares with cosine similarity and ambiguity rejection, and returns only recipient ID, display name, masked payout reference, score, and an opaque match-session ID. The session is bound to the signed-in payer and recipient, expires after two minutes, and can be used once to request an order. Mutable probe/template buffers are overwritten as best effort; JavaScript runtime copies may remain until garbage collection.
7. Payer reviews recipient and amount and confirms locally. The API checks the single-use match session, creates a PayPal Orders v2 `CAPTURE` order addressed to the recipient's PayPal email, and returns the order ID and PayPal approval URL. The app opens PayPal and includes a manual resume action if the browser does not deep-link back.
8. After approval, the API looks up the order directly with PayPal, verifies `CAPTURE` intent, seller email, amount, currency, payer ownership, and approved status, then captures with a stable idempotency key. NearPay shows `COMPLETED` only after PayPal confirms it; a PayPal `PENDING` result stays pending.
9. The home screen loads the payer's latest five pending or completed payments from the authenticated activity endpoint when it comes into focus.

## Security and privacy boundaries

- No raw face photo is uploaded or stored by this flow. The embedding is biometric data and must be treated as sensitive.
- Face templates and payout references are encrypted at rest with AES-256-GCM in the application layer. Key management, TLS, database encryption/backups, access controls, breach response, retention and deletion policies must be completed before production.
- TLS protects hosted traffic; local development uses the ADB loopback forward and must not be exposed to the public internet. TLS does not eliminate central database or server compromise risk. A server with the key can match faces. Users can opt out or delete the account.
- In-memory clearing is best effort in a garbage-collected JavaScript runtime. Avoid claiming immediate or forensic erasure of transient vectors.
- API logs redact authorization, password, and embedding fields. Avoid adding request-body logging or analytics containing biometric data.
- Thresholds are demo heuristics, not identity verification. There is no production presentation-attack detection. Face match is only recipient discovery and never authorizes money movement.
- The payer must verify the name, masked reference, and amount. PayPal's approval and server-side transaction verification must remain separate.
- PayPal OAuth credentials, approval URLs, and order details remain on the server/API boundary. The return route only accepts an order reference and never marks a payment complete by trusting the browser redirect.
- Seller-directed orders require an eligible PayPal seller setup. The REST app must be approved for the relevant multiparty capabilities and sellers may need to be onboarded or connected. Sandbox OAuth success proves only that the client credentials authenticate, not that an arbitrary recipient can receive a payment.
- Current account auth is a prototype: email/password only, with no password reset, email verification, token refresh/revocation, or account recovery. Do not put real payment credentials in it.

## Offline behavior

An enrolled recipient can be offline because their encrypted template resides on the API. The payer must be online to upload a probe and receive the match. No BLE or recipient foreground/background activity is used.
