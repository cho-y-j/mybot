'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { partyColor, TIER_STYLE, CampTier, groupByParent, childName, shadeFromGap } from './utils';

interface Props {
  electionId: string;
  year?: number | null;
  initialSigungu?: string | null;
  viewMode?: 'party' | 'camp';  // 전역 모드 — 진영 색 또는 정당 색
}

export default function DongDrilldown({
  electionId, year, initialSigungu, viewMode = 'party',
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
  const region = data?.region || '';

  // 시·군·구 그룹핑 (청주·수원 등)
  const groupedSigungu = useMemo(() => {
    return groupByParent(
      sigunguList.map((s: any) => ({ district: s.sigungu, ...s })),
      region,
    );
  }, [sigunguList, region]);

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
              {data.year}년 {data.region} · 시·군·구를 선택해서 동·면별 후보 득표를 비교하세요.
              {viewMode === 'camp' && <span className="ml-2 text-blue-500 font-semibold">진영별 색상 모드</span>}
              {viewMode === 'party' && <span className="ml-2 text-[var(--muted)]">정당 색상 모드</span>}
            </p>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
            data.go.kr 공공 fileData
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 좌측: 시·군·구 리스트 (parent city 그룹핑) */}
        <div className="card lg:max-h-[700px] overflow-y-auto">
          <h4 className="text-sm font-bold mb-3 sticky top-0 bg-[var(--card-bg)] py-1 z-10">시·군·구 · {sigunguList.length}</h4>
          <div className="space-y-3">
            {groupedSigungu.map(([parent, children]) => {
              const isGroup = children.length > 1;
              return (
                <div key={parent}>
                  {isGroup && (
                    <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1 px-1">
                      {parent} · {children.length}
                    </div>
                  )}
                  <div className="space-y-1">
                    {children.map((s: any) => {
                      const isSel = s.sigungu === selectedSigungu;
                      const display = isGroup ? childName(s.sigungu, parent) : s.sigungu;
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
              );
            })}
          </div>
        </div>

        {/* 우측: 선택된 시·군·구의 동별 결과 */}
        <div className="lg:col-span-3 space-y-3">
          {selectedData ? (
            <>
              <div className="card flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="text-lg font-bold">{selectedData.sigungu}</h4>
                  <p className="text-xs text-[var(--muted)] mt-1">{selectedData.dong_count}개 읍·면·동 · 색상은 {viewMode === 'camp' ? '진영 5단계' : '1위 정당'}</p>
                </div>
                <input
                  type="text"
                  placeholder="동·면 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-[var(--card-border)] rounded-lg bg-[var(--input-bg)] w-40"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredDongs.map((dong: any) => {
                  const winner = dong.winner;
                  const top2 = (dong.candidates || []).slice(0, 2);
                  const sumTop2 = top2.reduce((s: number, c: any) => s + (c.vote_rate || 0), 0) || 1;

                  // 진영 모드: tier 기반 색상 + 격차 opacity
                  const tier: CampTier | undefined = dong.camp_tier;
                  const tierStyle = tier ? TIER_STYLE[tier] : undefined;
                  const borderColor = viewMode === 'camp' && tierStyle
                    ? tierStyle.solid
                    : partyColor(winner?.party || '');
                  const shade = viewMode === 'camp' ? shadeFromGap(dong.camp_gap || 0) : 1;

                  return (
                    <div
                      key={dong.name}
                      className="card border-l-4"
                      style={{ borderLeftColor: borderColor, opacity: shade }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold text-sm">{dong.name}</div>
                        <div className="flex items-center gap-2">
                          {viewMode === 'camp' && tier && tierStyle && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${tierStyle.bg} ${tierStyle.text} font-bold`}>
                              {tier}
                            </span>
                          )}
                          <span className="text-[11px] text-[var(--muted)]">격차 {dong.margin}%p</span>
                        </div>
                      </div>
                      {viewMode === 'camp' && (
                        <div className="text-[10px] text-[var(--muted)] mb-2">
                          진보 {dong.progressive_rate?.toFixed(1) || 0}% · 보수 {dong.conservative_rate?.toFixed(1) || 0}%
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {(dong.candidates || []).slice(0, 4).map((c: any, i: number) => {
                          // 진영 모드: 진영 색, 정당 모드: 정당 색
                          const camp = c.party_camp;
                          const chipColor = viewMode === 'camp'
                            ? (camp === '진보' ? '#2563eb' : camp === '보수' ? '#dc2626' : '#94a3b8')
                            : partyColor(c.party || '');
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <div className="text-[10px] w-5 text-[var(--muted)] text-center">{i + 1}</div>
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded text-white font-bold whitespace-nowrap"
                                style={{ background: chipColor }}
                              >
                                {viewMode === 'camp' && camp ? camp : (c.party || '-')}
                              </span>
                              <div className="flex-1 truncate text-xs font-medium">{c.candidate_name}</div>
                              <div className="text-xs font-bold tabular-nums">{c.vote_rate?.toFixed(1)}%</div>
                            </div>
                          );
                        })}
                      </div>
                      {top2.length === 2 && (
                        <div className="flex h-1.5 rounded-full overflow-hidden mt-2">
                          {top2.map((c: any, i: number) => {
                            const camp = c.party_camp;
                            const barColor = viewMode === 'camp'
                              ? (camp === '진보' ? '#2563eb' : camp === '보수' ? '#dc2626' : '#94a3b8')
                              : partyColor(c.party || '');
                            return (
                              <div key={i} style={{ width: `${(c.vote_rate / sumTop2) * 100}%`, background: barColor }} />
                            );
                          })}
                        </div>
                      )}
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
