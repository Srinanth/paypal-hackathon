import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Eyebrow, Heading, Screen } from '../components/ui';
import { paypalGateway } from '../features/payments/gateway';
import { theme } from '../theme';

export default function PaymentReturnScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const orderId = typeof token === 'string' ? token : '';
  const started = useRef(false);
  const [state, setState] = useState<'checking' | 'complete' | 'pending' | 'error'>('checking');
  const [message, setMessage] = useState('Verifying the approved order with PayPal.');

  useEffect(() => {
    if (started.current || !orderId) return;
    started.current = true;
    paypalGateway.capturePayment(orderId).then((payment) => {
      setState(payment.status === 'COMPLETED' ? 'complete' : 'pending');
      setMessage(payment.status === 'COMPLETED'
        ? 'PayPal confirmed the payment to the recipient.'
        : 'PayPal accepted the capture request, but it is still pending.');
    }).catch((error: unknown) => {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'PayPal could not verify this order.');
    });
  }, [orderId]);

  const effectiveState = orderId ? state : 'error';
  const title = effectiveState === 'checking' ? 'Checking payment' : effectiveState === 'complete' ? 'Payment complete' : effectiveState === 'pending' ? 'Payment pending' : 'Could not verify payment';
  const effectiveMessage = orderId ? message : 'PayPal did not return an order reference. Open NearPay and check the payment from the review screen.';
  return <Screen>
    <Eyebrow>PAYPAL CHECKOUT</Eyebrow>
    <Heading title={title} subtitle="NearPay asks PayPal to verify the order before showing a final status." />
    <Card style={styles.card}><Text style={styles.message}>{effectiveMessage}</Text></Card>
    <Button label="Back to NearPay" onPress={() => router.replace('/')} disabled={effectiveState === 'checking'} />
  </Screen>;
}

const styles = StyleSheet.create({ card: { backgroundColor: '#16221A', padding: 22 }, message: { color: theme.colors.text, fontSize: 15, lineHeight: 22 } });
