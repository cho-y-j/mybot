'use client';

interface Cell {
  district: string;
  strength: 'prog_strong' | 'prog_lean' | 'swing' | 'cons_lean' | 'cons_strong';
  margin: number;
  dominant: string;
  progressive_rate: number;
  conservative_rate: number;
  latest_year?: number;
}

interface StrengthGrid {
  cells: Cell[];
  legend_counts: Record<string, number>;
}

const TIER_STYLE: Record<Cell['strength'], { bg: string; border: string; label: string; text: string }> = {
  prog_strong: { bg: 'bg-blue-600', border: 'border-blue-700', label: '진보 강세', text: 'text-white' },
  prog_lean:   { bg: 'bg-blue-300', border: 'border-blue-400', label: '진보 우세', text: 'text-blue-900' },
  swing:       { bg: 'bg-amber-200', border: 'border-amber-300', label: '경합', text: 'text-amber-900' },
  cons_lean:   { bg: 'bg-red-300', border: 'border-red-400', label: '보수 우세', text: 'text-red-900' },
  cons_strong: { bg: 'bg-red-600', border: 'border-red-700', label: '보수 강세', text: 'text-white' },
};

export default function StrengthHeatmap({
  data,
  onSelectDistrict,
}: {
  data: StrengthGrid;
  onSelectDistrict?: (district: string) => void;
}) {
  if (!data || !data.cells?.length) {
    return <div className="card text-center text-gray-500 py-12">시·군·구 데이터가 없습니다.</div>;
  }

  const tiers: Cell['strength'][] = ['prog_strong', 'prog_lean', 'swing', 'cons_lean', 'cons_strong'];

  return (
    <div className="space-y-4">
      {/* 범례 */}
      <div className="card">
        <h3 className="text-base font-bold mb-3">정당 강세 5단계 분류</h3>
        <div className="flex flex-wrap gap-3">
          {tiers.map((t) => {
            const s = TIER_STYLE[t];
            const count = data.legend_counts[t] || 0;
            return (
              <div key={t} className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded ${s.bg} ${s.border} border`} />
                <span className="text-xs">
                  <span className="font-semibold">{s.label}</span>
                  <span className="text-gray-500 ml-1">{count}곳</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 히트맵 그리드 */}
      <div className="card">
        <h3 className="text-base font-bold mb-3">시·군·구 강세 지도 <span className="text-xs text-gray-500 font-normal">(클릭 → 드릴다운)</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {data.cells.map((c) => {
            const s = TIER_STYLE[c.strength];
            return (
              <button
                key={c.district}
                onClick={() => onSelectDistrict?.(c.district)}
                className={`rounded-lg border-2 ${s.bg} ${s.border} ${s.text} p-3 hover:scale-105 transition-transform text-left`}
              >
                <div className="font-bold text-sm truncate">{c.district}</div>
                <div className="text-[11px] opacity-90 mt-1">
                  진보 {c.progressive_rate}% · 보수 {c.conservative_rate}%
                </div>
                <div className="text-[11px] font-semibold mt-1">
                  격차 {c.margin}%p
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
