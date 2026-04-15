// Simple in-memory rate limiter
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (record.count >= maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: maxAttempts - record.count };
}
