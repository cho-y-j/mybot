'use client';
/**
 * 과거 선거 지역별 영향력 히트맵 — Leaflet + 3단 줌 (시·도 → 시·군·구 → 읍·면·동)
 *
 * 핵심: 후보별 표심 + 인구·선거인을 결합한 "영향력 점수"로 폴리곤 색칠
 *   - 빨강(회복 가능): 인구 큰데 우리 진영 패배 — 자원 투입 1순위
 *   - 파랑(사수 거점): 인구 큰데 우리 진영 승리 — 사수 필요
 *   - 회색: 인구 작아 영향력 미미
 *
 * 줌 레벨에 따라 색칠 단위 자동 변경:
 *   - z ≤ 9 (시·도 전체): 같은 sido 동들을 시·도 영향력 색
 *   - z 10~12 (시·군·구): 같은 sgg 동들을 시·군·구 영향력 색
 *   - z ≥ 13 (읍·면·동): 동 단위 영향력 색
 *
 * GeoJSON은 schedules_v2 endpoint 재사용 — 같은 election scope.
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { LatLngExpression } from 'leaflet';

interface Slot {
  name: string;
  party?: string;
  votes: number;
}

interface RegionStats {
  population?: number;
  voters_est?: number;
  top1?: Slot | null;
  top2?: Slot | null;
  gap?: number | null;
  our_score?: number | null;
  total_votes?: number | null;
  turnout_est?: number | null;
}

interface SidoStat extends RegionStats {
  name: string;
  sido_cd: string;
}
interface SigunguStat extends RegionStats {
  name: string;
  sido_name: string;
}
interface DongStat extends RegionStats {
  adm_cd: string;
  adm_nm: string;
  sido_cd: string;
  sigungu_cd: string;
}

interface HeatmapStats {
  voter_ratio: number;
  sido: SidoStat[];
  sigungu: SigunguStat[];
  dong: DongStat[];
  election_year_used?: number;
  election_type_used?: string;
  region_sido_used?: string;
  our_camp_used?: string;
}

const LeafletMap: any = dynamic(
  async () => {
    const RL = await import('react-leaflet');
    const L = await import('leaflet');
    // leaflet CSS는 globals.css 에서 이미 import됨 (mybot frontend)

    const InnerController = ({ onZoom, bounds }: any) => {
      const map = RL.useMap();
      const boundsKey = bounds ? bounds.flat().join(',') : '';
      useEffect(() => {
        const t = setTimeout(() => {
          map.invalidateSize();
          if (bounds) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
          }
        }, 80);
        return () => clearTimeout(t);
      }, [map, boundsKey]);
      useEffect(() => {
        const handler = () => onZoom?.(map.getZoom());
        map.on('zoomend', handler);
        onZoom?.(map.getZoom());
        return () => { map.off('zoomend', handler); };
      }, [map]);
      return null;
    };

    const Wrapper = ({ center, zoom, bounds, onZoom, children }: any) => (
      <RL.MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <InnerController onZoom={onZoom} bounds={bounds} />
        {children}
      </RL.MapContainer>
    );
    (Wrapper as any).TileLayer = RL.TileLayer;
    (Wrapper as any).GeoJSON = RL.GeoJSON;
    (Wrapper as any).L = L;
    return Wrapper;
  },
  { ssr: false, loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">지도 로딩 중...</div>
  ) },
);

interface Props {
  electionId: string;
}

export default function HistoryHeatmap({ electionId }: Props) {
  const router = useRouter();
  const [geojson, setGeojson] = useState<any>(null);
  const [stats, setStats] = useState<HeatmapStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(9);
  const [selected, setSelected] = useState<{ level: 'sido'|'sigungu'|'dong'; key: string } | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);

  // 사용 가능 연도 + GeoJSON 1회 로드
  useEffect(() => {
    if (!electionId) return;
    const auth = () => ({
      headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
    });
    Promise.all([
      fetch(`/api/candidate-schedules/${electionId}/geojson?days=60&precision=5`, auth()).then(r => r.json()),
      fetch(`/api/history/available-years?election_id=${electionId}`, auth()).then(r => r.json()),
    ]).then(([g, y]) => {
      setGeojson(g);
      const yrs = y?.years || [];
      setYears(yrs);
      if (yrs.length > 0 && year === null) setYear(yrs[0]);
    }).catch(() => {});
  }, [electionId]);

  // 연도 변경 시 stats fetch
  useEffect(() => {
    if (!electionId || year === null) return;
    setLoading(true);
    const auth = () => ({
      headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
    });
    fetch(`/api/history/heatmap-stats?election_id=${electionId}&election_year=${year}`, auth())
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [electionId, year]);

  // 빠른 lookup 맵
  const sidoMap = useMemo(() => {
    const m = new Map<string, SidoStat>();
    stats?.sido?.forEach(s => { if (s.sido_cd) m.set(s.sido_cd, s); });
    return m;
  }, [stats]);

  const sigunguMap = useMemo(() => {
    const m = new Map<string, SigunguStat>();
    stats?.sigungu?.forEach(s => m.set(s.name, s));
    return m;
  }, [stats]);

  const dongMap = useMemo(() => {
    const m = new Map<string, DongStat>();
    stats?.dong?.forEach(d => { if (d.adm_cd) m.set(d.adm_cd, d); });
    return m;
  }, [stats]);

  // 줌 레벨에 따라 색상 단위 결정
  const colorLevel: 'sido' | 'sigungu' | 'dong' =
    zoom <= 9 ? 'sido' : zoom <= 12 ? 'sigungu' : 'dong';

  // 영향력 색상: our_score 기반 (음수=빨강 회복, 양수=파랑 사수)
  // 인구·선거인 큰 지역 더 진하게
  const maxAbsScore = useMemo(() => {
    const all = [...(stats?.sido || []), ...(stats?.sigungu || []), ...(stats?.dong || [])];
    return Math.max(1, ...all.map(s => Math.abs(s.our_score || s.gap || 0)));
  }, [stats]);

  function colorFor(stat: RegionStats | undefined): string {
    if (!stat) return '#e5e7eb';
    const score = stat.our_score ?? null;
    if (score === null || score === undefined) {
      // our_party 매칭 못 함 → gap만 표시 (회색~파랑, 표차 클수록 진함)
      const g = stat.gap || 0;
      const r = Math.min(1, Math.abs(g) / maxAbsScore);
      if (r > 0.6) return '#3b82f6';
      if (r > 0.3) return '#93c5fd';
      if (r > 0.1) return '#dbeafe';
      return '#f3f4f6';
    }
    const r = Math.min(1, Math.abs(score) / maxAbsScore);
    if (score < 0) {
      // 우리 패배 → 빨강 (회복 가능, 인구·표차 클수록 진함)
      if (r > 0.6) return '#dc2626';
      if (r > 0.3) return '#f87171';
      if (r > 0.1) return '#fca5a5';
      return '#fecaca';
    } else {
      // 우리 승리 → 파랑 (사수 거점)
      if (r > 0.6) return '#1d4ed8';
      if (r > 0.3) return '#60a5fa';
      if (r > 0.1) return '#bfdbfe';
      return '#dbeafe';
    }
  }

  const polygonStyle = (feature: any) => {
    const p = feature.properties;
    let stat: RegionStats | undefined;
    let key = '';
    if (colorLevel === 'sido') {
      stat = sidoMap.get(p.sido || '');
      key = p.sido || '';
    } else if (colorLevel === 'sigungu') {
      stat = sigunguMap.get(p.sggnm || '') ||
             sigunguMap.get(`${p.sidonm} ${p.sggnm}`) ||
             Array.from(sigunguMap.values()).find(s => s.name?.endsWith(p.sggnm || '___'));
      key = p.sgg || '';
    } else {
      stat = dongMap.get(p.adm_cd2 || '');
      key = p.adm_cd2 || '';
    }
    const fill = colorFor(stat);
    const isSelected = selected?.key === key;
    return {
      fillColor: fill,
      fillOpacity: 0.65,
      weight: isSelected ? 2.5 : (colorLevel === 'dong' ? 0.7 : 0.4),
      color: isSelected ? '#0f172a' : '#94a3b8',
      opacity: 0.9,
    };
  };

  // 클릭 팝업 — [일정 추가] 버튼은 popupopen 후 querySelector로 핸들러 부여
  const onEachFeature = (feature: any, layer: any) => {
    const p = feature.properties;

    layer.on({
      click: () => {
        let stat: RegionStats | undefined;
        let level: 'sido'|'sigungu'|'dong' = colorLevel;
        let key = '', name = '', dongShort = '', sigunguName = '';
        if (level === 'sido') {
          stat = sidoMap.get(p.sido || '');
          key = p.sido || ''; name = p.sidonm || '';
        } else if (level === 'sigungu') {
          stat = sigunguMap.get(p.sggnm || '');
          key = p.sgg || ''; name = `${p.sidonm} ${p.sggnm}`;
          sigunguName = p.sggnm || '';
        } else {
          stat = dongMap.get(p.adm_cd2 || '');
          key = p.adm_cd2 || ''; name = p.adm_nm || '';
          dongShort = (p.adm_nm || '').split(' ').pop() || '';
          sigunguName = p.sggnm || '';
        }
        setSelected({ level, key });

        const fmt = (n?: number | null) => n != null ? n.toLocaleString('ko-KR') : '—';
        const top1 = stat?.top1;
        const top2 = stat?.top2;
        const gapStr = stat?.gap != null ? `+${fmt(stat.gap)}표` : '—';
        const turnout = stat?.turnout_est != null ? `${stat.turnout_est}%` : '—';
        const popStr = level === 'dong' ? fmt(stat?.population) : '—';
        const votersStr = level === 'dong' ? fmt(stat?.voters_est) : '—';

        // 일정 추가 query (동/시군구 정보)
        const scheduleQuery = level === 'dong'
          ? `dong=${encodeURIComponent(dongShort)}&sigungu=${encodeURIComponent(sigunguName)}&from=history`
          : level === 'sigungu'
          ? `sigungu=${encodeURIComponent(sigunguName)}&from=history`
          : `sido=${encodeURIComponent(name)}&from=history`;

        layer.bindPopup(`
          <div style="font-size:12px;line-height:1.6;min-width:220px">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px">${name}</div>
            ${level === 'dong' ? `
              <div style="color:#64748b">인구 ${popStr}명 · 선거인 추정 ${votersStr}명</div>
              <div style="color:#64748b;margin-bottom:6px">투표율 추정 ${turnout}</div>
            ` : ''}
            ${top1 ? `
              <div style="border-top:1px solid #e2e8f0;padding-top:4px;margin-top:4px">
                <div><b>${stats?.election_year_used || ''} ${stats?.election_type_used || ''}</b></div>
                <div>1위 ${top1.name}${top1.party ? ` (${top1.party})` : ''}: <b>${fmt(top1.votes)}표</b></div>
                ${top2 ? `<div>2위 ${top2.name}${top2.party ? ` (${top2.party})` : ''}: ${fmt(top2.votes)}표</div>` : ''}
                <div style="margin-top:2px">표 차이: <b>${gapStr}</b></div>
              </div>
            ` : '<div style="color:#94a3b8">선거 데이터 없음</div>'}
            ${level !== 'sido' ? `
              <div style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0">
                <a href="/easy/calendar?${scheduleQuery}"
                   class="hh-add-schedule"
                   style="display:inline-block;padding:4px 10px;background:#2563eb;color:white;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none">
                  + 이 지역 일정 추가
                </a>
              </div>
            ` : ''}
          </div>
        `).openPopup();
      },
    });
  };

  // 영향력 TOP 5 (회복 가능 + 사수 거점)
  const insights = useMemo(() => {
    if (!stats) return { recover: [], hold: [] };
    const list = colorLevel === 'sido' ? stats.sido :
                 colorLevel === 'sigungu' ? stats.sigungu :
                 stats.dong.filter(d => d.population && d.population > 1000);

    const withScore = list.filter(s => s.our_score != null);
    if (withScore.length === 0) {
      // our_party 매칭 못 한 경우 — gap 큰 순으로 fallback
      return {
        recover: [],
        hold: [...list].filter(s => s.gap)
          .sort((a, b) => (b.gap || 0) - (a.gap || 0))
          .slice(0, 5),
      };
    }
    return {
      recover: withScore.filter(s => (s.our_score || 0) < 0)
        .sort((a, b) => (a.our_score || 0) - (b.our_score || 0))
        .slice(0, 5),
      hold: withScore.filter(s => (s.our_score || 0) > 0)
        .sort((a, b) => (b.our_score || 0) - (a.our_score || 0))
        .slice(0, 5),
    };
  }, [stats, colorLevel]);

  // 지도 bounds — geojson features 전체
  const bounds = useMemo(() => {
    if (!geojson?.features?.length) return null;
    let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
    for (const f of geojson.features) {
      const g = f.geometry;
      if (!g) continue;
      const visit = (coords: any) => {
        if (typeof coords[0] === 'number') {
          const [lng, lat] = coords;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        } else {
          for (const c of coords) visit(c);
        }
      };
      visit(g.coordinates);
    }
    return [[minLat, minLng], [maxLat, maxLng]] as [[number, number], [number, number]];
  }, [geojson]);

  const center: LatLngExpression = bounds
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : [36.635, 127.489];

  if (loading && !geojson) {
    return (
      <div className="rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] p-12 text-center text-sm text-[var(--muted)]">
        지역 데이터 로딩 중...
      </div>
    );
  }

  if (!geojson?.features?.length) {
    return (
      <div className="rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] p-8 text-sm text-[var(--muted)]">
        지역 GeoJSON이 없습니다.
      </div>
    );
  }

  const fmt = (n?: number | null) => n != null ? n.toLocaleString('ko-KR') : '—';

  return (
    <div className="rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-[var(--card-border)] flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-base">지역별 영향력 지도</h3>
            {years.length > 1 && (
              <div className="flex gap-1">
                {years.map(y => (
                  <button
                    key={y}
                    onClick={() => setYear(y)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                      year === y
                        ? 'bg-blue-600 text-white'
                        : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
            {loading && <span className="text-[11px] text-[var(--muted)]">갱신중...</span>}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            줌 인 →
            <span className={`mx-1 px-1.5 rounded ${colorLevel === 'sido' ? 'bg-blue-500/20 text-blue-400 font-semibold' : ''}`}>시·도</span>
            <span className={`mx-1 px-1.5 rounded ${colorLevel === 'sigungu' ? 'bg-blue-500/20 text-blue-400 font-semibold' : ''}`}>시·군·구</span>
            <span className={`mx-1 px-1.5 rounded ${colorLevel === 'dong' ? 'bg-blue-500/20 text-blue-400 font-semibold' : ''}`}>읍·면·동</span>
            (현재: 줌 {zoom})
            {stats?.our_camp_used && (
              <span className="ml-2">
                · 우리 진영: <b className="text-[var(--foreground)]">{stats.our_camp_used === 'progressive' ? '진보' : '보수'}</b>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-[#dc2626]"></span> 회복 가능 (우리 열세)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-[#1d4ed8]"></span> 사수 거점 (우리 우세)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-gray-300"></span> 영향 작음</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] h-[600px]">
        {/* 지도 */}
        <div className="relative">
          <LeafletMap center={center} zoom={9} bounds={bounds} onZoom={setZoom}>
            {(({ TileLayer, GeoJSON }: any) => (
              <>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png"
                  attribution='&copy; OpenStreetMap'
                />
                {geojson && (
                  <GeoJSON
                    key={colorLevel + ':' + (selected?.key || '')}
                    data={geojson}
                    style={polygonStyle as any}
                    onEachFeature={onEachFeature}
                  />
                )}
              </>
            ))(((LeafletMap as any) || {}))}
          </LeafletMap>
        </div>

        {/* 사이드 인사이트 */}
        <div className="border-l border-[var(--card-border)] overflow-y-auto p-3 text-xs space-y-3">
          {insights.recover.length > 0 && (
            <div>
              <h4 className="font-bold text-[var(--foreground)] mb-2 text-[11px] uppercase tracking-wider">
                회복 가능 TOP 5
              </h4>
              <div className="space-y-1">
                {insights.recover.map((s: any, i: number) => (
                  <div key={i} className="flex justify-between items-baseline gap-2 px-2 py-1.5 rounded border border-red-500/20 bg-red-500/5">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{s.name || s.adm_nm}</div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {s.population ? `${fmt(s.population)}명` : ''}
                      </div>
                    </div>
                    <div className="text-red-400 font-bold whitespace-nowrap">
                      {fmt(s.our_score)}표
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.hold.length > 0 && (
            <div>
              <h4 className="font-bold text-[var(--foreground)] mb-2 text-[11px] uppercase tracking-wider">
                사수 거점 TOP 5
              </h4>
              <div className="space-y-1">
                {insights.hold.map((s: any, i: number) => (
                  <div key={i} className="flex justify-between items-baseline gap-2 px-2 py-1.5 rounded border border-blue-500/20 bg-blue-500/5">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{s.name || s.adm_nm}</div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {s.population ? `${fmt(s.population)}명` : ''}
                      </div>
                    </div>
                    <div className="text-blue-400 font-bold whitespace-nowrap">
                      +{fmt(s.our_score || s.gap)}표
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.recover.length === 0 && insights.hold.length === 0 && (
            <p className="text-[var(--muted)] py-4 text-center">
              영향력 데이터를 불러올 수 없습니다.
            </p>
          )}

          {stats?.voter_ratio && (
            <div className="mt-4 pt-3 border-t border-[var(--card-border)] text-[10px] text-[var(--muted)] leading-relaxed">
              <div>선거인 추정 비율: 인구 × <b className="text-[var(--foreground)]">{(stats.voter_ratio * 100).toFixed(1)}%</b></div>
              <div>(시·도 평균. 동 단위 추정값)</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
