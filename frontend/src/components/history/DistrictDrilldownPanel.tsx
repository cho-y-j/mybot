'use client';
import { useState, useEffect, useMemo } from 'react';
import { groupByParent, childName, shadeFromGap, partyToCamp } from './utils';

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
  yearFilter?: number | null;  // null/undefined = 전체 회차, 숫자 = 해당 년도만
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

  // 좌측 리스트 parent city 그룹핑
  const groupedList = useMemo(() => groupByParent(districts, sido), [districts, sido]);

  if (!districts.length) {
    return <div className="card text-center text-[var(--muted)] py-12">시·군·구 데이터가 없습니다.</div>;
  }

  const rawTimeline = (selected && drilldown[selected]) || [];
  // year 필터 적용
  const timeline = yearFilter != null
    ? rawTimeline.filter((y) => y.year === yearFilter)
    : rawTimeline;

  function campStyle(camp?: string, party?: string, rate?: number) {
    const c = camp || partyToCamp(party) || '';
    const opacity = rate !== undefined ? shadeFromGap(Math.abs(rate)) : 1;
    if (c === '진보') return { cls: 'bg-blue-600 text-white', opacity };
    if (c === '보수') return { cls: 'bg-red-600 text-white', opacity };
    return { cls: 'bg-[var(--muted-bg)] text-[var(--muted)]', opacity: 0.8 };
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌측: 시·군·구 리스트 (parent 그룹핑) */}
      <div className="card lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-bold mb-3 sticky top-0 bg-[var(--card-bg)] py-1 z-10">
          시·군·구 · {districts.length}
          {yearFilter != null && <span className="ml-2 text-[10px] text-blue-500 font-normal">· {yearFilter}년</span>}
        </h3>
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
                  {children.map((d: any) => {
                    const isSel = d.district === selected;
                    const style = campStyle(d.dominant, undefined, d.margin);
                    const display = isGroup ? childName(d.district, parent) : d.district;
                    return (
                      <button
                        key={d.district}
                        onClick={() => { setSelected(d.district); onSelect(d.district); }}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          isSel
                            ? 'bg-blue-500/10 border-blue-500/40'
                            : 'border-[var(--card-border)] hover:bg-[var(--muted-bg)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{display}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${style.cls}`}
                            style={{ opacity: style.opacity }}
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

      {/* 우측: 선택된 시군의 회차별 결과 */}
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
                const winnerStyle = campStyle(y.winner_camp, y.winner_party, y.margin);
                return (
                  <div key={y.year} className="card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-bold">제{y.election_number}회 ({y.year})</div>
                        <div className="text-[11px] text-[var(--muted)]">후보 {y.candidates_count}명 · 격차 {y.margin}%p</div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded font-bold ${winnerStyle.cls}`}
                        style={{ opacity: winnerStyle.opacity }}
                        title={`격차 ${y.margin}%p 클수록 진함`}
                      >
                        {y.winner_party || y.top3[0]?.name} 당선
                      </span>
                    </div>
                    <div className="space-y-2">
                      {y.top3.map((c, i) => {
                        const partyStyle = campStyle(c.party_camp, c.party, 20 - Math.abs((y.top3[0]?.vote_rate ?? 0) - c.vote_rate));
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <div className="text-xs w-6 text-center font-bold text-[var(--muted)]">{i + 1}위</div>
                            {c.party && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${partyStyle.cls}`}
                                style={{ opacity: partyStyle.opacity }}
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
