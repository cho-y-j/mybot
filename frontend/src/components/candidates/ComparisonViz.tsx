'use client';
import { useMemo } from 'react';
import { CandidateRadar } from '@/components/charts';

export interface CandStats {
  id: string;
  name: string;
  is_our_candidate: boolean;
  color: string;
  newsCount: number;
  posRate: number;       // 0~100
  negCount: number;      // 낮을수록 좋음
  surveyVal: number;     // 0~100 (%)
  ytViews: number;
  ytEngRate: number;     // 0~100
  cmCount: number;
  reachScore: number;
}

interface Props {
  stats: CandStats[];
  periodLabel: string;
  onNavigate?: (route: string) => void;   // 약점 대응 버튼 → 라우팅
}

// 지표 정의 (레이더 축 + 히트맵 행 + 갭바 순서 공통)
const METRICS: { key: keyof CandStats; label: string; short: string; inverse?: boolean }[] = [
  { key: 'newsCount',   label: '뉴스 노출',     short: '뉴스' },
  { key: 'posRate',     label: '긍정률',        short: '긍정%' },
  { key: 'negCount',    label: '부정 최소',     short: '부정↓', inverse: true },
  { key: 'surveyVal',   label: '지지율',        short: '지지' },
  { key: 'ytViews',     label: '유튜브 조회',   short: 'YT조회' },
  { key: 'ytEngRate',   label: '유튜브 참여',   short: 'YT참여' },
  { key: 'cmCount',     label: '커뮤니티',      short: '커뮤' },
  { key: 'reachScore',  label: '도달 점수',     short: '도달' },
];

// 정규화: 각 지표별 최대값 = 100 (inverse는 최소값 = 100)
function normalize(stats: CandStats[]): Record<string, Record<string, number>> {
  const norm: Record<string, Record<string, number>> = {};
  METRICS.forEach(m => {
    const vals = stats.map(s => Number(s[m.key] as number) || 0);
    if (m.inverse) {
      // 낮을수록 좋음: (maxVal - v) / maxVal * 100
      const max = Math.max(...vals, 1);
      norm[m.key] = {};
      stats.forEach((s, i) => {
        norm[m.key][s.name] = max > 0 ? Math.round(((max - vals[i]) / max) * 100) : 0;
      });
    } else {
      const max = Math.max(...vals, 1);
      norm[m.key] = {};
      stats.forEach((s, i) => {
        norm[m.key][s.name] = max > 0 ? Math.round((vals[i] / max) * 100) : 0;
      });
    }
  });
  return norm;
}

// 종합 점수 = 8개 지표 정규화 평균
function scoreOf(stats: CandStats[], target: CandStats, norm: ReturnType<typeof normalize>) {
  const sum = METRICS.reduce((a, m) => a + (norm[m.key][target.name] ?? 0), 0);
  return Math.round(sum / METRICS.length);
}

// 단일 후보 포맷
function fmt(n: number, isPercent?: boolean): string {
  if (!n && n !== 0) return '-';
  if (isPercent) return `${n.toFixed(n < 10 ? 1 : 0)}%`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  return n.toLocaleString();
}

export default function ComparisonViz({ stats, periodLabel, onNavigate }: Props) {
  const our = stats.find(s => s.is_our_candidate);
  const competitors = stats.filter(s => !s.is_our_candidate);

  const norm = useMemo(() => normalize(stats), [stats]);

  // 종합 점수
  const scores = useMemo(() => {
    return stats.map(s => ({ ...s, score: scoreOf(stats, s, norm) }));
  }, [stats, norm]);

  const ourScore = scores.find(s => s.is_our_candidate)?.score ?? 0;
  const compAvg = competitors.length > 0
    ? Math.round(competitors.reduce((a, c) => a + scoreOf(stats, c, norm), 0) / competitors.length)
    : 0;
  const sortedScores = [...scores].sort((a, b) => b.score - a.score);
  const ourRank = our ? (sortedScores.findIndex(s => s.is_our_candidate) + 1) : 0;
  const scoreDiff = ourScore - compAvg;

  // 레이더 데이터 변환 (정규화된 값으로)
  const radarData = METRICS.map(m => {
    const row: any = { metric: m.short };
    stats.forEach(s => {
      row[s.name] = norm[m.key][s.name] ?? 0;
    });
    return row;
  });

  // 갭 바 데이터: 각 지표별 (우리 정규화 - 경쟁자 평균 정규화)
  const gapData = METRICS.map(m => {
    const ourVal = our ? norm[m.key][our.name] ?? 0 : 0;
    const rivalAvg = competitors.length > 0
      ? Math.round(competitors.reduce((a, c) => a + (norm[m.key][c.name] ?? 0), 0) / competitors.length)
      : 0;
    const diff = ourVal - rivalAvg;
    return { ...m, ourVal, rivalAvg, diff };
  }).sort((a, b) => a.diff - b.diff); // 약점(-diff)이 위로

  // AI 약점 진단: diff <= -20 인 지표 상위 3개
  const weakPoints = gapData.filter(g => g.diff <= -20).slice(0, 3);
  const strongPoints = [...gapData].reverse().filter(g => g.diff >= 20).slice(0, 3);

  if (!our || stats.length < 2) {
    return (
      <div className="card text-center py-8 text-[var(--muted)]">
        비교할 데이터가 부족합니다. 우리 후보 + 경쟁 후보 최소 2명 이상 등록해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── 1층: 종합 점수 카드 ─── */}
      <div className="card bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">종합 미디어 영향력</div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black" style={{ color: our.color }}>{ourScore}</span>
              <span className="text-sm text-[var(--muted)]">/ 100 · {our.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">순위</div>
              <div className={`text-2xl font-bold ${ourRank === 1 ? 'text-amber-500' : ourRank === 2 ? 'text-blue-500' : 'text-[var(--foreground)]'}`}>
                {ourRank}<span className="text-sm text-[var(--muted)] font-normal"> / {stats.length}</span>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">경쟁 평균</div>
              <div className="text-2xl font-bold text-[var(--muted)]">{compAvg}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">차이</div>
              <div className={`text-2xl font-bold ${scoreDiff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {scoreDiff >= 0 ? '+' : ''}{scoreDiff}
              </div>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-2">
          * 8개 지표(뉴스/긍정률/부정↓/지지율/YT조회/YT참여/커뮤니티/도달)를 경쟁자 최고값=100으로 정규화해 평균. {periodLabel} 기준.
        </p>
      </div>

      {/* ─── 2·3층: 레이더 + 갭 바 (2단) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 레이더 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">후보별 영향력 비교</h3>
            <span className="text-xs text-[var(--muted)]">{periodLabel} · 100점 만점 정규화</span>
          </div>
          <CandidateRadar data={radarData} candidates={stats.map(s => s.name)} />
          <p className="text-[10px] text-[var(--muted)] mt-2 text-center">
            면적이 작을수록 전반 열세. 꼭짓점이 안으로 들어간 축이 약점 영역.
          </p>
        </div>

        {/* 갭 바 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">{our.name} vs 경쟁 평균</h3>
            <span className="text-xs text-[var(--muted)]">차이 = 우리 - 경쟁평균</span>
          </div>
          <div className="space-y-2">
            {gapData.map(g => {
              const isPositive = g.diff >= 0;
              const absPct = Math.min(Math.abs(g.diff), 100);
              return (
                <div key={g.key as string}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium">{g.label}</span>
                    <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                      {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{g.diff}
                    </span>
                  </div>
                  <div className="relative h-5 bg-[var(--muted-bg)] rounded overflow-hidden">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--card-border)]" />
                    {isPositive ? (
                      <div className="absolute left-1/2 top-0 bottom-0 bg-green-500/30 rounded-r"
                        style={{ width: `${absPct / 2}%` }} />
                    ) : (
                      <div className="absolute right-1/2 top-0 bottom-0 bg-red-500/30 rounded-l"
                        style={{ width: `${absPct / 2}%` }} />
                    )}
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] text-[var(--muted)]">
                      <span className={!isPositive ? 'font-bold text-red-600' : ''}>열세</span>
                      <span className={isPositive ? 'font-bold text-green-600' : ''}>우세</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-3">
            빨간 막대 긴 지표 = 당장 보강해야 할 영역
          </p>
        </div>
      </div>

      {/* ─── 4층: 히트맵 ─── */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">전체 후보 × 지표 히트맵</h3>
          <span className="text-xs text-[var(--muted)]">색 진할수록 우세 · {periodLabel}</span>
        </div>
        <div className="min-w-[600px]">
          <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(100px, 140px) repeat(${METRICS.length}, 1fr)` }}>
            {/* 헤더 */}
            <div className="text-xs text-[var(--muted)] font-semibold p-2">후보</div>
            {METRICS.map(m => (
              <div key={m.key as string} className="text-xs text-[var(--muted)] font-semibold p-2 text-center">
                {m.short}
              </div>
            ))}
            {/* 행 */}
            {stats.map(s => (
              <>
                <div key={`${s.id}-name`} className={`p-2 text-sm font-bold flex items-center gap-1.5 ${s.is_our_candidate ? 'bg-blue-500/5 rounded' : ''}`}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                  {s.is_our_candidate && <span className="text-[9px] text-blue-500 font-normal">(우리)</span>}
                </div>
                {METRICS.map(m => {
                  const v = norm[m.key][s.name] ?? 0;
                  const intensity = v / 100;
                  // 우리 후보 = 파랑 계열, 경쟁자 = 회색 계열로 구분
                  const bg = s.is_our_candidate
                    ? `rgba(59, 130, 246, ${0.06 + intensity * 0.55})`
                    : `rgba(100, 116, 139, ${0.04 + intensity * 0.45})`;
                  return (
                    <div key={`${s.id}-${m.key as string}`}
                      className="p-2 rounded text-center flex items-center justify-center"
                      style={{ backgroundColor: bg }}
                      title={`${m.label}: 정규화 ${v}`}
                    >
                      <span className={`text-xs font-bold ${v >= 80 ? 'text-[var(--foreground)]' : v >= 40 ? 'text-[var(--foreground)]/80' : 'text-[var(--muted)]'}`}>
                        {v}
                      </span>
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-2">
          셀 숫자 = 정규화 점수(0~100). 우리 행에서 연한 셀 = 약점 영역.
        </p>
      </div>

      {/* ─── 5층: AI 약점 진단 + 대응 액션 ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {weakPoints.length > 0 && (
          <div className="card bg-red-500/5 border-red-500/20">
            <h3 className="font-bold text-red-600 mb-2 uppercase tracking-wider text-sm">
              당장 보강 필요 · {weakPoints.length}개 영역
            </h3>
            <div className="space-y-2">
              {weakPoints.map((w, i) => (
                <div key={w.key as string} className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--card-bg)]">
                  <div className="flex-1">
                    <div className="font-bold text-sm">{w.label}</div>
                    <div className="text-xs text-red-500">경쟁 평균 대비 {w.diff}점 부족</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onNavigate?.(
                        w.key === 'ytViews' || w.key === 'ytEngRate'
                          ? '/easy/youtube'
                          : w.key === 'cmCount'
                          ? '/easy/news'
                          : '/easy/trends'
                      )}
                      className="text-xs px-3 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 transition font-semibold whitespace-nowrap"
                    >
                      대응하기
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--muted)] mt-3">
              경쟁 후보 평균 대비 -20점 이상 차이 나는 지표. 콘텐츠 생성·미디어·주제 추천으로 이동.
            </p>
          </div>
        )}
        {strongPoints.length > 0 && (
          <div className="card bg-green-500/5 border-green-500/20">
            <h3 className="font-bold text-green-600 mb-2 uppercase tracking-wider text-sm">
              강점 · {strongPoints.length}개 영역 유지
            </h3>
            <div className="space-y-2">
              {strongPoints.map((s) => (
                <div key={s.key as string} className="p-2 rounded bg-[var(--card-bg)]">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm">{s.label}</div>
                    <div className="text-xs text-green-600 font-bold">+{s.diff}점 우세</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--muted)] mt-3">
              경쟁 평균 대비 +20점 이상. 포기하지 말고 계속 확장.
            </p>
          </div>
        )}
        {weakPoints.length === 0 && strongPoints.length === 0 && (
          <div className="card lg:col-span-2 text-center py-6">
            <p className="text-sm text-[var(--muted)]">
              경쟁자와 편차가 크지 않습니다. 전반적으로 비슷한 수준입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
