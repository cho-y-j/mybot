'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';

const PARTY_COLOR: Record<string, string> = {
  '더불어민주당': '#1e40af',
  '민주당': '#1e40af',
  '국민의힘': '#dc2626',
  '자유한국당': '#dc2626',
  '새누리당': '#ef4444',
  '한나라당': '#f87171',
  '정의당': '#fbbf24',
  '진보당': '#fbbf24',
  '국민의당': '#7c3aed',
  '무소속': '#6b7280',
};

function partyColor(p: string) { return PARTY_COLOR[p?.trim() || ''] || '#9ca3af'; }

export default function DongDrilldown({
  electionId,
  year,
  initialSigungu,
}: {
  electionId: string;
  year?: number | null;
  initialSigungu?: string | null;
}) {
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
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d?.data?.length) {
          // initialSigungu가 있고 데이터에 존재하면 그걸 선택, 아니면 첫 번째
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
        <div className="animate-spin h-6 w-6 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-3" />
        <div className="text-sm text-gray-500">동 단위 데이터 로딩...</div>
      </div>
    );
  }

  if (error || !data?.available) {
    return (
      <div className="card text-center py-10">
        <div className="text-base font-bold text-gray-700 dark:text-gray-300 mb-2">동·읍·면 단위 데이터 없음</div>
        <p className="text-xs text-gray-500">{data?.error || error}</p>
        <p className="text-xs text-gray-400 mt-2">관리자가 data.go.kr fileData(XLSX)를 import해야 사용 가능합니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-bold">읍·면·동 단위 강세 분석</h3>
            <p className="text-xs text-gray-500 mt-1">
              {data.year}년 {data.region} · 시·군·구를 선택해서 동·면별 후보 득표를 비교하세요.
            </p>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300">
            data.go.kr 공공 fileData
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 좌측: 시·군·구 리스트 */}
        <div className="card lg:max-h-[700px] overflow-y-auto">
          <h4 className="text-sm font-bold mb-3 sticky top-0 bg-white dark:bg-gray-900 py-1">시·군·구 ({sigunguList.length})</h4>
          <div className="space-y-1">
            {sigunguList.map((s: any) => {
              const isSel = s.sigungu === selectedSigungu;
              return (
                <button
                  key={s.sigungu}
                  onClick={() => setSelectedSigungu(s.sigungu)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    isSel
                      ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-700'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="font-semibold text-sm truncate">{s.sigungu}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.dong_count} 동·면</div>
                </button>
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
                  <p className="text-xs text-gray-500 mt-1">{selectedData.dong_count} 개 읍·면·동 / 후보별 득표 정렬</p>
                </div>
                <input
                  type="text"
                  placeholder="동·면 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 w-40"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredDongs.map((dong: any) => {
                  const winner = dong.winner;
                  const wColor = partyColor(winner?.party || '');
                  const top2 = dong.candidates.slice(0, 2);
                  const sumTop2 = top2.reduce((s: number, c: any) => s + (c.vote_rate || 0), 0) || 1;
                  return (
                    <div key={dong.name} className="card border-l-4" style={{ borderLeftColor: wColor }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold text-sm">{dong.name}</div>
                        <span className="text-[11px] text-gray-500">격차 {dong.margin}%p</span>
                      </div>
                      <div className="space-y-1.5">
                        {dong.candidates.slice(0, 4).map((c: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="text-[10px] w-5 text-gray-500 text-center">{i + 1}</div>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded text-white font-bold whitespace-nowrap"
                              style={{ background: partyColor(c.party) }}
                            >
                              {c.party}
                            </span>
                            <div className="flex-1 truncate text-xs font-medium">{c.candidate_name}</div>
                            <div className="text-xs font-bold tabular-nums">{c.vote_rate?.toFixed(1)}%</div>
                          </div>
                        ))}
                      </div>
                      {/* 1·2위 격차 시각화 */}
                      {top2.length === 2 && (
                        <div className="flex h-1.5 rounded-full overflow-hidden mt-2">
                          {top2.map((c: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                width: `${(c.vote_rate / sumTop2) * 100}%`,
                                background: partyColor(c.party),
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filteredDongs.length === 0 && (
                <div className="card text-center text-gray-500 py-8 text-sm">검색 결과 없음</div>
              )}
            </>
          ) : (
            <div className="card text-center text-gray-500 py-12">시·군·구를 선택하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}
