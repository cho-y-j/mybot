'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { parentCity, partyColor, CampTier, campTierOf, partyToCamp } from './utils';

// 보편적 진영 5단계 색상 (UnifiedHeatmap과 동일)
const TIER_HEX: Record<CampTier, string> = {
  진보강세: '#2563eb', 진보우세: '#93c5fd', 경합: '#fcd34d', 보수우세: '#fca5a5', 보수강세: '#dc2626',
};
const TIER_TEXT: Record<CampTier, string> = {
  진보강세: 'text-white', 진보우세: 'text-blue-900', 경합: 'text-amber-900', 보수우세: 'text-red-900', 보수강세: 'text-white',
};

function shortName(district: string): string {
  const p = parentCity(district);
  if (p === district) return district;
  return district.replace(p, p + ' ');
}

interface Props {
  electionId: string;
  year?: number | null;
  initialSigungu?: string | null;
  viewMode?: 'party' | 'camp';
}

export default function DongDrilldown({
  electionId, year, initialSigungu, viewMode = 'camp',
}: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSigungu, setSelectedSigungu] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getDongResults(electionId, undefined, year ?? undefined)
      .then(async (d) => {
        if (cancelled) return;
        if ((!d?.data?.length || !d?.available) && !year) {
          for (const tryYear of [2022, 2018, 2014, 2010]) {
            const d2 = await api.getDongResults(electionId, undefined, tryYear).catch(() => null);
            if (d2?.data?.length) { d = d2; break; }
          }
        }
        setData(d);
        if (d?.data?.length) {
          const match = initialSigungu && d.data.find((s: any) => s.sigungu === initialSigungu);
          setSelectedSigungu(match ? initialSigungu : d.data[0].sigungu);
        }
      })
      .catch((e: any) => !cancelled && setError(e?.message || '동 단위 데이터 로드 실패'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [electionId, year, initialSigungu]);

  const sigunguList = data?.data || [];
  const selectedData = useMemo(
    () => sigunguList.find((s: any) => s.sigungu === selectedSigungu),
    [sigunguList, selectedSigungu]
  );

  const filteredDongs = useMemo(() => {
    if (!selectedData) return [];
    const q = search.trim();
    if (!q) return selectedData.dongs;
    return selectedData.dongs.filter((d: any) => d.name.includes(q));
  }, [selectedData, search]);

  if (loading) {
    return (
      <div className="card text-center py-12">
        <div className="animate-spin h-6 w-6 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
        <div className="text-sm text-[var(--muted)]">동 단위 데이터 로딩...</div>
      </div>
    );
  }

  if (error || !data?.available) {
    return (
      <div className="card text-center py-10">
        <div className="text-base font-bold mb-2">동·읍·면 단위 데이터 없음</div>
        <p className="text-xs text-[var(--muted)]">{data?.error || error}</p>
        <p className="text-xs text-[var(--muted)]/70 mt-2">관리자가 data.go.kr fileData(XLSX)를 import해야 사용 가능합니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-bold">읍·면·동 단위 강세 분석</h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              {data.year}년 {data.region} · 시·군·구 선택 → 동별 진영 5단계 색상
            </p>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
            data.go.kr 공공 fileData
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 좌측: 시·군·구 리스트 (flat, 청주 prefix 유지) */}
        <div className="card lg:max-h-[700px] overflow-y-auto">
          <h4 className="text-sm font-bold mb-3 sticky top-0 bg-[var(--card-bg)] py-1 z-10">시·군·구 · {sigunguList.length}</h4>
          <div className="space-y-1">
            {sigunguList.map((s: any) => {
              const isSel = s.sigungu === selectedSigungu;
              const display = shortName(s.sigungu);
              return (
                <button
                  key={s.sigungu}
                  onClick={() => setSelectedSigungu(s.sigungu)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    isSel
                      ? 'bg-blue-500/10 border-blue-500/40'
                      : 'border-[var(--card-border)] hover:bg-[var(--muted-bg)]'
                  }`}
                >
                  <div className="font-semibold text-sm truncate">{display}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">{s.dong_count} 동·면</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 우측: 동별 결과 — 진영 5단계 색 통일 */}
        <div className="lg:col-span-3 space-y-3">
          {selectedData ? (
            <>
              <div className="card flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="text-lg font-bold">{selectedData.sigungu}</h4>
                  <p className="text-xs text-[var(--muted)] mt-1">{selectedData.dong_count}개 읍·면·동 · 진영 5단계 색상</p>
                </div>
                <input
                  type="text"
                  placeholder="동·면 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-[var(--card-border)] rounded-lg bg-[var(--input-bg)] w-40"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {filteredDongs.map((dong: any) => {
                  // 진영 tier 계산 (백엔드에서 준 것 사용, 없으면 현장 계산)
                  const tier: CampTier = dong.camp_tier
                    || campTierOf(dong.progressive_rate || 0, dong.conservative_rate || 0);
                  const tierColor = TIER_HEX[tier];
                  const textCls = TIER_TEXT[tier];
                  const top2 = (dong.candidates || []).slice(0, 2);

                  return (
                    <div
                      key={dong.name}
                      className={`rounded-lg border-2 p-3 ${textCls}`}
                      style={{ background: tierColor, borderColor: tierColor }}
                      title={`${dong.name} · ${tier} · 격차 ${dong.camp_gap ?? dong.margin}%p`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-bold text-sm truncate">{dong.name}</div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/30 font-bold whitespace-nowrap">
                          {tier}
                        </span>
                      </div>
                      {/* 진영 득표율 */}
                      <div className="text-[11px] opacity-95 mb-2">
                        진보 {dong.progressive_rate?.toFixed(1) ?? 0}% · 보수 {dong.conservative_rate?.toFixed(1) ?? 0}%
                      </div>
                      {/* Top 2 후보 (간략) */}
                      <div className="space-y-0.5">
                        {top2.map((c: any, i: number) => (
                          <div key={i} className="flex items-center gap-1.5 text-[11px] opacity-95">
                            <span className="w-3 text-center">{i + 1}</span>
                            <span className="flex-1 truncate font-medium">{c.candidate_name}</span>
                            <span className="font-bold tabular-nums">{c.vote_rate?.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-[10px] opacity-85 mt-1">격차 {dong.margin}%p</div>
                    </div>
                  );
                })}
              </div>
              {filteredDongs.length === 0 && (
                <div className="card text-center text-[var(--muted)] py-8 text-sm">검색 결과 없음</div>
              )}
            </>
          ) : (
            <div className="card text-center text-[var(--muted)] py-12">시·군·구를 선택하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}
