'use client';
import {
  groupByParent, childName, TIER_STYLE, CampTier,
  shadeFromGap, partyColor, campTierOf, partyToCamp,
} from './utils';

interface PartyCell {
  district: string;
  dominant_party: string;
  dominant_pct: number;
  latest_party: string;
  latest_rate: number;
  latest_year: number;
  margin: number;
  color?: string;
}
interface CampCell {
  district: string;
  tier: CampTier;
  dominant: string;
  progressive_rate: number;
  conservative_rate: number;
  gap: number;
  latest_winner: string;
  latest_winner_camp?: string;
  latest_year: number;
}

export type ViewMode = 'party' | 'camp';

interface Props {
  mode: ViewMode;
  sido: string;
  partyData?: { cells: PartyCell[]; party_counts: Record<string, number> } | null;
  campData?: { cells: CampCell[]; legend_counts: Record<string, number> } | null;
  onSelectDistrict?: (d: string) => void;
  periodLabel?: string;
}

export default function UnifiedHeatmap({
  mode, sido, partyData, campData, onSelectDistrict, periodLabel,
}: Props) {
  if (mode === 'party') {
    if (!partyData?.cells?.length) {
      return <div className="card text-center text-[var(--muted)] py-12">시·군·구 정당 데이터가 없습니다.</div>;
    }
    const grouped = groupByParent(partyData.cells, sido);
    return (
      <div className="space-y-4">
        <div className="card">
          <h3 className="text-base font-bold mb-3">정당별 시·군·구 점유 {periodLabel && <span className="text-xs text-[var(--muted)] font-normal">· {periodLabel}</span>}</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(partyData.party_counts)
              .sort((a, b) => b[1] - a[1])
              .map(([party, count]) => (
                <div key={party} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded" style={{ background: partyColor(party) }} />
                  <span className="text-xs">
                    <span className="font-semibold">{party}</span>
                    <span className="text-[var(--muted)] ml-1">{count}곳</span>
                  </span>
                </div>
              ))}
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-3">
            카드 색 진할수록 격차 큰 강세 지역. 연할수록 경합.
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
                    const color = c.color || partyColor(c.dominant_party);
                    const shade = shadeFromGap(c.margin || 0);
                    const display = isGroup ? childName(c.district, parent) : c.district;
                    return (
                      <button
                        key={c.district}
                        onClick={() => onSelectDistrict?.(c.district)}
                        className="rounded-lg border-2 p-3 hover:scale-105 transition-transform text-left text-white"
                        style={{ background: color, borderColor: color, opacity: shade }}
                        title={`${c.district} · 격차 ${c.margin}%p`}
                      >
                        <div className="font-bold text-sm truncate">{display}</div>
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

  // mode === 'camp'
  if (!campData?.cells?.length) {
    return <div className="card text-center text-[var(--muted)] py-12">진영 데이터가 없습니다.</div>;
  }
  const tiers: CampTier[] = ['진보강세', '진보우세', '경합', '보수우세', '보수강세'];
  const grouped = groupByParent(campData.cells, sido);

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-base font-bold mb-3">진영 강세 5단계 {periodLabel && <span className="text-xs text-[var(--muted)] font-normal">· {periodLabel}</span>}</h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          <span className="font-semibold text-blue-500">진보</span> = 더불어민주당 계열 · <span className="font-semibold text-red-500">보수</span> = 국민의힘 계열. 교육감처럼 무소속도 후보 출신 기준 분류.
        </p>
        <div className="flex flex-wrap gap-3">
          {tiers.map((t) => {
            const s = TIER_STYLE[t];
            const count = campData.legend_counts[t] || 0;
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
                  const display = isGroup ? childName(c.district, parent) : c.district;
                  return (
                    <button
                      key={c.district}
                      onClick={() => onSelectDistrict?.(c.district)}
                      className={`rounded-lg border-2 ${s.bg} ${s.border} ${s.text} p-3 hover:scale-105 transition-transform text-left`}
                      title={`${c.district} · 격차 ${c.gap}%p`}
                    >
                      <div className="font-bold text-sm truncate">{display}</div>
                      <div className="text-[11px] opacity-95 mt-1">
                        진보 {c.progressive_rate}% · 보수 {c.conservative_rate}%
                      </div>
                      <div className="text-[11px] font-semibold mt-1 opacity-95">격차 {c.gap}%p</div>
                      <div className="text-[11px] mt-1 opacity-90 truncate">최근 {c.latest_winner}</div>
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
