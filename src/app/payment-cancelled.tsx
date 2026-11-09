import { useRouter } from 'expo-router';
import { Button, Card, Eyebrow, Heading, Screen } from '../components/ui';

export default function PaymentCancelledScreen() {
  const router = useRouter();
  return <Screen>
    <Eyebrow>PAYPAL CHECKOUT</Eyebrow>
    <Heading title="Payment not approved" subtitle="PayPal returned without approval. No capture was requested." />
    <Card><Button label="Back to NearPay" onPress={() => router.replace('/')} /></Card>
  </Screen>;
}
