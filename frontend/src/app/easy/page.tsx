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

      {/* 오늘 체크 포인트 — 진짜 후보자가 매일 열어봐야 할 3곳 */}
      <div>
        <h2 className="text-lg font-bold mb-3">오늘 체크</h2>
        <div className="grid grid-cols-3 gap-3">
          {/* 1. 오늘 뉴스 */}
          <Link href="/easy/news"
            className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-blue-500/60 hover:bg-blue-500/5 hover:-translate-y-0.5 transition-all">
            <div className="flex items-center justify-between mb-2">
              <svg className="w-5 h-5 text-[var(--muted)] group-hover:text-blue-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/>
              </svg>
              <span className="text-[10px] text-[var(--muted)] group-hover:text-blue-500">보기 →</span>
            </div>
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.news_today}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">뉴스</div>
            <div className="text-[10px] text-[var(--muted)] mt-1">본인·경쟁자 언급 기사</div>
          </Link>
          {/* 2. 여론·트렌드 (커뮤니티+트렌드 — 이전 커뮤니티 카드와 미디어 중복 해소) */}
          <Link href="/easy/trends"
            className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-amber-500/60 hover:bg-amber-500/5 hover:-translate-y-0.5 transition-all">
            <div className="flex items-center justify-between mb-2">
              <svg className="w-5 h-5 text-[var(--muted)] group-hover:text-amber-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 17 6-6 4 4 8-8M14 7h7v7"/>
              </svg>
              <span className="text-[10px] text-[var(--muted)] group-hover:text-amber-500">보기 →</span>
            </div>
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.comm_today}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">여론·트렌드</div>
            <div className="text-[10px] text-[var(--muted)] mt-1">커뮤니티·검색 키워드</div>
          </Link>
          {/* 3. 미디어 (유튜브) */}
          <Link href="/easy/youtube"
            className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-rose-500/60 hover:bg-rose-500/5 hover:-translate-y-0.5 transition-all">
            <div className="flex items-center justify-between mb-2">
              <svg className="w-5 h-5 text-[var(--muted)] group-hover:text-rose-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m10 15 5-3-5-3zM2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
              </svg>
              <span className="text-[10px] text-[var(--muted)] group-hover:text-rose-500">보기 →</span>
            </div>
            <div className="text-2xl font-black text-[var(--foreground)]">{summary.yt_today}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">유튜브</div>
            <div className="text-[10px] text-[var(--muted)] mt-1">본인·경쟁자 영상</div>
          </Link>
        </div>
      </div>

      {/* 빠른 생성 */}
      <div>
        <h2 className="text-lg font-bold mb-3">빠른 만들기</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/easy/content?type=blog', label: '블로그 글', desc: '네이버 블로그용 (1~2천자)',
              svg: <><path d="M4 19h16M4 5h16M4 12h10"/></> },
            { href: '/easy/content?type=sns', label: 'SNS 포스팅', desc: '페북/인스타 (500자 이내)',
              svg: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></> },
            { href: '/easy/content?type=card', label: '카드뉴스', desc: '이미지 카드 메시지',
              svg: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></> },
            { href: '/easy/debate', label: '토론 대본', desc: '방송·합동 토론용',
              svg: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></> },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-blue-500/60 hover:bg-blue-500/5 hover:-translate-y-0.5 transition-all">
              <svg className="w-6 h-6 text-[var(--muted)] group-hover:text-blue-500 transition-colors mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {item.svg}
              </svg>
              <div className="font-semibold text-sm">{item.label}</div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">{item.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* 분석 & 참고 자료 */}
      <div>
        <h2 className="text-lg font-bold mb-3">분석 & 참고</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/easy/candidates', label: '후보 비교', desc: '경쟁자 감성·지지율',
              svg: <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M22 21v-2a4 4 0 0 0-3-3.87"/></> },
            { href: '/easy/history', label: '과거 선거', desc: '역대 결과·성향',
              svg: <><path d="M3 12a9 9 0 1 0 9-9M3 12h4l3-6 4 12 3-6h4"/></> },
            { href: '/easy/surveys', label: '여론조사', desc: '지지율·교차분석',
              svg: <><path d="M3 3v18h18M9 17V9M13 17V5M17 17v-6"/></> },
            { href: '/easy/trends', label: '트렌드', desc: '급상승 키워드',
              svg: <><path d="m3 17 6-6 4 4 8-8M14 7h7v7"/></> },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-violet-500/60 hover:bg-violet-500/5 hover:-translate-y-0.5 transition-all">
              <svg className="w-6 h-6 text-[var(--muted)] group-hover:text-violet-500 transition-colors mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {item.svg}
              </svg>
              <div className="font-semibold text-sm">{item.label}</div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">{item.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* 도움말 */}
      <div className="bg-[var(--muted-bg)] rounded-xl p-4 text-xs text-[var(--muted)] flex items-start gap-3">
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
        </svg>
        <div>
          <p>우측 하단 <strong className="text-[var(--foreground)]">AI 비서</strong> 버튼을 누르면 언제든 질문할 수 있어요.</p>
          <p className="mt-1">더 자세한 분석이 필요하면 좌측 사이드바의 <strong className="text-[var(--foreground)]">전문가 메뉴</strong>를 열어보세요.</p>
        </div>
      </div>
    </div>
  );
}
