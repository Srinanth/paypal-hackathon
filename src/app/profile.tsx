import { useCallback, useState } from 'react';
import { Alert, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button, Card, Eyebrow, Field, Heading, Screen } from '../components/ui';
import { profileStore } from '../features/profile/storage';
import type { UserProfile } from '../features/profile/model';
import { serverApi } from '../features/server/api';
import { theme } from '../theme';

export default function ProfileScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [paypalRecipient, setPaypalRecipient] = useState('');
  const [facePayEnabled, setFacePayEnabled] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    profileStore.load().then(async (value) => {
      if (!active) return;
      setProfile(value);
      if (value) {
        if (!value.accessToken) { router.replace('/account'); return; }
        setDisplayName(value.displayName);
        setPaypalRecipient(value.paypalRecipient);
        setFacePayEnabled(value.facePayEnabled);
        try {
          const remote = await serverApi.getProfile(value.accessToken);
          if (!active) return;
          const synced = { ...value, ...remote };
          setProfile(synced); setDisplayName(remote.displayName); setPaypalRecipient(remote.paypalRecipient); setFacePayEnabled(remote.facePayEnabled);
          void profileStore.save(synced);
        } catch { /* Keep the local profile editable if the server is temporarily offline. */ }
      } else router.replace('/account');
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]));

  async function save() {
    if (!displayName.trim()) return Alert.alert('Add your name', 'Choose the name a payer will see before confirming.');
    if (facePayEnabled && !paypalRecipient.trim()) return Alert.alert('Add a PayPal email', 'A PayPal seller email is needed to receive face payments.');
    if (paypalRecipient.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalRecipient.trim())) return Alert.alert('Check the PayPal email', 'Enter a valid email address, or leave it blank if you only plan to send payments.');
    if (!profile?.accessToken) return router.replace('/account');
    setBusy(true);
    try {
      const optingOut = profile.facePayEnabled && !facePayEnabled;
      if (optingOut) await serverApi.deleteFaceTemplate(profile.accessToken);
      const next: UserProfile = { ...profile, displayName: displayName.trim(), paypalRecipient: paypalRecipient.trim(), facePayEnabled,
        faceEnrolled: optingOut ? false : profile.faceEnrolled, enrolledAt: optingOut ? 0 : profile.enrolledAt,
        modelVersion: optingOut ? '' : profile.modelVersion, preprocessingVersion: optingOut ? '' : profile.preprocessingVersion };
      await serverApi.saveProfile(profile.accessToken, next);
      await profileStore.save(next);
      setProfile(next);
      router.replace('/');
    } catch (error) { Alert.alert('Could not save profile', error instanceof Error ? error.message : 'Try again.'); }
    finally { setBusy(false); }
  }

  function deleteProfile() {
    Alert.alert('Delete your account and face profile?', 'This removes your server account, encrypted face template, recipient reference, and saved sign-in from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete profile', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { if (profile?.accessToken) await serverApi.deleteAccount(profile.accessToken); await profileStore.delete(); setProfile(null); setDisplayName(''); setPaypalRecipient(''); Alert.alert('Account deleted', 'Your NearPay account and face profile were removed.'); }
        catch { Alert.alert('Could not delete profile', 'Try again from this screen.'); }
        finally { setBusy(false); }
      } },
    ]);
  }

  if (loading) return <Screen><Eyebrow>YOUR ACCOUNT & PRIVACY</Eyebrow><Heading title="Loading your profile" subtitle="Getting your current account and face discovery settings." /><Card><Text style={styles.copy}>Just a moment…</Text></Card></Screen>;

  const profileSaved = Boolean(profile?.displayName.trim());

  return <Screen>
    <Eyebrow>YOUR ACCOUNT & PRIVACY</Eyebrow>
    <Heading title={profileSaved ? 'Your profile' : 'Set up your profile'} subtitle={profileSaved
      ? 'Update your account details, PayPal receiving email, and face discovery preferences.'
      : 'Add your name and choose whether to receive face payments. You can change these settings later.'} />
    <Card>
      <Field label="Name shown to the payer" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Sam" maxLength={48} />
      <Field label="PayPal email for receiving (optional)" value={paypalRecipient} onChangeText={setPaypalRecipient} placeholder="seller@example.com" keyboardType="email-address" hint="Only needed if you want to receive face payments. For Sandbox, use the seller account email. It is encrypted on the server." maxLength={128} />
      <Button label={facePayEnabled ? 'Face discovery: ON · tap to opt out' : 'Opt in to face discovery'} secondary onPress={() => setFacePayEnabled(!facePayEnabled)} />
      <Text style={styles.copy}>When enabled, your encrypted face template is compared by the NearPay server when a payer scans. Opting out deletes the stored template; you can enroll again later.</Text>
      <Button label={busy ? 'Saving…' : profileSaved ? 'Save changes' : 'Save profile'} onPress={save} disabled={busy} />
    </Card>
    <Card style={styles.status}>
      <Text style={styles.statusLabel}>FACE PROFILE</Text>
      <Text style={styles.statusTitle}>{profile?.faceEnrolled ? 'Enrolled for face discovery' : 'Not enrolled yet'}</Text>
      <Text style={styles.copy}>The server stores your face vector encrypted at rest and deletes it if you remove enrollment. Camera captures are processed on this phone, then discarded.</Text>
      <Button label={profile?.faceEnrolled ? 'Replace face enrollment' : 'Enroll my face'} secondary disabled={!profile?.facePayEnabled || busy} onPress={() => router.push('/enroll')} />
      {profile?.faceEnrolled ? <Button label="Remove face enrollment" secondary disabled={busy} onPress={async () => {
        if (!profile.accessToken) return;
        setBusy(true); try { await serverApi.deleteFaceTemplate(profile.accessToken); const next = { ...profile, facePayEnabled: false, faceEnrolled: false }; await profileStore.save(next); setProfile(next); setFacePayEnabled(false); Alert.alert('Face enrollment removed', 'Your server-side face template was deleted.'); }
        catch (error) { Alert.alert('Could not remove enrollment', error instanceof Error ? error.message : 'Try again.'); } finally { setBusy(false); }
      }} /> : null}
      {profile ? <Button label="Sign out on this device" secondary disabled={busy} onPress={async () => {
        setBusy(true); try { await profileStore.delete(); setProfile(null); router.replace('/'); }
        catch { Alert.alert('Could not sign out', 'Try again.'); } finally { setBusy(false); }
      }} /> : null}
      {profile ? <Button label="Delete account and data" secondary onPress={deleteProfile} disabled={busy} /> : null}
    </Card>
    <View style={styles.footer}><Text style={styles.footerCopy}>Face matching means biometric data is processed by the NearPay server. TLS protects network traffic and the template is application-encrypted in storage. No design can promise zero risk for centralized biometrics; do not use real payment credentials in this demo.</Text></View>
  </Screen>;
}

const styles = StyleSheet.create({ status: { backgroundColor: theme.colors.surfaceRaised }, statusLabel: { color: theme.colors.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, statusTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700' }, copy: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 }, footer: { paddingHorizontal: 8 }, footerCopy: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 } });
