import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FaceDetectionProvider } from '@infinitered/react-native-mlkit-face-detection';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '../theme';

export default function RootLayout() {
  return <SafeAreaProvider><FaceDetectionProvider options={{ performanceMode: 'accurate', landmarkMode: false, classificationMode: false }}>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: 'fade' }} />
  </FaceDetectionProvider></SafeAreaProvider>;
}
