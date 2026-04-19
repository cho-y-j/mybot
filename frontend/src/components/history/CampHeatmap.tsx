'use client';

interface Cell {
  district: string;
  tier: '진보강세' | '진보우세' | '경합' | '보수우세' | '보수강세';
  dominant: string;
  progressive_rate: number;
  conservative_rate: number;
  gap: number;
  latest_winner: string;
  latest_winner_camp: string;
  latest_year: number;
}

interface CampGrid {
  cells: Cell[];
  legend_counts: Record<string, number>;
}

const TIER_STYLE: Record<Cell['tier'], { bg: string; border: string; text: string }> = {
  진보강세: { bg: 'bg-blue-600', border: 'border-blue-700', text: 'text-white' },
  진보우세: { bg: 'bg-blue-300', border: 'border-blue-400', text: 'text-blue-900' },
  경합: { bg: 'bg-amber-200', border: 'border-amber-300', text: 'text-amber-900' },
  보수우세: { bg: 'bg-red-300', border: 'border-red-400', text: 'text-red-900' },
  보수강세: { bg: 'bg-red-600', border: 'border-red-700', text: 'text-white' },
};

export default function CampHeatmap({
  data,
  onSelectDistrict,
}: {
  data: CampGrid;
  onSelectDistrict?: (d: string) => void;
}) {
  if (!data || !data.cells?.length) {
    return <div className="card text-center text-gray-500 py-12">시·군·구 진영 데이터가 없습니다.</div>;
  }

  const tiers: Cell['tier'][] = ['진보강세', '진보우세', '경합', '보수우세', '보수강세'];

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-base font-bold mb-3">진영 강세 5단계 분류</h3>
        <p className="text-xs text-gray-500 mb-3">
          교육감처럼 정당이 없는 선거도 후보 진영(민주당 출신=진보, 국힘 출신=보수)으로 분류해서 시군 강세 파악
        </p>
        <div className="flex flex-wrap gap-3">
          {tiers.map((t) => {
            const s = TIER_STYLE[t];
            const count = data.legend_counts[t] || 0;
            return (
              <div key={t} className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded ${s.bg} ${s.border} border`} />
                <span className="text-xs">
                  <span className="font-semibold">{t}</span>
                  <span className="text-gray-500 ml-1">{count}곳</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-bold mb-3">시·군·구 진영 강세 <span className="text-xs text-gray-500 font-normal">(클릭 → 드릴다운)</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {data.cells.map((c) => {
            const s = TIER_STYLE[c.tier];
            return (
              <button
                key={c.district}
                onClick={() => onSelectDistrict?.(c.district)}
                className={`rounded-lg border-2 ${s.bg} ${s.border} ${s.text} p-3 hover:scale-105 transition-transform text-left`}
              >
                <div className="font-bold text-sm truncate">{c.district}</div>
                <div className="text-[11px] opacity-95 mt-1">
                  진보 {c.progressive_rate}% · 보수 {c.conservative_rate}%
                </div>
                <div className="text-[11px] font-semibold mt-1 opacity-95">
                  격차 {c.gap}%p
                </div>
                <div className="text-[11px] mt-1 opacity-90 truncate">
                  최근 {c.latest_winner}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
