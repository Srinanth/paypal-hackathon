import { FACE_MODEL_VERSION, FACE_PREPROCESSING_VERSION, type UserProfile, type MatchRecipient } from '../profile/model';

const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const ALLOWS_LOCAL_HTTP = __DEV__ && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(API_BASE ?? '');

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type AuthResponse = { userId: string; accessToken: string; expiresIn: number };
type PublicProfile = Pick<UserProfile, 'userId' | 'email' | 'displayName' | 'paypalRecipient' | 'facePayEnabled'> & { faceEnrolled: boolean };
type MatchResponse = { recipient: Omit<MatchRecipient, 'similarity' | 'expiresAt' | 'matchSessionId'>; similarity: number; matchSessionId: string };
export type RecentPayment = { recipientName: string; amount: string; currency: 'USD'; status: 'COMPLETED' | 'PENDING'; createdAt: string };

async function request<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  if (!API_BASE) throw new ApiError('NearPay server is not configured. Set EXPO_PUBLIC_API_URL and rebuild the app.', 0, 'SERVER_URL_MISSING');
  if (!API_BASE.startsWith('https://') && !ALLOWS_LOCAL_HTTP) {
    throw new ApiError('Use HTTPS for the NearPay API. Plain HTTP is only allowed for localhost during development.', 0, 'HTTPS_REQUIRED');
  }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abort.signal,
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) throw new ApiError(payload.message ?? 'The NearPay server could not complete this request.', response.status, payload.error);
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new ApiError('The server took too long to respond. Check your connection and try again.', 408, 'REQUEST_TIMEOUT');
    throw new ApiError('Could not reach the NearPay server. Check your internet connection.', 0, 'NETWORK_ERROR');
  } finally { clearTimeout(timeout); }
}

export const serverApi = {
  register(email: string, password: string) {
    return request<AuthResponse>('/auth/register', { method: 'POST', body: { email, password } });
  },
  login(email: string, password: string) {
    return request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
  },
  getProfile(token: string) { return request<PublicProfile>('/profile', { token }); },
  getRecentPayments(token: string) { return request<{ payments: RecentPayment[] }>('/payments/recent', { token }); },
  saveProfile(token: string, profile: Pick<UserProfile, 'displayName' | 'paypalRecipient' | 'facePayEnabled'>) {
    return request<{ ok: true }>('/profile', { method: 'PUT', token, body: profile });
  },
  uploadFaceTemplate(token: string, profile: UserProfile, embedding: number[]) {
    return request<{ ok: true }>('/profile/face-template', {
      method: 'PUT', token,
      body: { modelVersion: profile.modelVersion, preprocessingVersion: profile.preprocessingVersion, facePayEnabled: true, embedding },
    });
  },
  matchFace(token: string, embedding: number[]) {
    return request<MatchResponse>('/match', {
      method: 'POST', token,
      body: { modelVersion: FACE_MODEL_VERSION, preprocessingVersion: FACE_PREPROCESSING_VERSION, embedding },
    }).then((result) => ({ ...result.recipient, matchSessionId: result.matchSessionId, similarity: result.similarity, expiresAt: Date.now() + 120_000 } satisfies MatchRecipient));
  },
  createPayment(token: string, payment: { recipientId: string; matchSessionId: string; amount: string; currency: 'USD'; requestId: string }) {
    return request<PaymentIntentResponse>('/payments', { method: 'POST', token, body: payment });
  },
  capturePayment(token: string, orderId: string) {
    return request<CapturedPaymentResponse>(`/payments/${encodeURIComponent(orderId)}/capture`, { method: 'POST', token, body: {} });
  },
  deleteFaceTemplate(token: string) { return request<{ ok: true }>('/profile/face-template', { method: 'DELETE', token }); },
  deleteAccount(token: string) { return request<{ ok: true }>('/account', { method: 'DELETE', token }); },
};

export type PaymentIntentResponse = { id: string; approvalUrl: string; status: 'PAYER_ACTION_REQUIRED' | 'APPROVAL_REQUIRED' | 'COMPLETED' | 'PENDING' };
export type CapturedPaymentResponse = { id: string; status: 'COMPLETED' | 'PENDING'; captureId: string | null };
