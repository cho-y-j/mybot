'use client';
import { useState } from 'react';

interface TopicCardData {
  keyword: string;
  volume?: {
    monthly_total: number;
    monthly_pc: number;
    monthly_mobile: number;
    daily_estimate: number;
    weekly_estimate: number;
    pc_ratio: number;
    mobile_ratio: number;
    competition: string;
  };
  relevance?: { score: number; reason: string; our_candidate_match: boolean };
  hashtags?: string[];
  longtail?: { keyword: string; total: number; daily_estimate: number; competition: string }[];
  ai_longtail?: { keyword: string; reason: string }[];
  top_related?: { keyword: string; total: number; competition: string }[];
  recommended_format?: { type: string; reason: string };
  blog_titles?: string[];
  meta_descriptions?: string[];
  sns_captions?: string[];
  ai_generated?: boolean;
  election?: { our_candidate?: string; region?: string; type_label?: string };
}

function copy(text: string, label?: string) {
  navigator.clipboard.writeText(text);
  // 간단한 토스트: 버튼 자체 텍스트로 피드백
}

function CopyButton({ text, size = 'xs', label = '복사' }: { text: string; size?: 'xs' | 'sm'; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { copy(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} rounded border border-[var(--card-border)] hover:bg-blue-500/10 hover:border-blue-500/40 hover:text-blue-500 transition font-medium`}
    >
      {copied ? '✓ 복사됨' : label}
    </button>
  );
}

function FormatBadge({ type }: { type: string }) {
  const label = type === 'blog' ? '블로그 (깊이 설명)'
    : type === 'sns' ? 'SNS (빠른 공유)'
    : type === 'shorts' ? '쇼츠/릴스 (24시간 생명)'
    : type;
  const color = type === 'blog' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
    : type === 'sns' ? 'bg-violet-500/10 text-violet-500 border-violet-500/30'
    : type === 'shorts' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
    : 'bg-gray-500/10';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${color}`}>
      {label}
    </span>
  );
}

function RelevanceBadge({ score }: { score: number }) {
  const color = score >= 85 ? 'bg-green-500/15 text-green-600 border-green-500/40'
    : score >= 70 ? 'bg-blue-500/15 text-blue-600 border-blue-500/40'
    : score >= 50 ? 'bg-amber-500/15 text-amber-600 border-amber-500/40'
    : 'bg-gray-500/10 text-gray-500 border-gray-500/30';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${color}`}>
      관련도 {score}
    </span>
  );
}

function VolumeStats({ volume }: { volume: NonNullable<TopicCardData['volume']> }) {
  const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString();
  return (
    <div className="grid grid-cols-3 gap-2 my-3">
      <div className="text-center p-2 rounded-lg bg-[var(--muted-bg)]">
        <div className="text-[10px] text-[var(--muted)] font-medium">일간 추정</div>
        <div className="text-lg font-black">{fmt(volume.daily_estimate)}</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-[var(--muted-bg)]">
        <div className="text-[10px] text-[var(--muted)] font-medium">주간 추정</div>
        <div className="text-lg font-black">{fmt(volume.weekly_estimate)}</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-blue-500/5 ring-1 ring-blue-500/20">
        <div className="text-[10px] text-blue-500 font-medium">월간 실제</div>
        <div className="text-lg font-black text-blue-500">{fmt(volume.monthly_total)}</div>
      </div>
    </div>
  );
}

export default function TopicCard({ data, loading }: { data: TopicCardData | null; loading?: boolean }) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-[var(--muted-bg)] rounded w-1/3" />
          <div className="h-12 bg-[var(--muted-bg)] rounded" />
          <div className="h-6 bg-[var(--muted-bg)] rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data || !data.volume) return null;

  const v = data.volume;
  const rel = data.relevance;
  const fmt = data.recommended_format;
  const hashtagAll = (data.hashtags || []).join(' ');
  const longtailAll = [
    ...(data.longtail || []).map(l => l.keyword),
    ...(data.ai_longtail || []).map(l => l.keyword),
  ].join('\n');
  const isCompLow = v.competition === '낮음';

  return (
    <div className="card space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold">{data.keyword}</h3>
          {rel && rel.score > 0 && <RelevanceBadge score={rel.score} />}
          {fmt?.type && <FormatBadge type={fmt.type} />}
          {isCompLow && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 border border-green-500/30 font-bold">
              경쟁도 낮음 (지금 기회)
            </span>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
          {expanded ? '접기' : '자세히'}
        </button>
      </div>

      {/* 관련도 이유 */}
      {rel?.reason && (
        <p className="text-xs text-[var(--muted)] -mt-1">{rel.reason}</p>
      )}

      {/* 검색량 3종 세트 */}
      <VolumeStats volume={v} />
      <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
        <span>PC {v.pc_ratio}% · 모바일 {v.mobile_ratio}%</span>
        <span>경쟁도 {v.competition}</span>
      </div>

      {!expanded && (
        <div className="flex items-center gap-2">
          {hashtagAll && <CopyButton text={hashtagAll} label="해시태그 복사" size="sm" />}
          {data.blog_titles?.[0] && <CopyButton text={data.blog_titles[0]} label="제목 복사" size="sm" />}
        </div>
      )}

      {expanded && (
        <>
          {/* 해시태그 */}
          {data.hashtags && data.hashtags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-semibold text-[var(--muted)]">후보 결합 해시태그 ({data.hashtags.length}개)</h4>
                <CopyButton text={hashtagAll} label="전체 복사" />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {data.hashtags.map((tag, i) => (
                  <button
                    key={i}
                    onClick={() => { navigator.clipboard.writeText(tag); }}
                    className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition"
                    title="클릭하면 개별 복사"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI 롱테일 제안 (선거 담당자용) */}
          {data.ai_longtail && data.ai_longtail.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-semibold text-[var(--muted)]">
                  💎 AI 추천 롱테일 키워드 ({data.ai_longtail.length}개) — 경쟁 낮고 담당자 실무 최적
                </h4>
                <CopyButton text={longtailAll} label="키워드 목록 복사" />
              </div>
              <div className="space-y-1">
                {data.ai_longtail.map((lt, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-green-500/5 border border-green-500/20">
                    <button
                      onClick={() => { navigator.clipboard.writeText(lt.keyword); }}
                      className="flex-shrink-0 text-sm font-semibold text-green-600 dark:text-green-400 hover:underline text-left"
                    >
                      {lt.keyword}
                    </button>
                    <p className="text-[11px] text-[var(--muted)] flex-1">{lt.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 네이버 반환 롱테일 (검색량 있음) */}
          {data.longtail && data.longtail.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--muted)] mb-1.5">
                📊 네이버 실제 검색량 롱테일 ({data.longtail.length}개)
              </h4>
              <div className="space-y-1">
                {data.longtail.map((lt, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-[var(--muted-bg)]">
                    <button
                      onClick={() => { navigator.clipboard.writeText(lt.keyword); }}
                      className="text-sm font-medium hover:text-blue-500 hover:underline"
                    >
                      {lt.keyword}
                    </button>
                    <span className="text-xs text-[var(--muted)]">
                      월 {lt.total.toLocaleString()}회 · 경쟁 {lt.competition}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 블로그 제목 */}
          {data.blog_titles && data.blog_titles.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-semibold text-[var(--muted)]">✍️ 블로그 제목 제안 (SEO 친화)</h4>
                <CopyButton text={(data.blog_titles || []).join('\n')} label="전체 복사" />
              </div>
              <div className="space-y-1">
                {data.blog_titles.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => { navigator.clipboard.writeText(t); }}
                    className="w-full text-left text-sm p-2 rounded-lg bg-blue-500/5 hover:bg-blue-500/10 transition"
                  >
                    <span className="text-[10px] text-blue-500 font-bold mr-2">#{i + 1}</span>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SNS 캡션 */}
          {data.sns_captions && data.sns_captions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--muted)] mb-1.5">💬 SNS 캡션</h4>
              <div className="space-y-1">
                {data.sns_captions.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-violet-500/5 border border-violet-500/20">
                    <span className="text-[10px] text-violet-500 font-bold flex-shrink-0 mt-0.5">#{i + 1}</span>
                    <p className="text-xs flex-1">{c}</p>
                    <CopyButton text={c} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 메타 설명 */}
          {data.meta_descriptions && data.meta_descriptions.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--muted)] font-semibold">📝 검색결과용 메타 설명 (SEO)</summary>
              <div className="space-y-1 mt-2">
                {data.meta_descriptions.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--muted-bg)]">
                    <p className="flex-1">{m}</p>
                    <CopyButton text={m} />
                  </div>
                ))}
              </div>
            </details>
          )}

          {fmt?.reason && (
            <p className="text-[10px] text-[var(--muted)] italic border-t border-[var(--card-border)] pt-2">
              추천 포맷 이유: {fmt.reason}
            </p>
          )}
          {data.ai_generated === false && (
            <p className="text-[10px] text-amber-500">⚠️ AI 생성 실패 — 기본 템플릿으로 표시 중</p>
          )}
        </>
      )}
    </div>
  );
}
