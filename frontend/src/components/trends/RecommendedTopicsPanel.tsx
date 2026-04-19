'use client';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';

interface Topic {
  keyword: string;
  title_hint?: string;
  reason?: string;
  relevance_score?: number;
  format?: 'blog' | 'sns' | 'shorts';
  priority?: 'high' | 'medium' | 'low';
  target_audience?: string;
  angle?: string;
  hashtags?: string[];
}

interface Props {
  electionId: string;
  onPickTopic: (keyword: string) => void;  // 키워드 클릭 → 주제 카드 생성
}

const FORMAT_LABEL: Record<string, string> = {
  blog: '블로그', sns: 'SNS', shorts: '쇼츠',
};
const FORMAT_COLOR: Record<string, string> = {
  blog: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  sns: 'bg-violet-500/10 text-violet-500 border-violet-500/30',
  shorts: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
};
const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-500/10 text-red-500 border-red-500/30',
  medium: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  low: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};
const PRIORITY_LABEL: Record<string, string> = {
  high: '지금 당장', medium: '이번 주', low: '여유 있으면',
};

export default function RecommendedTopicsPanel({ electionId, onPickTopic }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force: boolean = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const r = await api.getTopicRecommendations(electionId, force);
      setData(r);
    } catch (e: any) {
      setData({ error: e?.message || '추천 로드 실패', topics: [] });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (electionId) load(false);
  }, [electionId]);

  if (loading) {
    return (
      <div className="card bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-[var(--muted-bg)] rounded w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-[var(--muted-bg)] rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  const topics: Topic[] = data?.topics || [];
  const hasError = data?.error;

  // 우선순위별 분리
  const high = topics.filter(t => t.priority === 'high');
  const medium = topics.filter(t => t.priority === 'medium');
  const low = topics.filter(t => t.priority === 'low' || !t.priority);

  const renderTopic = (t: Topic, i: number) => (
    <button
      key={`${t.keyword}-${i}`}
      onClick={() => onPickTopic(t.keyword)}
      className="w-full text-left p-3 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-blue-500/40 hover:shadow-md hover:bg-blue-500/5 transition group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="font-bold text-sm flex-1 leading-snug group-hover:text-blue-500">
          {t.keyword}
        </h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          {t.format && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${FORMAT_COLOR[t.format]}`}>
              {FORMAT_LABEL[t.format]}
            </span>
          )}
          {t.relevance_score !== undefined && t.relevance_score > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-bold">
              {t.relevance_score}
            </span>
          )}
        </div>
      </div>
      {t.title_hint && (
        <p className="text-xs italic text-[var(--muted)] mb-1.5 line-clamp-1">
          제목 예시: "{t.title_hint}"
        </p>
      )}
      {t.reason && (
        <p className="text-[11px] text-[var(--muted)] leading-relaxed line-clamp-2">
          {t.reason}
        </p>
      )}
      {t.target_audience && (
        <p className="text-[10px] text-[var(--muted)] mt-1.5">
          타겟: {t.target_audience}
        </p>
      )}
      <div className="mt-2 text-[10px] text-blue-500 font-medium group-hover:underline">
        주제 카드 생성 → 해시태그·블로그 제목 1클릭 복사
      </div>
    </button>
  );

  return (
    <div className="card bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            이번 주 추천 주제
            {topics.length > 0 && <span className="text-xs text-[var(--muted)] font-normal">· {topics.length}개</span>}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            AI가 최근 뉴스·여론조사·커뮤니티를 분석해서 담당자가 바로 쓸 수 있는 주제를 제안합니다.
          </p>
          {data?.generated_at && (
            <p className="text-[10px] text-[var(--muted)] mt-0.5">
              생성 시점: {new Date(data.generated_at).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              {data.age_hours !== undefined && (
                <span className="ml-1">
                  · {data.age_hours < 1 ? '방금' : data.age_hours < 24 ? `${Math.round(data.age_hours)}시간 전` : `${Math.round(data.age_hours/24)}일 전`}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap font-semibold"
        >
          {refreshing ? '생성중... (약 30초)' : data?.topics?.length ? '새로 추천받기' : '추천 받기'}
        </button>
      </div>

      {/* Stale 배너 */}
      {data?.stale && data?.stale_reason && (
        <div className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 p-2 rounded flex items-center justify-between gap-2">
          <span>{data.stale_reason}</span>
          <button onClick={() => load(true)} disabled={refreshing} className="underline font-medium hover:text-amber-500">
            지금 새로 받기
          </button>
        </div>
      )}

      {/* 에러 */}
      {hasError && (
        <div className="text-xs bg-red-500/10 border border-red-500/30 text-red-500 p-3 rounded">
          {hasError}
        </div>
      )}

      {/* 빈 상태 */}
      {!hasError && topics.length === 0 && !loading && (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--muted)] mb-2">아직 추천 주제가 생성되지 않았습니다.</p>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshing ? 'AI 분석중... (약 30초)' : '지금 추천 받기'}
          </button>
        </div>
      )}

      {/* 주제 리스트 */}
      {topics.length > 0 && (
        <div className="space-y-3">
          {high.length > 0 && (
            <section>
              <h4 className="text-xs font-bold text-red-500 mb-2 uppercase tracking-wider">
                지금 당장 써야 · {high.length}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {high.map((t, i) => renderTopic(t, i))}
              </div>
            </section>
          )}
          {medium.length > 0 && (
            <section>
              <h4 className="text-xs font-bold text-amber-500 mb-2 uppercase tracking-wider">
                이번 주 내 · {medium.length}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {medium.map((t, i) => renderTopic(t, high.length + i))}
              </div>
            </section>
          )}
          {low.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs font-semibold text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] uppercase tracking-wider">
                여유 있을 때 · {low.length} 펼쳐보기
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                {low.map((t, i) => renderTopic(t, high.length + medium.length + i))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 컨텍스트 요약 (하단 참고) */}
      {data?.context && (
        <div className="text-[10px] text-[var(--muted)] border-t border-[var(--card-border)] pt-2">
          참조 데이터: 최근 7일 뉴스 {data.context.recent_news_count}건 · 커뮤니티 {data.context.recent_community_count}건 · 여론조사 {data.context.survey_count}건
        </div>
      )}
    </div>
  );
}
