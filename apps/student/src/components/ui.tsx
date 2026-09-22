/**
 * Minimal local RN primitives — NOT a port of @ultm8/ui. That package (packages/ui) is
 * built on react-dom/react-router-dom and ships plain `.css` imports (tokens.css,
 * components.css); none of that runs in React Native. Verified by reading its
 * package.json/src before assuming it was reusable, per the kickoff doc's instruction
 * not to assume. This file exists only because a walking-skeleton auth flow needs
 * *something* to render — it is deliberately small, not a new design system.
 *
 * Colors/spacing/type now come from theme/tokens.ts (DESIGN.md translated to plain RN
 * values) rather than the ad hoc Material-style hex this file shipped with in Slice 1
 * — see tokens.ts's own header for why a separate translation was needed instead of
 * reusing packages/ui directly. Two real DESIGN.md violations were caught fixing this,
 * not just a color swap: the input font size was 15px (DESIGN.md requires >=16px on
 * any text input — below that, iOS Safari/WebKit auto-zooms the viewport on focus),
 * and the Button had no guaranteed minimum touch target (DESIGN.md: "every interactive
 * element: minimum 44×44px, regardless of visual size").
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
import { colors, theme, spacing, fontSize, fontWeight, radius, minTouchTarget } from '../theme/tokens';

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
  return <TextInput style={styles.input} placeholderTextColor={theme.textMuted} {...props} />;
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
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'destructive' && styles.buttonDestructive,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? theme.textAccent : theme.onAccent} />
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
    backgroundColor: theme.surface0,
    padding: spacing[4] + spacing[1], // 20 — no exact DESIGN.md token, closest is space-4/space-6; kept as-is since it's a wrapper margin, not a component listed in DESIGN.md's own state table.
  },
  field: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.heading,
    color: theme.textPrimary,
    marginBottom: spacing[2],
  },
  hint: {
    fontSize: fontSize.caption,
    color: theme.textSecondary,
    marginTop: spacing[1],
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.input,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.input,
    color: theme.textPrimary,
  },
  button: {
    backgroundColor: theme.fillAccent,
    borderRadius: radius.button,
    paddingVertical: spacing[3],
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
  },
  buttonDestructive: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: theme.onAccent,
    fontWeight: fontWeight.heading,
    fontSize: fontSize.footnote,
  },
  buttonTextSecondary: {
    color: theme.textAccent,
  },
  errorBanner: {
    backgroundColor: theme.bgDanger,
    borderRadius: radius.input,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  errorText: {
    color: theme.textDanger,
    fontSize: fontSize.caption,
  },
  inlineErrorText: {
    color: theme.textDanger,
    fontSize: fontSize.caption,
    marginTop: spacing[1],
  },
  successBanner: {
    backgroundColor: theme.bgSuccess,
    borderRadius: radius.input,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  successText: {
    color: theme.textSuccess,
    fontSize: fontSize.caption,
  },
});
