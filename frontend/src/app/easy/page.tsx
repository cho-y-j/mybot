'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useElection } from '@/hooks/useElection';

interface Action {
  priority: 'high' | 'medium' | 'low';
  icon: string;
  type: string;
  title: string;
  summary: string;
  detail: string;
  action: string;
  action_link: string;
  secondary?: { label: string; link: string } | null;
}

interface Summary {
  news_today: number;
  comm_today: number;
  yt_today: number;
}

export default function EasyHome() {
  const { election, ourCandidate, loading: elLoading } = useElection();
  const [actions, setActions] = useState<Action[]>([]);
  const [summary, setSummary] = useState<Summary>({ news_today: 0, comm_today: 0, yt_today: 0 });
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = (sessionStorage.getItem('user') || localStorage.getItem('user'));
    if (u) { try { setUser(JSON.parse(u)); } catch {} }
  }, []);

  useEffect(() => {
    if (!election?.id) return;
    loadActions();
    const interval = setInterval(loadActions, 60000);
    return () => clearInterval(interval);
  }, [election?.id]);

  const loadActions = async () => {
    try {
      const token = (sessionStorage.getItem('access_token') || localStorage.getItem('access_token'));
      const resp = await fetch(`/api/easy/today/${election?.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setActions(data.actions || []);
        setSummary(data.summary || { news_today: 0, comm_today: 0, yt_today: 0 });
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const today = new Date().toLocaleDateString('ko', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  const priorityColor = (p: string) =>
    p === 'high' ? 'border-red-500/50 bg-red-500/5 hover:bg-red-500/10' :
    p === 'medium' ? 'border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10' :
    'border-green-500/50 bg-green-500/5 hover:bg-green-500/10';

  const priorityLabel = (p: string) =>
    p === 'high' ? '긴급' : p === 'medium' ? '주목' : '참고';

  if (elLoading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-4 lg:p-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <h1 className="text-lg lg:text-2xl font-bold truncate text-[var(--foreground)]">안녕하세요, {user?.name || '캠프'}님</h1>
            <p className="text-xs lg:text-sm text-[var(--muted)] mt-1">{today}</p>
          </div>
          {election?.election_date && (
            <div className="text-right">
              <div className="text-[10px] lg:text-sm text-[var(--muted)] uppercase tracking-wider">선거까지</div>
              <div className="text-2xl lg:text-3xl font-black text-[var(--foreground)]">
                D-{Math.max(0, Math.ceil((new Date(election.election_date).getTime() - Date.now()) / 86400000))}
              </div>
            </div>
          )}
        </div>
        {election && (
          <div className="mt-3 text-xs lg:text-sm text-[var(--muted)]">
            {election.region_sido} {election.region_sigungu || ''} · {election.name}
            {ourCandidate && <span className="block lg:inline lg:ml-1">우리 후보: {ourCandidate.name}</span>}
          </div>
        )}
      </div>

      {/* Today's Action */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">오늘 꼭 해야 할 일</h2>
          <button onClick={loadActions}
            className="text-xs text-[var(--muted)] hover:text-blue-500">↻ 새로고침</button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-[var(--muted-bg)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)] bg-[var(--muted-bg)] rounded-xl">
            <p className="text-sm">오늘은 특별한 대응이 필요 없어요.</p>
            <p className="text-xs mt-1">AI 비서에게 물어보거나 콘텐츠를 만들어보세요.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((a, i) => (
              <div key={i} className={`border rounded-xl p-4 transition ${priorityColor(a.priority)}`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--card-bg)]">
                        {priorityLabel(a.priority)}
                      </span>
                      <h3 className="font-bold text-base">{a.title}</h3>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{a.summary}</p>
                    {a.detail && (
                      <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{a.detail}</p>
                    )}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <Link href={a.action_link}
                        className="inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
                        → {a.action}
                      </Link>
                      {a.secondary && (
                        <Link href={a.secondary.link}
                          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--muted)] hover:text-blue-500">
                          {a.secondary.label}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 숫자 요약 */}
      <div>
        <h2 className="text-lg font-bold mb-3">오늘 수집 현황</h2>
        <div className="grid grid-cols-3 gap-3">
          <Link href="/easy/news" className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 text-center hover:border-[var(--foreground)]/30 transition">
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.news_today}</div>
            <div className="text-xs text-[var(--muted)] mt-1">뉴스</div>
          </Link>
          <Link href="/easy/youtube" className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 text-center hover:border-[var(--foreground)]/30 transition">
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.comm_today}</div>
            <div className="text-xs text-[var(--muted)] mt-1">커뮤니티</div>
          </Link>
          <Link href="/easy/youtube" className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 text-center hover:border-[var(--foreground)]/30 transition">
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.yt_today}</div>
            <div className="text-xs text-[var(--muted)] mt-1">미디어</div>
          </Link>
        </div>
      </div>

      {/* 빠른 생성 */}
      <div>
        <h2 className="text-lg font-bold mb-3">빠른 만들기</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/easy/content?type=blog', label: '블로그 글' },
            { href: '/easy/content?type=sns', label: 'SNS 포스팅' },
            { href: '/easy/content?type=card', label: '카드뉴스' },
            { href: '/easy/debate', label: '토론 대본' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 text-center hover:border-[var(--foreground)]/30 transition">
              <div className="font-semibold text-sm">{item.label}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* 분석 & 참고 자료 */}
      <div>
        <h2 className="text-lg font-bold mb-3">분석 & 참고</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/easy/candidates', label: '후보 비교' },
            { href: '/easy/history', label: '과거 선거' },
            { href: '/easy/surveys', label: '여론조사' },
            { href: '/easy/trends', label: '트렌드' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 text-center hover:border-[var(--foreground)]/30 transition">
              <div className="font-semibold text-sm">{item.label}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* 도움말 */}
      <div className="bg-[var(--muted-bg)] rounded-xl p-4 text-xs text-[var(--muted)]">
        <p className="font-semibold mb-1">💡 팁</p>
        <p>우측 하단의 💬 버튼을 누르면 언제든 AI 비서에게 질문할 수 있어요.</p>
        <p className="mt-1">더 자세한 분석이 필요하면 좌측 사이드바의 "전문가 메뉴"를 열어보세요.</p>
      </div>
    </div>
  );
}
