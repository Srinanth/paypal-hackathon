import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraView as CameraViewType } from 'expo-camera';
import { File } from 'expo-file-system';
import { useFaceDetection } from '@infinitered/react-native-mlkit-face-detection';
import { useRouter } from 'expo-router';
import { Button, Card, Eyebrow, Heading, Screen } from '../components/ui';
import { embedPhoto } from '../features/face/engine';
import { averageEmbeddings } from '../features/face/matching';
import { FACE_MODEL_VERSION, FACE_PREPROCESSING_VERSION } from '../features/profile/model';
import { profileStore } from '../features/profile/storage';
import { serverApi } from '../features/server/api';
import type { UserProfile } from '../features/profile/model';
import { theme } from '../theme';

const sampleGoals = ['Look straight ahead', 'Turn slightly left', 'Turn slightly right'];

export default function EnrollScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraViewType>(null);
  const detector = useFaceDetection();
  const [permission, requestPermission] = useCameraPermissions();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [samples, setSamples] = useState<number[][]>([]);
  const samplesRef = useRef<number[][]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState('Look straight ahead, face the light, and keep the phone at eye level.');

  useEffect(() => { profileStore.load().then(setProfile).catch(() => undefined); }, []);
  useEffect(() => () => {
    samplesRef.current.forEach((sample) => sample.fill(0));
    samplesRef.current = [];
  }, []);

  function updateSamples(nextSamples: number[][]) {
    samplesRef.current = nextSamples;
    setSamples(nextSamples);
  }

  async function capture() {
    if (busy) return;
    if (!profile?.accessToken || !profile.facePayEnabled) { Alert.alert('Set up face discovery first', 'Sign in, save your recipient details, and opt in to face discovery before enrolling.'); router.replace('/profile'); return; }
    if (!cameraReady || !cameraRef.current) {
      setMessage(cameraError ?? 'The camera is still starting. Wait for the preview, then try again.');
      return;
    }
    if (samplesRef.current.length >= sampleGoals.length) return;
    setBusy(true);
    setMessage('Taking photo…');
    let photoUri: string | undefined;
    let vector: number[] | undefined;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, shutterSound: false });
      photoUri = photo?.uri;
      if (!photoUri) throw new Error('The camera did not return a photo.');
      vector = await embedPhoto(detector, photoUri, setMessage);
      const nextSamples = [...samplesRef.current, vector];
      updateSamples(nextSamples);
      vector = undefined;
      if (nextSamples.length < sampleGoals.length) {
        setMessage(`Sample ${nextSamples.length} captured. ${sampleGoals[nextSamples.length]} and capture again. The photo was deleted.`);
      } else {
        setMessage('All three samples are ready. Tap “Save encrypted face profile” to finish. The photos were deleted.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not process this sample. Try again.'); }
    finally {
      vector?.fill(0);
      if (photoUri) { try { new File(photoUri).delete(); } catch { /* cache cleanup is best effort */ } }
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (busy) return;
    if (!profile?.accessToken || !profile.facePayEnabled) {
      Alert.alert('Set up face discovery first', 'Sign in, save your recipient details, and opt in to face discovery before enrolling.');
      router.replace('/profile');
      return;
    }
    const capturedSamples = samplesRef.current;
    if (capturedSamples.length !== sampleGoals.length) {
      setMessage('Capture all three samples before saving your face profile.');
      return;
    }
    setBusy(true);
    setMessage('Saving your encrypted face profile…');
    let embedding: number[] | undefined;
    try {
      embedding = averageEmbeddings(capturedSamples);
      await serverApi.uploadFaceTemplate(profile.accessToken, { ...profile, modelVersion: FACE_MODEL_VERSION, preprocessingVersion: FACE_PREPROCESSING_VERSION }, embedding);
      const nextProfile: UserProfile = { ...profile, faceEnrolled: true, enrolledAt: Date.now(),
        modelVersion: FACE_MODEL_VERSION, preprocessingVersion: FACE_PREPROCESSING_VERSION };
      await profileStore.save(nextProfile);
      capturedSamples.forEach((sample) => sample.fill(0));
      updateSamples([]);
      setProfile(nextProfile);
      Alert.alert('Face profile saved', 'Your encrypted face template is ready for server matching. The camera photos were discarded.', [{ text: 'Continue', onPress: () => router.replace('/') }]);
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Your three samples are still available; retry saving when you’re connected.` : 'Could not save the face profile. Your samples are still available; try again.');
    } finally {
      embedding?.fill(0);
      setBusy(false);
    }
  }

  function discardSamples() {
    samplesRef.current.forEach((sample) => sample.fill(0));
    updateSamples([]);
    setMessage('Look straight ahead, face the light, and keep the phone at eye level.');
  }

  function cancelEnrollment() {
    discardSamples();
    router.back();
  }

  if (!permission) return <Screen><Text style={styles.copy}>Checking camera permission…</Text></Screen>;
  if (!permission.granted) return <Screen><Eyebrow>CAMERA ACCESS</Eyebrow><Heading title="Enroll on this phone" subtitle="Camera images are processed locally and deleted after each sample." /><Button label="Allow camera" onPress={requestPermission} /><Button label="Back" secondary onPress={() => router.back()} /></Screen>;

  return <Screen>
    <Eyebrow>OPTED-IN ENROLLMENT</Eyebrow>
    <Heading title="Enroll your face" subtitle="Capture three face samples, then save your encrypted template. Photos are deleted after processing; temporary face vectors stay in memory only until you finish or leave." />
    <View style={styles.cameraFrame}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mirror
        onCameraReady={() => { setCameraReady(true); setCameraError(null); }}
        onMountError={(event) => { setCameraReady(false); setCameraError(event.message); setMessage('The camera could not start. Close other camera apps and try again.'); }} />
      <View pointerEvents="none" style={styles.faceGuide} />
      <View style={styles.cameraLabel}><Text style={styles.cameraLabelText}>{cameraError ? 'CAMERA UNAVAILABLE' : cameraReady ? 'CAMERA READY · PHOTOS NOT KEPT' : 'STARTING CAMERA…'}</Text></View>
    </View>
    <Card style={styles.statusCard}><Text style={styles.pose}>{samples.length === 3 ? '3 OF 3 SAMPLES READY' : `SAMPLE ${samples.length + 1} OF 3`}</Text><Text style={styles.message}>{message}</Text></Card>
    <Button label={busy ? 'Processing on device…' : samples.length === 3 ? 'Save encrypted face profile' : cameraError ? 'Camera unavailable' : cameraReady ? `Capture sample ${samples.length + 1}` : 'Starting camera…'} onPress={samples.length === 3 ? saveTemplate : capture} disabled={busy || (samples.length < 3 && (!cameraReady || Boolean(cameraError)))} />
    {samples.length > 0 ? <Button label="Discard samples and start over" secondary onPress={discardSamples} disabled={busy} /> : null}
    <Button label="Cancel" secondary onPress={cancelEnrollment} disabled={busy} />
    <Text style={styles.disclaimer}>This is a demo identity matcher, not production-grade liveness or payment authorization. A photo may spoof weak face checks.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  cameraFrame: { height: 370, borderRadius: 26, overflow: 'hidden', backgroundColor: '#172019', position: 'relative', borderWidth: 1, borderColor: theme.colors.line },
  faceGuide: { position: 'absolute', top: '13%', alignSelf: 'center', width: 214, height: 270, borderRadius: 110, borderWidth: 1.5, borderColor: 'rgba(199,243,107,0.78)' },
  cameraLabel: { position: 'absolute', bottom: 14, alignSelf: 'center', borderRadius: 20, backgroundColor: 'rgba(8,12,9,0.76)', paddingHorizontal: 12, paddingVertical: 7 },
  cameraLabelText: { color: theme.colors.accent, fontSize: 10, letterSpacing: 1, fontWeight: '800' },
  statusCard: { paddingVertical: 14, gap: 5 }, pose: { color: theme.colors.accent, fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, message: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  copy: { color: theme.colors.muted }, disclaimer: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, paddingHorizontal: 6 },
});
