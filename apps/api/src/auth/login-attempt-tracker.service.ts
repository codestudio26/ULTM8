import { Injectable } from '@nestjs/common';

/**
 * A reasonable-minimum stopgap for the passcode lockout policy Decision 72's own
 * follow-up explicitly calls "still undesigned" — NOT the confirmed "escalating
 * per-account lockout, decoupled from per-IP rate limiting, paired with Twilio
 * Verify's Fraud Guard" system described at Spec §11.5 (Pass 7). This is in-memory
 * only (does not survive a restart, and does not work correctly across more than one
 * apps/api instance — needs a shared store, e.g. Redis, once this runs in production)
 * and uses fixed, undocumented-as-final numbers (5 attempts / 15 minutes). Flagged for
 * the Architect before this is treated as the real lockout design.
 */
@Injectable()
export class LoginAttemptTracker {
  private readonly maxAttempts = 5;
  private readonly lockoutMs = 15 * 60 * 1000;
  private readonly attempts = new Map<string, { count: number; lockedUntil: number | null }>();

  isLocked(email: string): boolean {
    const entry = this.attempts.get(email.toLowerCase());
    if (!entry?.lockedUntil) return false;
    if (Date.now() >= entry.lockedUntil) {
      this.attempts.delete(email.toLowerCase());
      return false;
    }
    return true;
  }

  recordFailure(email: string): void {
    const key = email.toLowerCase();
    const entry = this.attempts.get(key) ?? { count: 0, lockedUntil: null };
    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = Date.now() + this.lockoutMs;
    }
    this.attempts.set(key, entry);
  }

  recordSuccess(email: string): void {
    this.attempts.delete(email.toLowerCase());
  }
}
