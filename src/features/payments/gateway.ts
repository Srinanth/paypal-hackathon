import { profileStore } from '../profile/storage';
import { serverApi, type CapturedPaymentResponse, type PaymentIntentResponse } from '../server/api';

export type CreatePaymentRequest = { recipientId: string; matchSessionId: string; amount: string; currency: 'USD'; requestId: string };
export type PaymentIntent = PaymentIntentResponse;
export type CapturedPayment = CapturedPaymentResponse;

/** Server boundary for the PayPal Orders sandbox flow. PayPal credentials stay on the API. */
export interface PaymentGateway {
  createPayment(request: CreatePaymentRequest): Promise<PaymentIntent>;
  capturePayment(paymentId: string): Promise<CapturedPayment>;
}

async function tokenOrThrow(): Promise<string> {
  const profile = await profileStore.load();
  if (!profile?.accessToken) throw new Error('Sign in again before making a payment.');
  return profile.accessToken;
}

export const paypalGateway: PaymentGateway = {
  async createPayment(input) { return serverApi.createPayment(await tokenOrThrow(), input); },
  async capturePayment(orderId) { return serverApi.capturePayment(await tokenOrThrow(), orderId); },
};
