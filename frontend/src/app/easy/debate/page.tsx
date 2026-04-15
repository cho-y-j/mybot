'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 토론 대본은 "콘텐츠 만들기"로 통합됨 — redirect
export default function DebateRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/easy/content?type=debate');
  }, [router]);
  return (
    <div className="flex items-center justify-center h-64 text-sm text-[var(--muted)]">
      토론 대본은 콘텐츠 만들기로 통합되었습니다. 이동 중...
    </div>
  );
}
