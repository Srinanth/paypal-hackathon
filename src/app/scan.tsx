import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraView as CameraViewType } from 'expo-camera';
import { File } from 'expo-file-system';
import { useFaceDetection } from '@infinitered/react-native-mlkit-face-detection';
import { useRouter } from 'expo-router';
import { Button, Card, Eyebrow, Heading, Screen } from '../components/ui';
import { embedPhoto } from '../features/face/engine';
import { matchSession } from '../features/matching/session';
import { profileStore } from '../features/profile/storage';
import { serverApi } from '../features/server/api';
import type { UserProfile } from '../features/profile/model';
import { theme } from '../theme';

export default function ScanScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraViewType>(null);
  const detector = useFaceDetection();
  const [permission, requestCameraPermission] = useCameraPermissions();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Check your connection, then scan the recipient’s face. They do not need to open the app or be online.');

  useEffect(() => { profileStore.load().then(setProfile).catch(() => undefined); }, []);

  async function identify() {
    if (busy) return;
    if (!profile?.accessToken) { Alert.alert('Sign in required', 'Sign in to find an enrolled recipient.'); router.replace('/account'); return; }
    if (!permission?.granted || !cameraRef.current) return;
    setBusy(true);
    let photoUri: string | undefined;
    let vector: number[] | undefined;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.82, shutterSound: false });
      photoUri = photo?.uri;
      if (!photoUri) throw new Error('Could not capture the face. Try again.');
      vector = await embedPhoto(detector, photoUri);
      const recipient = await serverApi.matchFace(profile.accessToken, vector);
      vector.fill(0); vector = undefined;
      matchSession.set(recipient);
      setMessage(`Matched ${recipient.displayName}. Review the recipient and amount.`);
      router.push({ pathname: '/payment-review', params: { recipientId: recipient.id, similarity: recipient.similarity.toFixed(3) } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Face matching failed. Check your connection and try again.');
    } finally {
      vector?.fill(0);
      if (photoUri) { try { new File(photoUri).delete(); } catch { /* Remove temporary camera capture where possible. */ } }
      setBusy(false);
    }
  }

  if (!permission) return <Screen><Eyebrow>CAMERA ACCESS</Eyebrow><Heading title="Preparing the camera" subtitle="Checking this phone’s camera permission." /><Card><Text style={styles.message}>This takes a moment.</Text></Card><Button label="Cancel" secondary onPress={() => router.back()} /></Screen>;
  if (!permission.granted) return <Screen>
    <Eyebrow>CAMERA ACCESS</Eyebrow>
    <Heading title="Scan with your camera" subtitle="NearPay uses the camera to find a face for recipient matching. The recipient can remain offline." />
    <Card><Text style={styles.message}>{permission.canAskAgain ? 'Allow camera access to scan the person you want to pay.' : 'Camera access is turned off for NearPay. Enable it in your phone’s app settings, then return here.'}</Text></Card>
    {permission.canAskAgain ? <Button label="Allow camera" onPress={async () => {
      const result = await requestCameraPermission();
      if (!result.granted) Alert.alert('Camera permission needed', 'Allow camera access to scan the person you want to pay.');
    }} /> : null}
    <Button label="Cancel" secondary onPress={() => router.back()} />
  </Screen>;

  return <Screen>
    <Eyebrow>FACE DISCOVERY</Eyebrow>
    <Heading title="Scan the person you want to pay" subtitle="NearPay matches a temporary face vector with opted-in recipients. They do not need to open the app or be online." />
    <View style={styles.cameraFrame}>
      {permission?.granted ? <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" /> : <View style={styles.cameraPlaceholder}><Text style={styles.cameraPlaceholderText}>CAMERA PREVIEW</Text></View>}
      <View pointerEvents="none" style={styles.faceGuide} />
      <View style={styles.cameraLabel}><Text style={styles.cameraLabelText}>MATCH OVER SECURE CONNECTION</Text></View>
    </View>
    <Card style={styles.info}><Text style={styles.status}>{busy ? 'MATCHING' : 'READY'}</Text><Text style={styles.message}>{message}</Text></Card>
    <Button label={busy ? 'Finding a match…' : 'Scan face'} onPress={identify} disabled={busy} />
    <Button label="Cancel" secondary onPress={() => { matchSession.clear(); router.back(); }} />
    <Text style={styles.note}>A match only selects a recipient. Check their name and masked PayPal reference, enter the amount, and confirm deliberately. Face matching is not liveness proof or payment authorization.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  cameraFrame: { height: 390, borderRadius: 26, overflow: 'hidden', backgroundColor: '#172019', position: 'relative', borderWidth: 1, borderColor: theme.colors.line },
  cameraPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' }, cameraPlaceholderText: { color: theme.colors.muted, letterSpacing: 1.2, fontSize: 11, fontWeight: '800' },
  faceGuide: { position: 'absolute', top: '15%', alignSelf: 'center', width: 224, height: 278, borderRadius: 120, borderWidth: 1.5, borderColor: 'rgba(199,243,107,0.78)' },
  cameraLabel: { position: 'absolute', bottom: 14, alignSelf: 'center', borderRadius: 20, backgroundColor: 'rgba(8,12,9,0.76)', paddingHorizontal: 12, paddingVertical: 7 },
  cameraLabelText: { color: theme.colors.accent, fontSize: 10, letterSpacing: 1, fontWeight: '800' },
  info: { paddingVertical: 14, gap: 5 }, status: { color: theme.colors.accent, fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, message: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  note: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, paddingHorizontal: 6 },
});
