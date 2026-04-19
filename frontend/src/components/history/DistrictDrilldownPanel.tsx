'use client';
import { useState, useEffect } from 'react';
import { parentCity, groupByParent, shadeFromGap, partyToCamp } from './utils';

interface Top3 {
  name: string;
  party: string; // raw 정당명 (e.g. "더불어민주당")
  party_camp?: string; // 진보/보수/기타
  vote_rate: number;
  votes: number;
  is_winner: boolean;
}

interface YearEntry {
  year: number;
  election_number: number | null;
  top3: Top3[];
  winner_party: string; // raw
  winner_camp?: string; // 진보/보수/기타
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

export default function DistrictDrilldownPanel({
  drilldown,
  cells,
  selectedDistrict,
  onSelect,
}: {
  drilldown: Record<string, YearEntry[]>;
  cells: DistrictCell[];
  selectedDistrict: string | null;
  onSelect: (d: string) => void;
}) {
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

  const timeline = (selected && drilldown[selected]) || [];

  // 좌측 리스트 parent 그룹핑
  const groupedList = groupByParent(districts);

  function campStyle(camp: string | undefined, rate?: number): { bg: string; text: string; opacity: number } {
    const c = camp || '';
    const opacity = rate !== undefined ? shadeFromGap(Math.abs(rate)) : 1;
    if (c === '진보') return { bg: 'bg-blue-600', text: 'text-white', opacity };
    if (c === '보수') return { bg: 'bg-red-600', text: 'text-white', opacity };
    return { bg: 'bg-[var(--muted-bg)]', text: 'text-[var(--muted)]', opacity: 0.7 };
  }
  function campBadge(camp?: string, party?: string, rate?: number) {
    const c = camp || partyToCamp(party);
    const s = campStyle(c, rate);
    return { cls: `${s.bg} ${s.text}`, opacity: s.opacity };
  }
  function dominantBadge(d: string, margin?: number) {
    const s = campStyle(d, margin);
    return { cls: `${s.bg} ${s.text}`, opacity: s.opacity };
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌측: 시군구 리스트 — parent city 그룹핑 + 격차 색 강도 */}
      <div className="card lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-bold mb-3 sticky top-0 bg-[var(--card-bg)] py-1 z-10">시·군·구 · {districts.length}</h3>
        <div className="space-y-3">
          {groupedList.map(([parent, children]) => {
            const isGroup = children.length > 1;
            return (
              <div key={parent}>
                {isGroup && (
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1 px-1">
                    {parent} · {children.length}
                  </div>
                )}
                <div className="space-y-1">
                  {children.map((d) => {
                    const isSel = d.district === selected;
                    const badge = dominantBadge(d.dominant, d.margin);
                    const displayName = isGroup ? (d.district.replace(parent, '').trim() || d.district) : d.district;
                    return (
                      <button
                        key={d.district}
                        onClick={() => { setSelected(d.district); onSelect(d.district); }}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          isSel
                            ? 'bg-blue-500/10 border-blue-500/40'
                            : 'border-[var(--card-border)] hover:bg-[var(--muted-bg)]/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{displayName}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${badge.cls}`}
                            style={{ opacity: badge.opacity }}
                          >
                            {d.dominant}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--muted)] mt-0.5">격차 {d.margin}%p</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 우측: 선택된 시군의 5회분 결과 */}
      <div className="lg:col-span-2 space-y-3">
        {selected ? (
          <>
            <div className="card">
              <h3 className="text-lg font-bold">{selected}</h3>
              <p className="text-xs text-gray-500 mt-1">{timeline.length}회 선거 기록</p>
            </div>
            {timeline.length === 0 ? (
              <div className="card text-center text-[var(--muted)] py-8">이 시·군·구의 회차별 데이터가 없습니다.</div>
            ) : (
              timeline.map((y) => {
                const winnerBadge = campBadge(y.winner_camp, y.winner_party, y.margin);
                return (
                  <div key={y.year} className="card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-bold">제{y.election_number}회 ({y.year})</div>
                        <div className="text-[11px] text-[var(--muted)]">후보 {y.candidates_count}명 · 격차 {y.margin}%p</div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded font-bold ${winnerBadge.cls}`}
                        style={{ opacity: winnerBadge.opacity }}
                        title={`격차 ${y.margin}%p — 격차 클수록 진함`}
                      >
                        {y.winner_party || y.top3[0]?.name} 당선
                      </span>
                    </div>
                    <div className="space-y-2">
                      {y.top3.map((c, i) => {
                        // 후보별 격차: 1위와의 득표율 차이로 색 농도 산출
                        const gapFromWinner = Math.abs((y.top3[0]?.vote_rate ?? 0) - c.vote_rate);
                        const partyBadge = campBadge(c.party_camp, c.party, i === 0 ? y.margin : 20 - gapFromWinner);
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
                      {/* 미니 막대 시각화 — 진영별 색상 + 득표율 비례 */}
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
          <div className="card text-center text-gray-500 py-12">시·군·구를 선택하세요.</div>
        )}
      </div>
    </div>
  );
}
