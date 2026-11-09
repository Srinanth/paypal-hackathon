# Login and face-enrollment handoff

Updated: 2026-11-07

## What was broken

After successful registration, the app saved the profile but returned to the account screen. `profileStore.save()` supplied a SecureStore `keychainService`; `profileStore.load()` did not. On Android, SecureStore scopes the stored preference by that service, so the subsequent read looked under a different key and returned `null`. The Profile screen treated that as a signed-out session and redirected to `/account`.

## Fix

`src/features/profile/storage.ts` now uses one shared SecureStore options object for reads, writes, migration writes, and deletion. Successful registration and sign-in can therefore load the profile from the same device-protected entry and continue to `/profile`.

## Device verification

- Tested on the Realme C55 (`RMX3710`) using the project bundle from this workspace.
- Registered a disposable account after the fix; the app landed on **Set up your profile**.
- Filled disposable profile details, enabled face discovery, saved, and confirmed **Enroll my face** became available.
- Opened enrollment and confirmed the camera permission screen. Camera permission was not granted and no face was captured or uploaded.
- Deleted the disposable account on the API and signed out; verified the local SecureStore profile key was removed.
- Android autofill displayed saved sign-in data while the temporary test session was being cleaned up. Those autofilled values were not submitted or used.
- `pnpm exec tsc --noEmit` and `pnpm exec expo lint` both passed.

## Recognition pipeline in this build

1. ML Kit face detection locates the face on-device and rejects captures with zero or multiple faces.
2. The app crops and resizes the detected face to 160 × 160 RGB, applies per-image mean/std normalization (`rgb160-prewhiten-v1`), and runs the bundled TensorFlow Lite FaceNet model (`assets/models/facenet.tflite`) locally.
3. The model returns a normalized 128-dimensional embedding. Enrollment averages three pose samples and uploads only that vector; temporary camera images/crops are deleted by the app.
4. The API stores the embedding encrypted with AES-256-GCM. On a payer scan, the API compares cosine similarity against opted-in enrolled vectors; the current demo threshold is 0.72, with a 0.08 best-vs-next-match margin.

The model artifact notice credits Shubham Panchal's FaceRecognition_With_FaceNet_Android distribution at commit `289bc10420aad15fed99094eee364eb24f908ecc` and lists Apache 2.0. This is FaceNet embedding-based recognition, not Android/iOS device Face ID and not eye recognition. It is a demo matcher without production liveness or anti-spoofing. PayPal Orders and server-side capture verification are implemented for Sandbox; production seller-directed payments still require the appropriate PayPal seller onboarding and account capabilities.

## Current local development state

- Metro was restarted from this project workspace on port `8081` with `EXPO_PUBLIC_API_URL=http://127.0.0.1:4310`.
- The NearPay API answered `/health` on port `4310`; PostgreSQL is local and its service was running during the checks.
- The Realme had ADB reverse mappings for ports `8081` and `4310` during device verification.
- The disposable test account and local test profile are removed. The app is signed out. Do not treat these local development services as an internet-accessible production deployment.
- As of 2026-11-07, wireless ADB is connected to the Realme and NearPay is open in its Android activity. Metro was restarted on port `8081`, and ADB reverse forwarding for `8081` is active.
- The API was not listening on port `4310` when the app was reopened. Sign-in and enrollment upload will need the local API restarted with `pnpm server:dev` before they can work.

## When continuing on the phone

1. Create an account or sign in on the Realme.
2. On **Set up your profile**, enter the display name and PayPal recipient reference, opt in to face discovery, then save.
3. Tap **Enroll my face**. Grant camera permission when Android asks, then follow the three on-screen pose prompts.

The development API/Metro processes should remain running while using the app against this local backend. For a fresh shell, use `pnpm server:dev` for the API and set `EXPO_PUBLIC_API_URL=http://127.0.0.1:4310` before `pnpm start`; re-establish `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:4310 tcp:4310` if the device disconnects.
