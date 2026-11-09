import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { Button, Card, Eyebrow, Heading, Row, Screen, StatusDot } from '../components/ui';
import { profileStore } from '../features/profile/storage';
import type { UserProfile } from '../features/profile/model';
import { serverApi, type RecentPayment } from '../features/server/api';
import { theme } from '../theme';

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [activityState, setActivityState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useFocusEffect(useCallback(() => {
    let active = true;
    async function loadHome() {
      try {
        const currentProfile = await profileStore.load();
        if (!active) return;
        setProfile(currentProfile);
        setProfileLoaded(true);
        if (!currentProfile?.accessToken) {
          setRecentPayments([]);
          setActivityState('ready');
          return;
        }
        setActivityState('loading');
        const activity = await serverApi.getRecentPayments(currentProfile.accessToken);
        if (active) {
          setRecentPayments(activity.payments);
          setActivityState('ready');
        }
      } catch {
        if (active) {
          setActivityState('unavailable');
          setProfileLoaded(true);
        }
      }
    }
    void loadHome();
    return () => { active = false; };
  }, []));

  return <Screen>
    <Row><Eyebrow>NEARPAY / FACE DISCOVERY</Eyebrow><View style={styles.live}><StatusDot /><Text style={styles.liveText}>SERVER MATCH</Text></View></Row>
    <Heading title={profile ? `Hello, ${profile.displayName}` : 'Pay by recognizing.'}
      subtitle={profile ? 'Find an enrolled recipient, confirm the details, and approve with PayPal.' : 'A face-first way to find a recipient. Enroll once; they do not need to be online when you scan.'} />

    <Card style={styles.hero}>
      <View style={styles.ring}><Text style={styles.scanGlyph}>◎</Text></View>
      <Text style={styles.heroTitle}>Scan a face. Review. Pay.</Text>
      <Text style={styles.heroCopy}>Opted-in recipients are matched securely by the server, even when their phone is offline. The payer confirms the person and amount.</Text>
      <Button label={!profileLoaded ? 'Loading your profile…' : profile?.accessToken ? 'Scan a face' : 'Create account'} disabled={!profileLoaded} onPress={() => router.push(profile?.accessToken ? '/scan' : { pathname: '/account', params: { mode: 'create' } })} />
    </Card>

    <View style={styles.sectionRow}><Text style={styles.sectionTitle}>IN PERSON</Text><Text style={styles.sectionHint}>Recipient can be offline</Text></View>
    <View style={styles.actions}>
      <Card style={styles.actionCard}>
        <Text style={styles.actionIcon}>↗</Text><Text style={styles.actionTitle}>Send</Text>
        <Text style={styles.actionCopy}>Scan an enrolled person and review the amount before confirming.</Text>
        <Button label="Find a person" compact secondary={!profile?.accessToken} disabled={!profileLoaded || !profile?.accessToken} onPress={() => router.push('/scan')} />
      </Card>
    </View>

    <View style={styles.activityHeader}><Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>{profile ? <Text style={styles.sectionHint}>Latest 5</Text> : null}</View>
    <Card style={styles.activityCard}>
      {activityState === 'loading' ? <Text style={styles.activityEmpty}>Loading your payment activity…</Text>
        : activityState === 'unavailable' ? <Text style={styles.activityEmpty}>Activity is unavailable right now. Check your connection and return to refresh.</Text>
          : recentPayments.length === 0 ? <Text style={styles.activityEmpty}>{profile ? 'Completed payments will appear here.' : 'Sign in to see your payment activity.'}</Text>
            : recentPayments.map((payment, index) => <View key={`${payment.createdAt}-${index}`} style={styles.paymentRow}>
              <View style={styles.paymentInfo}>
                <Text numberOfLines={1} style={styles.recipientName}>{payment.recipientName}</Text>
                <Text style={styles.paymentMeta}>{new Date(payment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {payment.status === 'COMPLETED' ? 'Completed' : 'Pending'}</Text>
              </View>
              <Text style={styles.paymentAmount}>${Number(payment.amount).toFixed(2)}</Text>
            </View>)}
    </Card>

    <Button label={!profileLoaded ? 'Loading your profile…' : profile ? 'Profile & privacy' : 'Create profile'} secondary disabled={!profileLoaded} onPress={() => router.push(profile?.accessToken ? '/profile' : { pathname: '/account', params: { mode: 'create' } })} />
  </Screen>;
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', gap: 7, alignItems: 'center' }, liveText: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1.1, fontWeight: '800' },
  hero: { marginTop: 2, backgroundColor: '#16221A', padding: 22 }, ring: { width: 58, height: 58, borderRadius: 30, borderWidth: 1, borderColor: '#68854A', justifyContent: 'center', alignItems: 'center', backgroundColor: '#20301A' },
  scanGlyph: { fontSize: 34, color: theme.colors.accent, lineHeight: 40 }, heroTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '700' }, heroCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: theme.colors.text, fontSize: 11, letterSpacing: 1.4, fontWeight: '800' }, sectionHint: { color: theme.colors.muted, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 12 }, actionCard: { flex: 1, padding: 15 }, actionIcon: { color: theme.colors.accent, fontSize: 22, fontWeight: '700' }, actionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' }, actionCopy: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, minHeight: 54 },
  activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, activityCard: { gap: 14, paddingVertical: 16 }, activityEmpty: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, paymentInfo: { flex: 1, gap: 4 }, recipientName: { color: theme.colors.text, fontSize: 14, fontWeight: '700' }, paymentMeta: { color: theme.colors.muted, fontSize: 11 }, paymentAmount: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
});
