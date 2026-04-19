/**
 * 과거 선거 화면 공용 유틸
 */

// "청주시 상당구" → "청주시", "충주시" → "충주시"
export function parentCity(d: string): string {
  if (!d) return '';
  // "XX시 YY구/군" 패턴
  const m = d.match(/^(.+?시)\s+.+[구군]$/);
  if (m) return m[1];
  return d;
}

export interface WithDistrict { district: string; [k: string]: any }

/**
 * parent city 별로 그룹핑. 단일 도시는 그대로, 청주시 4구 같은 것만 그룹화.
 * 반환: [[parent, children[]], ...] — parent가 자식 1개(자기 자신)면 그룹 헤더 없이 단독 렌더 대상.
 */
export function groupByParent<T extends WithDistrict>(cells: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  cells.forEach((c) => {
    const parent = parentCity(c.district);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(c);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
}

/**
 * 진영 분류 (raw 정당명 → 진보/보수/기타)
 * DistrictDrilldownPanel 의 partyToCamp 와 동일 규칙 공용화
 */
export function partyToCamp(party?: string): '진보' | '보수' | '' {
  if (!party) return '';
  if (/(더불어민주당|민주당|새정치민주연합|열린우리당|통합민주당|민주노동당|진보당|정의당|녹색당|조국혁신당|개혁|민중)/.test(party)) return '진보';
  if (/(국민의힘|한나라당|새누리당|미래통합당|자유한국당|새천년민주당|민주자유당|신한국당|한국당)/.test(party)) return '보수';
  return '';
}

/**
 * 격차(%p) 기반 색 농도 — 상세 드릴다운용
 * 격차가 클수록 진하게 (강세), 작을수록 흐리게 (경합)
 * 반환: 0.35 ~ 1.0
 */
export function shadeFromGap(gap: number): number {
  const clamped = Math.max(0, Math.min(30, gap));
  return 0.35 + (clamped / 30) * 0.65;
}

/**
 * 득표율 기반 색 농도 — 단일 후보/정당 카드용
 * 반환: 0.4 ~ 1.0
 */
export function shadeFromRate(rate: number): number {
  const clamped = Math.max(20, Math.min(70, rate));
  return 0.4 + ((clamped - 20) / 50) * 0.6;
}

/**
 * 진영별 5단계 tier 결정 (gap 기반)
 */
export type CampTier = '진보강세' | '진보우세' | '경합' | '보수우세' | '보수강세';

export function campTierOf(progRate: number, consRate: number): CampTier {
  const gap = Math.abs(progRate - consRate);
  const dominant = progRate >= consRate ? '진보' : '보수';
  if (gap >= 20) return dominant === '진보' ? '진보강세' : '보수강세';
  if (gap >= 5) return dominant === '진보' ? '진보우세' : '보수우세';
  return '경합';
}

/**
 * Tier → Tailwind 스타일 (CampHeatmap과 공유)
 */
export const TIER_STYLE: Record<CampTier, { bg: string; border: string; text: string; chip: string }> = {
  진보강세: { bg: 'bg-blue-600', border: 'border-blue-700', text: 'text-white', chip: 'bg-blue-600 text-white' },
  진보우세: { bg: 'bg-blue-500/40', border: 'border-blue-500/60', text: 'text-blue-700 dark:text-blue-300', chip: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
  경합:     { bg: 'bg-amber-500/40', border: 'border-amber-500/60', text: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-500/20 text-amber-600' },
  보수우세: { bg: 'bg-red-500/40', border: 'border-red-500/60', text: 'text-red-700 dark:text-red-300', chip: 'bg-red-500/20 text-red-600 dark:text-red-400' },
  보수강세: { bg: 'bg-red-600', border: 'border-red-700', text: 'text-white', chip: 'bg-red-600 text-white' },
};
