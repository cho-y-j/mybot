'use client';
/**
 * 기존 /dashboard/schedules 북마크 리디렉트.
 * 2026-04-21: '스케줄'은 캠프 일정(/dashboard/calendar) 과 데이터 수집 스케줄(/dashboard/schedules/collection) 로 분리됨.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SchedulesIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace('/dashboard/schedules/collection'), 1500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 border border-[var(--card-border)] rounded-xl bg-[var(--card-bg)] space-y-4">
      <h1 className="text-lg font-bold">페이지가 이동되었습니다</h1>
      <p className="text-sm text-[var(--muted)]">
        '스케줄' 메뉴는 다음 두 페이지로 분리되었습니다.
      </p>
      <ul className="text-sm space-y-2">
        <li>
          <Link href="/dashboard/calendar" className="text-blue-500 underline">
            /dashboard/calendar
          </Link>{' '}
          — <strong>후보자 일정</strong> (유세·거리인사·회의)
        </li>
        <li>
          <Link href="/dashboard/schedules/collection" className="text-blue-500 underline">
            /dashboard/schedules/collection
          </Link>{' '}
          — <strong>데이터 수집 스케줄</strong> (뉴스·커뮤니티 자동 수집)
        </li>
      </ul>
      <p className="text-xs text-[var(--muted)]">1.5초 후 '수집 스케줄'로 자동 이동합니다.</p>
    </div>
  );
}
