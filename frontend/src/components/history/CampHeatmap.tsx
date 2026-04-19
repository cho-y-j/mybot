'use client';
import { groupByParent, TIER_STYLE, CampTier } from './utils';

interface Cell {
  district: string;
  tier: CampTier;
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

export default function CampHeatmap({
  data,
  onSelectDistrict,
}: {
  data: CampGrid;
  onSelectDistrict?: (d: string) => void;
}) {
  if (!data || !data.cells?.length) {
    return <div className="card text-center text-[var(--muted)] py-12">시·군·구 진영 데이터가 없습니다.</div>;
  }

  const tiers: CampTier[] = ['진보강세', '진보우세', '경합', '보수우세', '보수강세'];
  const grouped = groupByParent(data.cells);

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-base font-bold mb-3">진영 강세 5단계 분류</h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          정당이 없는 선거(교육감)나 진영 관점에서도 후보의 민주/국힘 출신 기준으로 시군 강세 파악
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
                  <span className="text-[var(--muted)] ml-1">{count}곳</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card space-y-5">
        <h3 className="text-base font-bold">시·군·구 진영 강세 <span className="text-xs text-[var(--muted)] font-normal">(클릭 → 드릴다운)</span></h3>
        {grouped.map(([parent, children]) => {
          const isGroup = children.length > 1;
          return (
            <section key={parent}>
              {isGroup && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px bg-[var(--card-border)] flex-1" />
                  <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider px-2">{parent} · {children.length}개 구</h4>
                  <div className="h-px bg-[var(--card-border)] flex-1" />
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {children.map((c) => {
                  const s = TIER_STYLE[c.tier];
                  const displayName = c.district.replace(parent, '').trim() || c.district;
                  return (
                    <button
                      key={c.district}
                      onClick={() => onSelectDistrict?.(c.district)}
                      className={`rounded-lg border-2 ${s.bg} ${s.border} ${s.text} p-3 hover:scale-105 transition-transform text-left`}
                      title={`${c.district} · 격차 ${c.gap}%p`}
                    >
                      <div className="font-bold text-sm truncate">{isGroup ? displayName : c.district}</div>
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
