'use client';
import {
  TIER_STYLE, CampTier, shadeFromGap, partyColor, partyToCamp, parentCity,
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

// 같은 tier 색상을 "보편적 진영색"으로 통일 — 어떤 선거든 동일 룰
// 보수 강세 = 진한 빨강, 보수 약세(우세) = 연한 빨강, 경합 = 앰버, 진보 우세 = 연한 파랑, 진보 강세 = 진한 파랑
const TIER_HEX: Record<CampTier, string> = {
  진보강세: '#2563eb',  // blue-600
  진보우세: '#93c5fd',  // blue-300
  경합:     '#fcd34d',  // amber-300
  보수우세: '#fca5a5',  // red-300
  보수강세: '#dc2626',  // red-600
};
const TIER_TEXT_ON: Record<CampTier, string> = {
  진보강세: 'text-white',
  진보우세: 'text-blue-900',
  경합:     'text-amber-900',
  보수우세: 'text-red-900',
  보수강세: 'text-white',
};

function shortName(district: string): string {
  const p = parentCity(district);
  if (p === district) return district;
  // 청주시상당구 → "청주시 상당구" (공백 1개)
  return district.replace(p, p + ' ');
}

export default function UnifiedHeatmap({
  mode, sido, partyData, campData, onSelectDistrict, periodLabel,
}: Props) {
  // 두 모드 모두 공용 grid로 렌더. 차이는 색 뱃지·추가 정보만.
  const tiers: CampTier[] = ['진보강세', '진보우세', '경합', '보수우세', '보수강세'];
  const campCells: CampCell[] = campData?.cells || [];
  const partyCells: PartyCell[] = partyData?.cells || [];
  const legendCounts = campData?.legend_counts || {};

  // party 모드 시에도 district별 tier(진영)를 campData에서 매핑해서 배경색 적용 → 통일성
  const tierMap = new Map<string, CampTier>();
  campCells.forEach((c) => tierMap.set(c.district, c.tier));

  // 렌더 대상 선택 (모드별)
  const cells = mode === 'party' ? partyCells : campCells;
  if (!cells.length) {
    return <div className="card text-center text-[var(--muted)] py-12">시·군·구 데이터가 없습니다.</div>;
  }

  return (
    <div className="space-y-4">
      {/* 범례 — 항상 5단계 진영색 (보편) */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h3 className="text-base font-bold">
            시·군·구 {mode === 'party' ? '정당 강세' : '진영 강세'}
            {periodLabel && <span className="text-xs text-[var(--muted)] font-normal ml-2">· {periodLabel}</span>}
          </h3>
          <span className="text-xs text-[var(--muted)]">카드 클릭 → 드릴다운</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {tiers.map((t) => {
            const count = legendCounts[t] || 0;
            return (
              <div key={t} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ background: TIER_HEX[t] }} />
                <span className="font-semibold">{t}</span>
                {count > 0 && <span className="text-[var(--muted)]">{count}곳</span>}
              </div>
            );
          })}
        </div>
        {mode === 'camp' && (
          <p className="text-[10px] text-[var(--muted)] mt-3">
            <span className="font-semibold text-blue-600">진보</span> = 더불어민주당 계열 · <span className="font-semibold text-red-600">보수</span> = 국민의힘 계열. 교육감 등 무소속도 후보 출신 기준 분류.
          </p>
        )}
        {mode === 'party' && (
          <p className="text-[10px] text-[var(--muted)] mt-3">
            배경색은 진영(진보/보수)을 기준으로 통일. 카드 내부 뱃지가 실제 정당 표시.
          </p>
        )}
      </div>

      {/* ─── 한 grid로 전체 시군구 나열 (섹션 분리 X) ─── */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {cells.map((c) => {
            const district = c.district;
            const tier = tierMap.get(district);
            // 진영 tier가 있으면 그 색, 없으면 경합 기본
            const tierColor = tier ? TIER_HEX[tier] : TIER_HEX['경합'];
            const textCls = tier ? TIER_TEXT_ON[tier] : 'text-amber-900';

            if (mode === 'camp') {
              const cc = c as CampCell;
              return (
                <button
                  key={district}
                  onClick={() => onSelectDistrict?.(district)}
                  className={`rounded-lg border-2 p-3 hover:scale-105 transition-transform text-left ${textCls}`}
                  style={{ background: tierColor, borderColor: tierColor }}
                  title={`${district} · 격차 ${cc.gap}%p`}
                >
                  <div className="font-bold text-sm truncate">{shortName(district)}</div>
                  <div className="text-[11px] opacity-95 mt-1">진보 {cc.progressive_rate}% · 보수 {cc.conservative_rate}%</div>
                  <div className="text-[11px] font-semibold mt-1 opacity-95">{cc.tier} · 격차 {cc.gap}%p</div>
                  <div className="text-[11px] mt-1 opacity-90 truncate">최근 {cc.latest_winner}</div>
                </button>
              );
            }

            // party 모드
            const pc = c as PartyCell;
            return (
              <button
                key={district}
                onClick={() => onSelectDistrict?.(district)}
                className={`rounded-lg border-2 p-3 hover:scale-105 transition-transform text-left ${textCls}`}
                style={{ background: tierColor, borderColor: tierColor }}
                title={`${district} · 1위 ${pc.dominant_party} · 격차 ${pc.margin}%p`}
              >
                <div className="font-bold text-sm truncate">{shortName(district)}</div>
                <div className="mt-1">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: 'rgba(255,255,255,0.85)', color: partyColor(pc.dominant_party) }}
                  >
                    {pc.dominant_party}
                  </span>
                </div>
                <div className="text-[11px] opacity-90 mt-1">{pc.dominant_pct === 100 ? '전 회차 석권' : `${pc.dominant_pct}% 회차 승리`}</div>
                <div className="text-[11px] mt-1 opacity-95">최근 {pc.latest_rate.toFixed(1)}%</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
