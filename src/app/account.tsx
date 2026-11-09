import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Field, Screen } from '../components/ui';
import { PasswordField } from '../components/PasswordField';
import { ApiError, serverApi } from '../features/server/api';
import { profileStore } from '../features/profile/storage';
import type { UserProfile } from '../features/profile/model';
import { theme } from '../theme';

export default function AccountScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const creating = mode === 'create';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInputRef = useRef<TextInputInstance>(null);

  async function submit() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password || (creating && password.length < 12)) {
      setError(creating ? 'Use a password with at least 12 characters.' : 'Enter your password.');
      return;
    }
    if (password.length > 128) {
      setError('Use a password with 128 characters or fewer.');
      return;
    }
    setBusy(true);
    try {
      const auth = await (creating ? serverApi.register(email.trim(), password) : serverApi.login(email.trim(), password));
      const remote = creating ? {
        userId: auth.userId, email: email.trim(), displayName: '', paypalRecipient: '', facePayEnabled: false, faceEnrolled: false,
      } : await serverApi.getProfile(auth.accessToken);
      const profile: UserProfile = {
        userId: auth.userId, email: remote.email, accessToken: auth.accessToken,
        displayName: remote.displayName, paypalRecipient: remote.paypalRecipient,
        facePayEnabled: remote.facePayEnabled, faceEnrolled: remote.faceEnrolled,
        enrolledAt: remote.faceEnrolled ? Date.now() : 0,
        modelVersion: '', preprocessingVersion: '',
      };
      setPassword('');
      await profileStore.save(profile);
      router.replace(creating ? '/profile' : '/');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') setPassword('');
      setError(error instanceof Error ? error.message : creating ? 'Could not create your account. Try again.' : 'Could not sign in. Try again.');
    } finally { setBusy(false); }
  }

  return <Screen>
    <View style={styles.brandRow}>
      <View style={styles.brandMark}><Text style={styles.brandGlyph}>N</Text></View>
      <Text style={styles.brandName}>NearPay</Text>
    </View>
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>{creating ? 'GET STARTED' : 'YOUR ACCOUNT'}</Text>
      <Text style={styles.title}>{creating ? 'Create your account' : 'Welcome back'}</Text>
      <Text style={styles.subtitle}>{creating ? 'Use your email and a password to get started. You can set up face payments later.' : 'Sign in to continue to NearPay.'}</Text>
    </View>
    <Card style={styles.form}>
      <Field
        label="Email address"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordInputRef.current?.focus()}
        placeholder="name@example.com"
        maxLength={254}
        editable={!busy}
        accessibilityLabel="Email address"
        testID="account-email"
      />
      <PasswordField
        ref={passwordInputRef}
        label={creating ? 'Create password' : 'Password'}
        value={password}
        onChangeText={setPassword}
        autoComplete={creating ? 'new-password' : 'current-password'}
        onSubmitEditing={submit}
        hint={creating ? 'Use at least 12 characters.' : undefined}
      />
      {error ? <View style={styles.errorBox} accessibilityRole="alert"><Text style={styles.errorText}>{error}</Text></View> : null}
      <Button label={busy ? creating ? 'Creating account…' : 'Signing in…' : creating ? 'Create account' : 'Sign in'} onPress={submit} disabled={busy} />
      <View style={styles.switchRow}>
        <Text style={styles.switchPrompt}>{creating ? 'Already have an account?' : 'New to NearPay?'}</Text>
        <Pressable
          onPress={() => { setPassword(''); setError(null); router.setParams({ mode: creating ? 'login' : 'create' }); }}
          disabled={busy}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.switchLink}>{creating ? 'Sign in' : 'Create account'}</Text>
        </Pressable>
      </View>
    </Card>
    <Text style={styles.privacy}>Your face is never scanned during sign-in. Face matching is set up separately and requires your consent.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 2 },
  brandMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  brandGlyph: { color: theme.colors.accentInk, fontSize: 21, fontWeight: '900' },
  brandName: { color: theme.colors.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.1 },
  intro: { gap: 8, marginTop: 8 },
  eyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: theme.colors.text, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: theme.colors.muted, fontSize: 15, lineHeight: 22 },
  form: { padding: 20, gap: 18 },
  errorBox: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#633A35', backgroundColor: '#271A18' },
  errorText: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  switchPrompt: { color: theme.colors.muted, fontSize: 13 },
  switchLink: { color: theme.colors.accent, fontSize: 13, fontWeight: '800' },
  privacy: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 6 },
});
