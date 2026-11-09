import * as SecureStore from 'expo-secure-store';
import type { UserProfile } from './model';

const PROFILE_KEY = 'nearpay.local-profile.v1';
// SecureStore's Android key is scoped by keychainService too. Keep the same
// options on every operation or reads silently look under a different key.
const STORE_OPTIONS = { keychainService: PROFILE_KEY } as const;

export const profileStore = {
  async load(): Promise<UserProfile | null> {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY, STORE_OPTIONS);
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as Partial<UserProfile>;
      const profile: UserProfile = {
        userId: stored.userId ?? null,
        email: stored.email ?? '',
        accessToken: stored.accessToken ?? null,
        displayName: stored.displayName ?? '',
        paypalRecipient: stored.paypalRecipient ?? '',
        facePayEnabled: stored.facePayEnabled ?? false,
        faceEnrolled: stored.faceEnrolled ?? Boolean((stored as { faceTemplate?: unknown }).faceTemplate),
        enrolledAt: stored.enrolledAt ?? 0,
        modelVersion: stored.modelVersion ?? '',
        preprocessingVersion: stored.preprocessingVersion ?? '',
      };
      // Migrate any old local-only face template out of SecureStore; biometrics live server-side now.
      if ('faceTemplate' in stored) await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile), STORE_OPTIONS);
      return profile;
    } catch { return null; }
  },
  save(profile: UserProfile) {
    return SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile), STORE_OPTIONS);
  },
  delete() { return SecureStore.deleteItemAsync(PROFILE_KEY, STORE_OPTIONS); },
};
