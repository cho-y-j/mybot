'use client';
import { useState, useEffect } from 'react';
import { parentCity, partyToCamp, TIER_STYLE, CampTier, campTierOf, shadeFromGap } from './utils';

interface Top3 {
  name: string;
  party: string;
  party_camp?: string;
  vote_rate: number;
  votes: number;
  is_winner: boolean;
}

interface YearEntry {
  year: number;
  election_number: number | null;
  top3: Top3[];
  winner_party: string;
  winner_camp?: string;
  margin: number;
  candidates_count: number;
}

interface DistrictCell {
  district: string;
  strength: string;
  margin: number;
  dominant: string;
  progressive_rate: number;
  conservative_rate: number;
}

interface Props {
  drilldown: Record<string, YearEntry[]>;
  cells: DistrictCell[];
  selectedDistrict: string | null;
  onSelect: (d: string) => void;
  sido?: string;
  yearFilter?: number | null;
}

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

export default function DistrictDrilldownPanel({
  drilldown, cells, selectedDistrict, onSelect, sido, yearFilter,
}: Props) {
  const districts = cells || [];
  const [selected, setSelected] = useState<string | null>(selectedDistrict || (districts[0]?.district ?? null));

  useEffect(() => {
    if (selectedDistrict && selectedDistrict !== selected) {
      setSelected(selectedDistrict);
    }
  }, [selectedDistrict]);

  if (!districts.length) {
    return <div className="card text-center text-[var(--muted)] py-12">시·군·구 데이터가 없습니다.</div>;
  }

  // 각 district의 tier 계산 (진보/보수 득표율 기반)
  function cellTier(d: DistrictCell): CampTier {
    return campTierOf(d.progressive_rate || 0, d.conservative_rate || 0);
  }

  const rawTimeline = (selected && drilldown[selected]) || [];
  const timeline = yearFilter != null
    ? rawTimeline.filter((y) => y.year === yearFilter)
    : rawTimeline;

  function campBadge(camp?: string, party?: string, gap?: number) {
    const c = camp || partyToCamp(party) || '';
    const opacity = gap !== undefined ? shadeFromGap(Math.abs(gap)) : 1;
    if (c === '진보') return { cls: 'bg-blue-600 text-white', opacity };
    if (c === '보수') return { cls: 'bg-red-600 text-white', opacity };
    return { cls: 'bg-[var(--muted-bg)] text-[var(--muted)]', opacity: 0.8 };
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌측: 시·군·구 리스트 (flat, 청주 prefix 유지) */}
      <div className="card lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-bold mb-3 sticky top-0 bg-[var(--card-bg)] py-1 z-10">
          시·군·구 · {districts.length}
          {yearFilter != null && <span className="ml-2 text-[10px] text-blue-500 font-normal">· {yearFilter}년</span>}
        </h3>
        <div className="space-y-1">
          {districts.map((d) => {
            const isSel = d.district === selected;
            const tier = cellTier(d);
            const display = shortName(d.district);
            return (
              <button
                key={d.district}
                onClick={() => { setSelected(d.district); onSelect(d.district); }}
                className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-colors ${
                  isSel ? 'ring-2 ring-blue-500/50' : ''
                } ${TIER_TEXT[tier]}`}
                style={{
                  background: TIER_HEX[tier],
                  borderColor: isSel ? '#3b82f6' : TIER_HEX[tier],
                  opacity: isSel ? 1 : 0.92,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{display}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/30 font-bold whitespace-nowrap">
                    {tier}
                  </span>
                </div>
                <div className="text-[11px] mt-0.5 opacity-95">
                  진보 {d.progressive_rate?.toFixed(1) ?? '-'}% · 보수 {d.conservative_rate?.toFixed(1) ?? '-'}%
                </div>
                <div className="text-[10px] opacity-90">격차 {d.margin}%p</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 우측: 회차별 결과 */}
      <div className="lg:col-span-2 space-y-3">
        {selected ? (
          <>
            <div className="card">
              <h3 className="text-lg font-bold">{selected}</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                {yearFilter != null
                  ? `${yearFilter}년 ${timeline.length > 0 ? '회차' : '회차 없음'}`
                  : `${timeline.length}회 선거 기록 (전체)`}
              </p>
            </div>
            {timeline.length === 0 ? (
              <div className="card text-center text-[var(--muted)] py-8">
                {yearFilter != null ? `${yearFilter}년 ` : ''}데이터가 없습니다.
              </div>
            ) : (
              timeline.map((y) => {
                const winner = campBadge(y.winner_camp, y.winner_party, y.margin);
                // 회차별 진영 tier 계산 (top3 득표율 합산)
                let prog = 0, cons = 0;
                y.top3.forEach((c) => {
                  const camp = c.party_camp || partyToCamp(c.party);
                  if (camp === '진보') prog += c.vote_rate;
                  else if (camp === '보수') cons += c.vote_rate;
                });
                const yearTier = campTierOf(prog, cons);
                return (
                  <div
                    key={y.year}
                    className="card border-l-4"
                    style={{ borderLeftColor: TIER_HEX[yearTier] }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-bold">제{y.election_number}회 ({y.year})</div>
                        <div className="text-[11px] text-[var(--muted)]">후보 {y.candidates_count}명 · 격차 {y.margin}%p · {yearTier}</div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded font-bold ${winner.cls}`}
                        style={{ opacity: winner.opacity }}
                      >
                        {y.winner_party || y.top3[0]?.name} 당선
                      </span>
                    </div>
                    <div className="space-y-2">
                      {y.top3.map((c, i) => {
                        const partyBadge = campBadge(c.party_camp, c.party, 20 - Math.abs((y.top3[0]?.vote_rate ?? 0) - c.vote_rate));
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <div className="text-xs w-6 text-center font-bold text-[var(--muted)]">{i + 1}위</div>
                            {c.party && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${partyBadge.cls}`}
                                style={{ opacity: partyBadge.opacity }}
                              >
                                {c.party}
                              </span>
                            )}
                            <div className="flex-1 truncate text-sm font-medium">{c.name}</div>
                            <div className="text-sm font-bold tabular-nums">{c.vote_rate.toFixed(1)}%</div>
                            <div className="hidden sm:block text-[11px] text-[var(--muted)] w-20 text-right tabular-nums">{c.votes.toLocaleString()}표</div>
                          </div>
                        );
                      })}
                      <div className="flex h-2 rounded-full overflow-hidden mt-2 bg-[var(--muted-bg)]">
                        {y.top3.map((c, i) => {
                          const total = y.top3.reduce((s, x) => s + x.vote_rate, 0) || 1;
                          const w = (c.vote_rate / total) * 100;
                          const camp = c.party_camp || partyToCamp(c.party);
                          const color = camp === '진보' ? '#2563eb' : camp === '보수' ? '#dc2626' : '#9ca3af';
                          return <div key={i} style={{ width: `${w}%`, background: color }} />;
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <div className="card text-center text-[var(--muted)] py-12">시·군·구를 선택하세요.</div>
        )}
      </div>
    </div>
  );
}
