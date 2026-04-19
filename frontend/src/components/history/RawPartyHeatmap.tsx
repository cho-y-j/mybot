'use client';
import { groupByParent, shadeFromGap } from './utils';

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
    return <div className="card text-center text-[var(--muted)] py-12">시·군·구 정당 데이터가 없습니다.</div>;
  }

  const grouped = groupByParent(data.cells);

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
                    <span className="text-[var(--muted)] ml-1">{count}곳</span>
                  </span>
                </div>
              );
            })}
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-3">
          카드 색 진할수록 격차 크고 확실한 강세. 연할수록 경합 지역. 클릭 시 상세로 이동.
        </p>
      </div>

      <div className="card space-y-5">
        <h3 className="text-base font-bold">시·군·구 정당 강세 <span className="text-xs text-[var(--muted)] font-normal">(클릭 → 드릴다운)</span></h3>
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
                  const shade = shadeFromGap(c.margin || 0);
                  const displayName = c.district.replace(parent, '').trim() || c.district;
                  return (
                    <button
                      key={c.district}
                      onClick={() => onSelectDistrict?.(c.district)}
                      className="rounded-lg border-2 p-3 hover:scale-105 transition-transform text-left text-white"
                      style={{
                        background: c.color,
                        borderColor: c.color,
                        opacity: shade,
                      }}
                      title={`${c.district} · 격차 ${c.margin}%p`}
                    >
                      <div className="font-bold text-sm truncate">{isGroup ? displayName : c.district}</div>
                      <div className="text-[11px] opacity-95 mt-1 truncate">우세: {c.dominant_party}</div>
                      <div className="text-[11px] opacity-90">{c.dominant_pct === 100 ? '전 회차 석권' : `${c.dominant_pct}% 회차 승리`}</div>
                      <div className="text-[11px] mt-1 font-semibold opacity-95">
                        최근 {c.latest_party} {c.latest_rate.toFixed(1)}%
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
