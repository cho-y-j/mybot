'use client';

interface BestDistrict {
  district: string;
  year: number;
  rate: number;
}

interface CandidateInfo {
  name: string;
  appearances: number;
  wins: number;
  avg_rate: number;
  best_districts: BestDistrict[];
}

export default function CandidateStrongholds({
  candidates,
  campMap,
}: {
  candidates: CandidateInfo[];
  campMap?: Record<string, string>; // optional: name -> 진보/보수
}) {
  if (!candidates?.length) {
    return <div className="card text-center text-gray-500 py-12">후보 데이터가 없습니다.</div>;
  }

  function campBadge(name: string) {
    const camp = campMap?.[name];
    if (camp === '진보') return 'bg-blue-600 text-white';
    if (camp === '보수') return 'bg-red-600 text-white';
    return 'bg-gray-400 text-white';
  }

  return (
    <div className="card">
      <h3 className="text-base font-bold mb-1">역대 후보별 강세 (Top 10)</h3>
      <p className="text-xs text-gray-500 mb-4">평균 득표율 순. 후보별 가장 강했던 시·군·구 Top 3.</p>
      <div className="space-y-3">
        {candidates.slice(0, 10).map((c) => (
          <div key={c.name} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {campMap?.[c.name] && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${campBadge(c.name)}`}>
                    {campMap[c.name]}
                  </span>
                )}
                <span className="font-bold">{c.name}</span>
              </div>
              <div className="text-xs text-gray-500">
                평균 <span className="font-bold text-violet-600">{c.avg_rate}%</span> · 출마 {c.appearances} · 당선 {c.wins}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.best_districts.map((d, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
                  {d.district} ({d.year}) <strong>{d.rate.toFixed(1)}%</strong>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
