/**
 * Minimal local RN primitives — NOT a port of @ultm8/ui. That package (packages/ui) is
 * built on react-dom/react-router-dom and ships plain `.css` imports (tokens.css,
 * components.css); none of that runs in React Native. Verified by reading its
 * package.json/src before assuming it was reusable, per the kickoff doc's instruction
 * not to assume. This file exists only because a walking-skeleton auth flow needs
 * *something* to render — it is deliberately small, not a new design system.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField(props: TextInputProps) {
  return <TextInput style={styles.input} placeholderTextColor="#9AA0A6" {...props} />;
}

export function Button({
  title,
  onPress,
  loading,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#1F6FEB'} />
      ) : (
        <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <View style={styles.successBanner}>
      <Text style={styles.successText}>{message}</Text>
    </View>
  );
}

/** A lighter-weight error display than `ErrorBanner` — no padded/colored box, just
 * text in the shared error color — for per-row inline errors (e.g. a failed booking
 * action) where a full banner would look out of place crammed into a compact row. */
export function InlineError({ message }: { message: string }) {
  return <Text style={styles.inlineErrorText}>{message}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3C4043',
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#202124',
  },
  button: {
    backgroundColor: '#1F6FEB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: '#1F6FEB',
  },
  errorBanner: {
    backgroundColor: '#FCE8E6',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#C5221F',
    fontSize: 13,
  },
  inlineErrorText: {
    color: '#C5221F',
    fontSize: 12,
    marginTop: 4,
  },
  successBanner: {
    backgroundColor: '#E6F4EA',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  successText: {
    color: '#188038',
    fontSize: 13,
  },
});
