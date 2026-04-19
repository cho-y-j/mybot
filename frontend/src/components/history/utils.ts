/**
 * 과거 선거 화면 공용 유틸 — 범용 (전국 모든 지역)
 */

// 광역시 (자치구 그룹핑 불필요 — region_sido 자체가 이미 광역시)
const METRO_SIDOS = new Set([
  '서울특별시', '서울', '부산광역시', '부산', '대구광역시', '대구',
  '인천광역시', '인천', '광주광역시', '광주', '대전광역시', '대전',
  '울산광역시', '울산', '세종특별자치시', '세종',
]);

/**
 * "청주시상당구" → "청주시" / "수원시장안구" → "수원시" / "창원시마산합포구" → "창원시"
 * 공백 유무 모두 대응. "XX시" 또는 "XX군" 단독이면 원문 반환 (그룹 헤더 없음).
 */
export function parentCity(d: string): string {
  if (!d) return '';
  // "XX시YY구/군" 또는 "XX시 YY구/군" (공백 선택)
  const m = d.match(/^(.+?시)\s*(.+?[구군])$/);
  if (m) return m[1];
  return d;
}

/** 자식 표시명 — 부모 도시 제거 + 공백 정리 */
export function childName(d: string, parent: string): string {
  if (!d || parent === d) return d;
  return d.replace(parent, '').trim() || d;
}

export interface WithDistrict { district: string; [k: string]: any }

/**
 * region_sido 기준 범용 그룹핑.
 * - 광역시(서울/부산/...)이면 그룹 스킵 (자치구 전체가 한 그룹되어 의미 없음)
 * - 도 단위면 "XX시YY구" 를 XX시로 묶음, "XX군/XX시" 단독은 그대로
 */
export function groupByParent<T extends WithDistrict>(cells: T[], sido?: string): Array<[string, T[]]> {
  const isMetro = sido ? METRO_SIDOS.has(sido) : false;
  const map = new Map<string, T[]>();
  cells.forEach((c) => {
    const parent = isMetro ? c.district : parentCity(c.district);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(c);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
}

/**
 * 정당명 → 진영 (진보=민주 계열, 보수=국민의힘 계열)
 */
export function partyToCamp(party?: string): '진보' | '보수' | '' {
  if (!party) return '';
  if (/(더불어민주당|민주당|새정치민주연합|열린우리당|통합민주당|민주노동당|진보당|정의당|녹색당|조국혁신당|개혁|민중)/.test(party)) return '진보';
  if (/(국민의힘|한나라당|새누리당|미래통합당|자유한국당|새천년민주당|민주자유당|신한국당|한국당)/.test(party)) return '보수';
  return '';
}

/** 격차 기반 색 농도 (0~30%p를 0.35~1.0 로 매핑) */
export function shadeFromGap(gap: number): number {
  const clamped = Math.max(0, Math.min(30, gap || 0));
  return 0.35 + (clamped / 30) * 0.65;
}

/** 득표율 기반 색 농도 (20~70% → 0.4~1.0) */
export function shadeFromRate(rate: number): number {
  const clamped = Math.max(20, Math.min(70, rate || 0));
  return 0.4 + ((clamped - 20) / 50) * 0.6;
}

export type CampTier = '진보강세' | '진보우세' | '경합' | '보수우세' | '보수강세';

/** 진영별 득표율 → 5단계 tier */
export function campTierOf(progRate: number, consRate: number): CampTier {
  const gap = Math.abs(progRate - consRate);
  const dominant = progRate >= consRate ? '진보' : '보수';
  if (gap >= 20) return dominant === '진보' ? '진보강세' : '보수강세';
  if (gap >= 5) return dominant === '진보' ? '진보우세' : '보수우세';
  return '경합';
}

/** Tier 스타일 */
export const TIER_STYLE: Record<CampTier, { bg: string; border: string; text: string; solid: string }> = {
  진보강세: { bg: 'bg-blue-600', border: 'border-blue-700', text: 'text-white', solid: '#2563eb' },
  진보우세: { bg: 'bg-blue-300', border: 'border-blue-400', text: 'text-blue-900', solid: '#93c5fd' },
  경합:     { bg: 'bg-amber-200', border: 'border-amber-300', text: 'text-amber-900', solid: '#fcd34d' },
  보수우세: { bg: 'bg-red-300', border: 'border-red-400', text: 'text-red-900', solid: '#fca5a5' },
  보수강세: { bg: 'bg-red-600', border: 'border-red-700', text: 'text-white', solid: '#dc2626' },
};

/** 정당별 색상 (레거시 RawPartyHeatmap 용) */
export const PARTY_COLOR: Record<string, string> = {
  '더불어민주당': '#1e40af',
  '민주당': '#1e40af',
  '새정치민주연합': '#2563eb',
  '열린우리당': '#3b82f6',
  '국민의힘': '#dc2626',
  '자유한국당': '#dc2626',
  '새누리당': '#ef4444',
  '한나라당': '#f87171',
  '미래통합당': '#dc2626',
  '정의당': '#fbbf24',
  '진보당': '#fbbf24',
  '국민의당': '#7c3aed',
  '바른미래당': '#7c3aed',
  '자유선진당': '#0ea5e9',
  '국민중심당': '#0ea5e9',
  '민주평화당': '#10b981',
  '무소속': '#6b7280',
};

export function partyColor(p: string): string {
  return PARTY_COLOR[p?.trim() || ''] || '#9ca3af';
}
