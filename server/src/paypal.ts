type PayPalLink = { rel?: string; href?: string };
type PayPalAmount = { currency_code?: string; value?: string };
type PayPalCapture = { id?: string; status?: string };
type PayPalPurchaseUnit = {
  payee?: { email_address?: string };
  amount?: PayPalAmount;
  payments?: { captures?: PayPalCapture[] };
};
type PayPalOrder = {
  id?: string;
  intent?: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: PayPalPurchaseUnit[];
};

const REQUEST_TIMEOUT_MS = 12_000;
let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

export class PayPalGatewayError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILURE' | 'INVALID_RESPONSE') {
    super(code);
    this.name = 'PayPalGatewayError';
  }
}

function credentials(): { clientId: string; clientSecret: string; apiBase: string; publicOrigin: string } | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const apiBase = process.env.PAYPAL_API_BASE_URL?.trim() || 'https://api-m.sandbox.paypal.com';
  const publicOrigin = process.env.PUBLIC_API_ORIGIN?.trim().replace(/\/$/, '');
  if (!clientId || !clientSecret || !publicOrigin) return null;
  try {
    const api = new URL(apiBase);
    const publicUrl = new URL(publicOrigin);
    const allowedApiHosts = ['api-m.sandbox.paypal.com', 'api-m.paypal.com'];
    if (api.protocol !== 'https:' || !allowedApiHosts.includes(api.hostname) || api.pathname !== '/' || api.search || api.hash) return null;
    const localDevelopmentOrigin = process.env.NODE_ENV !== 'production' && publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname);
    if ((!localDevelopmentOrigin && publicUrl.protocol !== 'https:') || !publicUrl.hostname || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) return null;
  } catch { return null; }
  return { clientId, clientSecret, apiBase, publicOrigin };
}

export function isPayPalConfigured(): boolean {
  return credentials() !== null;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal });
    const payload = await response.json().catch(() => null) as T | null;
    if (!response.ok || payload === null) throw new PayPalGatewayError('UPSTREAM_FAILURE');
    return payload;
  } catch (error) {
    if (error instanceof PayPalGatewayError) throw error;
    throw new PayPalGatewayError('UPSTREAM_FAILURE');
  } finally { clearTimeout(timeout); }
}

async function getAccessToken(): Promise<{ token: string; config: NonNullable<ReturnType<typeof credentials>> }> {
  const config = credentials();
  if (!config) throw new PayPalGatewayError('NOT_CONFIGURED');
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return { token: accessToken, config };
  const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetchJson<{ access_token?: string; expires_in?: number }>(`${config.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  if (!response.access_token || !Number.isFinite(response.expires_in)) throw new PayPalGatewayError('INVALID_RESPONSE');
  accessToken = response.access_token;
  accessTokenExpiresAt = Date.now() + response.expires_in! * 1000;
  return { token: accessToken, config };
}

async function paypalRequest<T>(path: string, init: RequestInit, requestId?: string): Promise<T> {
  const { token, config } = await getAccessToken();
  const attribution = process.env.PAYPAL_PARTNER_ATTRIBUTION_ID?.trim();
  return fetchJson<T>(`${config.apiBase}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      ...(attribution ? { 'PayPal-Partner-Attribution-Id': attribution } : {}),
      ...init.headers,
    },
  });
}

export async function createSellerOrder(input: {
  requestId: string;
  amount: string;
  currency: 'USD';
  recipientEmail: string;
}): Promise<{ id: string; approvalUrl: string }> {
  const config = credentials();
  if (!config) throw new PayPalGatewayError('NOT_CONFIGURED');
  const order = await paypalRequest<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: input.requestId,
        payee: { email_address: input.recipientEmail },
        amount: { currency_code: input.currency, value: input.amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'NearPay',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${config.publicOrigin}/paypal/return`,
            cancel_url: `${config.publicOrigin}/paypal/cancel`,
          },
        },
      },
    }),
  }, input.requestId);
  const approvalUrl = order.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href;
  if (!order.id || !approvalUrl) throw new PayPalGatewayError('INVALID_RESPONSE');
  let approvalHost: string;
  try { approvalHost = new URL(approvalUrl).hostname; } catch { throw new PayPalGatewayError('INVALID_RESPONSE'); }
  if (!(approvalHost === 'paypal.com' || approvalHost.endsWith('.paypal.com')) || !approvalUrl.startsWith('https://')) throw new PayPalGatewayError('INVALID_RESPONSE');
  return { id: order.id, approvalUrl };
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
}

export async function captureOrder(orderId: string, requestId: string): Promise<{ status: 'COMPLETED' | 'PENDING'; captureId: string | null }> {
  const result = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: '{}' }, requestId);
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
  if (result.status !== 'COMPLETED' && result.status !== 'PENDING' && capture?.status !== 'COMPLETED' && capture?.status !== 'PENDING') {
    throw new PayPalGatewayError('UPSTREAM_FAILURE');
  }
  return {
    status: result.status === 'COMPLETED' || capture?.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
    captureId: capture?.id ?? null,
  };
}
