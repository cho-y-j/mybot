'use client';
import { useState, useEffect } from 'react';

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
    return <div className="card text-center text-gray-500 py-12">시·군·구 데이터가 없습니다.</div>;
  }

  const timeline = (selected && drilldown[selected]) || [];

  // raw 정당명 → 진영 매핑 (party_camp 누락 시 fallback)
  function partyToCamp(p?: string): string {
    if (!p) return '';
    if (/(더불어민주당|민주당|새정치민주연합|열린우리당|통합민주당|민주노동당|진보당|정의당|녹색당|조국혁신당|개혁|민중)/.test(p)) return '진보';
    if (/(국민의힘|한나라당|새누리당|미래통합당|자유한국당|새천년민주당|민주자유당|신한국당|한국당)/.test(p)) return '보수';
    return '';
  }
  function campBadge(camp?: string, party?: string) {
    const c = camp || partyToCamp(party);
    if (c === '진보') return 'bg-blue-600 text-white';
    if (c === '보수') return 'bg-red-600 text-white';
    return 'bg-gray-400 text-white';
  }
  function dominantBadge(d: string) {
    if (d === '진보') return 'bg-blue-600 text-white';
    if (d === '보수') return 'bg-red-600 text-white';
    return 'bg-gray-400 text-white';
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌측: 시군구 리스트 */}
      <div className="card lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-bold mb-3 sticky top-0 bg-white dark:bg-gray-900 py-1">시·군·구 ({districts.length})</h3>
        <div className="space-y-1">
          {districts.map((d) => {
            const isSel = d.district === selected;
            return (
              <button
                key={d.district}
                onClick={() => { setSelected(d.district); onSelect(d.district); }}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                  isSel
                    ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-700'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{d.district}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${dominantBadge(d.dominant)}`}>{d.dominant}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">격차 {d.margin}%p</div>
              </button>
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
              <div className="card text-center text-gray-500 py-8">이 시·군·구의 회차별 데이터가 없습니다.</div>
            ) : (
              timeline.map((y) => (
                <div key={y.year} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-bold">제{y.election_number}회 ({y.year})</div>
                      <div className="text-[11px] text-gray-500">후보 {y.candidates_count}명 · 격차 {y.margin}%p</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded font-bold ${campBadge(y.winner_camp, y.winner_party)}`}>
                      {y.winner_party || y.top3[0]?.name} 당선
                    </span>
                  </div>
                  <div className="space-y-2">
                    {y.top3.map((c, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="text-xs w-6 text-center font-bold text-gray-500">{i + 1}위</div>
                        {c.party && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${campBadge(c.party_camp, c.party)}`}>{c.party}</span>
                        )}
                        <div className="flex-1 truncate text-sm font-medium">{c.name}</div>
                        <div className="text-sm font-bold tabular-nums">{c.vote_rate.toFixed(1)}%</div>
                        <div className="hidden sm:block text-[11px] text-gray-500 w-20 text-right tabular-nums">{c.votes.toLocaleString()}표</div>
                      </div>
                    ))}
                    {/* 미니 막대 시각화 */}
                    <div className="flex h-2 rounded-full overflow-hidden mt-2">
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
              ))
            )}
          </>
        ) : (
          <div className="card text-center text-gray-500 py-12">시·군·구를 선택하세요.</div>
        )}
      </div>
    </div>
  );
}
