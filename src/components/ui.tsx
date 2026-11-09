import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const body = <View style={styles.body}>{children}</View>;
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    {scroll ? <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{body}</ScrollView> : body}
  </SafeAreaView>;
}

export function Eyebrow({ children }: PropsWithChildren) { return <Text style={styles.eyebrow}>{children}</Text>; }

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.heading}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) { return <View style={[styles.card, style]}>{children}</View>; }

export function Button({ label, onPress, disabled = false, secondary = false, compact = false }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, compact && styles.buttonCompact, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}>
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary, compact && styles.buttonTextCompact]}>{label}</Text>
  </Pressable>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text>
    <TextInput placeholderTextColor={theme.colors.muted} selectionColor={theme.colors.accent}
      style={styles.field} autoCapitalize="none" {...props} />
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}</View>;
}

export function StatusDot({ color = theme.colors.mint }: { color?: string }) { return <View style={[styles.dot, { backgroundColor: color }]} />; }
export function Row({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <View style={styles.row}><View style={styles.rowContent}>{children}</View>{right}</View>;
}
export function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background }, scroll: { flexGrow: 1 },
  body: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 36, gap: 18 },
  eyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase' },
  heading: { gap: 7 }, title: { color: theme.colors.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { color: theme.colors.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderWidth: 1, borderRadius: theme.radius.card, padding: 18, gap: 12 },
  button: { minHeight: 54, paddingHorizontal: 20, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, justifyContent: 'center', alignItems: 'center' },
  buttonSecondary: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.line, borderWidth: 1 }, buttonCompact: { minHeight: 42, paddingHorizontal: 16 },
  buttonDisabled: { opacity: 0.45 }, buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  buttonText: { color: theme.colors.accentInk, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 }, buttonTextSecondary: { color: theme.colors.text }, buttonTextCompact: { fontSize: 13 },
  fieldWrap: { gap: 8 }, fieldLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  field: { minHeight: 52, borderRadius: theme.radius.input, paddingHorizontal: 15, backgroundColor: theme.colors.surfaceRaised, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.line, fontSize: 15 },
  hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 }, dot: { width: 9, height: 9, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, rowContent: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.line },
});
