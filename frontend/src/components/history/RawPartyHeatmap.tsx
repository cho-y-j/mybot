'use client';

interface Cell {
  district: string;
  latest_party: string;
  latest_rate: number;
  latest_year: number;
  dominant_party: string;
  dominant_pct: number;
  margin: number;
  color: string;
}

interface RawPartyGrid {
  cells: Cell[];
  party_counts: Record<string, number>;
}

export default function RawPartyHeatmap({
  data,
  onSelectDistrict,
}: {
  data: RawPartyGrid;
  onSelectDistrict?: (d: string) => void;
}) {
  if (!data || !data.cells?.length) {
    return <div className="card text-center text-gray-500 py-12">시·군·구 정당 데이터가 없습니다.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-base font-bold mb-3">정당별 시·군·구 점유</h3>
        <div className="flex flex-wrap gap-3">
          {Object.entries(data.party_counts)
            .sort((a, b) => b[1] - a[1])
            .map(([party, count]) => {
              const sample = data.cells.find((c) => c.dominant_party === party);
              return (
                <div key={party} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded" style={{ background: sample?.color || '#9ca3af' }} />
                  <span className="text-xs">
                    <span className="font-semibold">{party}</span>
                    <span className="text-gray-500 ml-1">{count}곳</span>
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-bold mb-3">시·군·구 정당 강세 <span className="text-xs text-gray-500 font-normal">(클릭 → 드릴다운)</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {data.cells.map((c) => (
            <button
              key={c.district}
              onClick={() => onSelectDistrict?.(c.district)}
              className="rounded-lg border-2 p-3 hover:scale-105 transition-transform text-left text-white"
              style={{ background: c.color, borderColor: c.color }}
            >
              <div className="font-bold text-sm truncate">{c.district}</div>
              <div className="text-[11px] opacity-95 mt-1 truncate">우세: {c.dominant_party}</div>
              <div className="text-[11px] opacity-90">{c.dominant_pct}% 당선</div>
              <div className="text-[11px] mt-1 font-semibold opacity-95">
                최근 {c.latest_party} {c.latest_rate.toFixed(1)}%
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
