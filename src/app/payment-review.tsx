import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { Button, Card, Eyebrow, Field, Heading, Screen, Row, StatusDot } from '../components/ui';
import { matchSession } from '../features/matching/session';
import { paypalGateway } from '../features/payments/gateway';
import { theme } from '../theme';

export default function PaymentReviewScreen() {
  const router = useRouter();
  const { recipientId, similarity } = useLocalSearchParams<{ recipientId: string; similarity?: string }>();
  const recipient = useMemo(() => matchSession.get(recipientId ?? ''), [recipientId]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<Awaited<ReturnType<typeof paypalGateway.createPayment>> | null>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => () => matchSession.clear(), []);

  async function confirm() {
    if (!recipient || recipient.expiresAt <= Date.now()) {
      matchSession.clear();
      Alert.alert('Match expired', 'Scan the recipient again to start a fresh session.');
      router.replace('/scan');
      return;
    }
    if (!intent && (!/^\d{1,5}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
      Alert.alert('Enter a valid amount', 'Use a positive USD amount with up to two decimal places.');
      return;
    }
    setBusy(true);
    try {
      let nextIntent = intent;
      if (!nextIntent) {
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const hardware = await LocalAuthentication.hasHardwareAsync();
        if (enrolled && hardware) {
          const auth = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm this payment', cancelLabel: 'Cancel' });
          if (!auth.success) return;
        }
        requestId.current ??= Crypto.randomUUID();
        nextIntent = await paypalGateway.createPayment({ recipientId: recipient.id, matchSessionId: recipient.matchSessionId, amount, currency: 'USD', requestId: requestId.current });
        requestId.current = null;
        setIntent(nextIntent);
      }
      const approval = new URL(nextIntent.approvalUrl);
      if (approval.protocol !== 'https:' || !(approval.hostname === 'paypal.com' || approval.hostname.endsWith('.paypal.com'))) throw new Error('The server returned an invalid PayPal approval link.');
      await Linking.openURL(nextIntent.approvalUrl);
    } catch (error) {
      Alert.alert('Could not open PayPal', error instanceof Error ? error.message : 'The PayPal service could not start this payment.');
    } finally { setBusy(false); }
  }

  async function checkApproval() {
    if (!intent) return;
    setBusy(true);
    try {
      const result = await paypalGateway.capturePayment(intent.id);
      if (result.status === 'COMPLETED') {
        Alert.alert('Payment complete', 'PayPal confirmed the payment to the recipient.');
        matchSession.clear();
        router.replace('/');
      } else Alert.alert('Payment pending', 'PayPal accepted the capture request, but it is not complete yet. Check again shortly.');
    } catch (error) {
      Alert.alert('Could not verify payment', error instanceof Error ? error.message : 'PayPal could not verify this payment.');
    } finally { setBusy(false); }
  }

  if (!recipient) return <Screen>
    <Eyebrow>MATCH EXPIRED</Eyebrow>
    <Heading title="Scan the recipient again" subtitle="A face match is kept briefly in memory, then discarded." />
    <Button label="Scan again" onPress={() => router.replace('/scan')} />
    <Button label="Home" secondary onPress={() => router.replace('/')} />
  </Screen>;

  return <Screen>
    <Eyebrow>FINAL REVIEW</Eyebrow>
    <Heading title="Check the person and amount" subtitle="Face matching only selects a possible recipient. Review their identity and the amount before continuing." />
    <Card style={styles.recipient}>
      <Row><StatusDot /><Text style={styles.verified}>SERVER FACE MATCH · {similarity ?? '—'}</Text></Row>
      <Text style={styles.name}>{recipient.displayName}</Text>
      <Text style={styles.email}>{recipient.maskedPayPalRecipient}</Text>
      <Text style={styles.expiry}>This match expires shortly. Scan again if it expires before confirmation.</Text>
    </Card>
    <Card>
      <Field label="Amount (USD)" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" maxLength={8} editable={!busy && !intent} />
      <Text style={styles.hint}>{intent ? 'This order is waiting for your PayPal approval. Return here to check it if the app does not reopen automatically.' : 'Review the matched name and amount. PayPal will show its own approval screen before the server captures funds.'}</Text>
      <Button label={busy ? 'Opening secure checkout…' : intent ? 'Open PayPal approval' : 'Confirm recipient and amount'} onPress={confirm} disabled={busy} />
      {intent ? <Button label={busy ? 'Checking PayPal…' : 'I approved — check payment'} onPress={checkApproval} disabled={busy} secondary /> : null}
    </Card>
    <Button label="Cancel payment" secondary onPress={() => { matchSession.clear(); router.replace('/'); }} />
  </Screen>;
}

const styles = StyleSheet.create({
  recipient: { backgroundColor: '#16221A', padding: 22 }, verified: { color: theme.colors.mint, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  name: { color: theme.colors.text, fontSize: 26, fontWeight: '800' }, email: { color: theme.colors.accent, fontSize: 14, fontWeight: '600' },
  expiry: { color: theme.colors.muted, fontSize: 12 }, hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
});
