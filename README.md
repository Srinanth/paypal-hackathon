# NearPay

NearPay is an Android-first face-recipient discovery prototype. A user creates an account and can use it to send payments. To receive face payments, they add an eligible PayPal seller email, explicitly opt in, and enroll their face once. The server stores the face vector encrypted at rest and can match it when another signed-in user scans them. The recipient app does not need to be open or online at payment time.

**PayPal Sandbox Orders are wired through the server.** The payer reviews the recipient and amount, approves the order on PayPal, then NearPay verifies the order and captures it server-side. No PayPal credential is bundled in the mobile app. Hackathon submission also requires meaningful PayPal Developer Platform integration, meaningful AI, a working prototype, a public source repository with an OSI license, setup instructions, and a public YouTube demo under three minutes. Verify the current checklist on the [official Devpost page](https://paypalaihackathon.devpost.com/).

## Architecture and privacy

- Face detection and embedding run on the payer's phone. The temporary camera photo is deleted after inference.
- The payer sends one temporary 128-value face embedding to the API over HTTPS in hosted deployments. Local Android development may use loopback HTTP through ADB reverse. The API validates the vector and compares it against opted-in templates. The client and server overwrite mutable vectors/buffers as best effort; JavaScript, networking, or database infrastructure may retain transient copies until garbage collection or their own cleanup.
- Enrolled face templates and the recipient's PayPal reference are AES-256-GCM encrypted by the API before PostgreSQL storage. The encryption key is kept outside the database.
- The API returns only the matched account ID, display name, a masked PayPal reference, a short-lived similarity result, and an opaque match-session ID. It never returns stored embeddings or full payout references to the payer.
- Face discovery is explicit opt-in and can be disabled or deleted from Profile. The recipient need not run background work, broadcast BLE, or be online.
- Central biometric matching still has privacy and breach risk; encryption does not make biometrics risk-free. Do not use real payment credentials or treat face match as payment authorization. The payer must check the match and amount; PayPal approval remains a separate step.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full flow and security boundary.

## Stack

- Expo SDK 58, React Native, Expo Router, TypeScript, pnpm workspace.
- ML Kit face detection and bundled FaceNet TFLite embedding model.
- Fastify API, PostgreSQL, scrypt password hashes, short-lived bearer tokens, AES-256-GCM application encryption, and rate-limited 1:N matching.
- PayPal Orders v2 API integration in `server/src/paypal.ts`; no PayPal credentials belong in the mobile app.

## Prerequisites

- Node.js 20+ and pnpm 10+.
- Android Studio, Android SDK Platform 36, Build Tools, and JDK 17.
- PostgreSQL 14+ for the API. A hosted TLS-enabled database is recommended for a two-device demo.
- An API endpoint reachable from both phones. For local Android demos, ADB reverse maps the phone's loopback to the PC; hosted demos need a public HTTPS API origin.

## One-time manual setup

1. Create a PostgreSQL database. Apply `server/migrations/001_init.sql` with `pnpm --filter @nearpay/server db:migrate` after setting the environment below.
2. Generate the encryption key with `pnpm --filter @nearpay/server keygen`; store it in a secret manager. Do not commit it or use a production database with a demo key.
3. Set `DATABASE_URL`, `DATABASE_SSL=true` for hosted TLS, `AUTH_TOKEN_SECRET` (at least 32 random bytes), and `BIOMETRIC_ENCRYPTION_KEY` (the generated base64 key) in `server/.env` or the deployment secret store.
4. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from the PayPal Sandbox REST app in `server/.env`. Keep `PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com`. Never put these values in the root app `.env` or in an `EXPO_PUBLIC_*` variable.
5. For a local Android device demo, set both `PUBLIC_API_ORIGIN` in `server/.env` and `EXPO_PUBLIC_API_URL` in root `.env` to `http://127.0.0.1:4310`, then run `adb reverse tcp:4310 tcp:4310` for the payer device. This lets the app and its PayPal browser return reach the local API. For a hosted demo, use the same public HTTPS API origin in both files instead; production rejects the local HTTP callback.
6. For hosted deployment, configure `APP_ORIGINS`, TLS termination, `TRUST_PROXY=true` only behind a trusted proxy, and HTTPS end-to-end. Keep secrets server-side.
7. Create PayPal Sandbox buyer and seller accounts manually. Enter the receiving Sandbox seller's PayPal email in the recipient's NearPay profile. Seller-directed orders require eligible PayPal seller setup; unconnected sellers and production multiparty flows require PayPal partner approval and seller onboarding. See [PayPal seller onboarding](https://developer.paypal.com/platforms/seller-onboarding/) and [onboarding after payment](https://developer.paypal.com/platforms/seller-onboarding/after-payment/). Sandbox OAuth success confirms the credentials authenticate, but does not confirm that a seller can receive funds.

The API image can be built from the repository root with `docker build -f server/Dockerfile -t nearpay-api .`. Inject the server environment variables through your hosting provider's secret settings; do not bake a `.env` file or encryption key into the image. Apply the database migration as a release step with `pnpm --filter @nearpay/server db:migrate` in an environment that has the same database secrets.

## Run

```sh
pnpm install
pnpm --filter @nearpay/server db:migrate
pnpm --filter @nearpay/server dev
```

In another terminal:

```sh
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

This app includes native TFLite and ML Kit modules and needs a development build; Expo Go is not sufficient. Rebuild Android after changing native dependencies or app permissions.

## Demo flow

1. Start the API and install the app on two Android devices.
2. On the recipient device, create an account, add the PayPal Sandbox seller email, opt in to face discovery, and enroll. The app may then be closed and the phone can be offline. Payer-only users can skip the PayPal email and receiving setup.
3. On the payer device, create a separate account and select **Scan a face**. Allow camera access and scan the enrolled person's face while online.
4. Verify the matched name and masked recipient, enter an amount, and review. NearPay creates a PayPal order for the seller's PayPal email. Approve it with a Sandbox buyer account; the app returns to NearPay, which verifies the order and requests server-side capture. If the deep link does not reopen the app, return manually and choose **I approved — check payment**.

## Checks

```sh
pnpm exec tsc --noEmit
pnpm exec expo lint
pnpm --filter @nearpay/server typecheck
pnpm --filter @nearpay/server build
```

Do not expose API secrets or the encryption key in client environment variables, logs, source control, or screenshots.
