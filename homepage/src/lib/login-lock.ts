/**
 * 계정별 로그인 잠금 로직 — IP 기반 제한 대신 per-account.
 *
 * 왜: NAT 뒤(집·사무실·공공망) 공유 IP에서 서로 다른 사용자가 시도하면
 * 서로의 제한 카운터를 깎는 문제 발생 (mybot `project_fix_rate_limit_nat.md` 동일 패턴).
 * 해결: users.failed_login_attempts + locked_until 컬럼으로 계정마다 독립 관리.
 */
import { prisma } from "@/lib/db";

export const LOCK_THRESHOLD = 5;
export const LOCK_MINUTES = 15;

/** 계정이 현재 잠겨있는지 + 잠김이면 남은 분 수 반환 */
export function checkLocked(user: { lockedUntil: Date | null }): { locked: true; remainingMinutes: number } | { locked: false } {
  if (!user.lockedUntil) return { locked: false };
  const now = Date.now();
  const unlockAt = user.lockedUntil.getTime();
  if (unlockAt <= now) return { locked: false };
  return { locked: true, remainingMinutes: Math.ceil((unlockAt - now) / 60000) };
}

/** 로그인 실패 기록 — 임계값 넘으면 잠금. 잠기는 순간엔 friendly 메시지. */
export async function recordFailedLogin(userId: number): Promise<{ remaining: number; justLocked: boolean }> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  if (updated.failedLoginAttempts >= LOCK_THRESHOLD) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil, failedLoginAttempts: 0 },
    });
    return { remaining: 0, justLocked: true };
  }

  return { remaining: LOCK_THRESHOLD - updated.failedLoginAttempts, justLocked: false };
}

/** 로그인 성공 — 카운터 + 잠금 해제 */
export async function clearLoginLock(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
