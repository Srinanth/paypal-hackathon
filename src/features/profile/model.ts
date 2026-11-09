export const FACE_MODEL_VERSION = 'facenet-128-289bc104-v1';
export const FACE_PREPROCESSING_VERSION = 'rgb160-prewhiten-v1';

export type UserProfile = {
  userId: string | null;
  email: string;
  accessToken: string | null;
  displayName: string;
  paypalRecipient: string;
  facePayEnabled: boolean;
  faceEnrolled: boolean;
  enrolledAt: number;
  modelVersion: string;
  preprocessingVersion: string;
};

export type MatchRecipient = {
  id: string;
  matchSessionId: string;
  displayName: string;
  maskedPayPalRecipient: string;
  similarity: number;
  expiresAt: number;
};
