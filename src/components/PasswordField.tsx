import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { theme } from '../theme';

type PasswordFieldProps = Pick<TextInputProps, 'onSubmitEditing' | 'returnKeyType'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
};

export const PasswordField = forwardRef<TextInputInstance, PasswordFieldProps>(function PasswordField({ label, value, onChangeText, autoComplete, onSubmitEditing, returnKeyType = 'go', hint }, ref) {
  const [visible, setVisible] = useState(false);
  return <View style={styles.group}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputRow}>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder="Enter your password"
        placeholderTextColor={theme.colors.muted}
        selectionColor={theme.colors.accent}
        style={styles.input}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        testID="account-password"
      />
      <Pressable
        onPress={() => setVisible((current) => !current)}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityState={{ selected: visible }}
        hitSlop={8}
      >
        <Text style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
});

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  inputRow: { minHeight: 56, borderRadius: theme.radius.input, paddingLeft: 15, paddingRight: 12, backgroundColor: theme.colors.surfaceRaised, borderWidth: 1, borderColor: theme.colors.line, flexDirection: 'row', alignItems: 'center' },
  input: { minHeight: 54, flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: 12 },
  toggle: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  toggleText: { color: theme.colors.accent, fontSize: 13, fontWeight: '700' },
  hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
});
