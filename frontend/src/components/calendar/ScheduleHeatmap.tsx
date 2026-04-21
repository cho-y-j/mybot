'use client';
/**
 * Phase 3 지도 히트맵 — Leaflet + OpenStreetMap
 *
 * MVP 범위 (행정안전부 GeoJSON 없이):
 *   - 일정 위치별 마커 (카테고리 색상)
 *   - 방문 밀도 heat overlay (leaflet.heat)
 *   - 동별 방문 집계 목록 (사이드바)
 *   - 마커 클릭 → 일정 상세 (Bottom Sheet)
 *
 * 폴리곤 기반 읍면동 경계 + 인구 대비 히트는 Phase 4에서 GeoJSON 확보 후 추가.
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LatLngExpression } from 'leaflet';
import { api } from '@/services/api';
import { CATEGORY_LABELS, ScheduleCategory } from '@/lib/schedules';

const COLOR_HEX: Record<ScheduleCategory, string> = {
  rally: '#f43f5e', street: '#f59e0b', debate: '#6366f1',
  broadcast: '#06b6d4', interview: '#14b8a6', meeting: '#64748b',
  supporter: '#10b981', voting: '#8b5cf6', internal: '#71717a', other: '#9ca3af',
};

// react-leaflet 4/5는 SSR 불호환 — dynamic import
// 컨테이너 전체를 하나의 dynamic 컴포넌트로 감싸 invalidateSize + 중심 재설정을 내부에서 처리
const LeafletMap: any = dynamic(
  async () => {
    const RL = await import('react-leaflet');

    const InnerController = ({ center }: { center: [number, number] }) => {
      const map = RL.useMap();
      useEffect(() => {
        // 탭 전환·컨테이너 display:none 상태에서 Leaflet이 0×0 크기를 캐시한 경우
        // 실제 크기를 재측정 + 중심 좌표로 이동
        const t = setTimeout(() => {
          map.invalidateSize();
          map.setView(center, map.getZoom());
        }, 80);
        return () => clearTimeout(t);
      }, [map, center]);
      return null;
    };

    const Wrapper = ({ center, zoom, children }: any) => (
      <RL.MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <InnerController center={center} />
        {children}
      </RL.MapContainer>
    );

    return Wrapper as any;
  },
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-sm text-[var(--muted)]">지도 불러오는 중…</div> },
);

const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then((m) => m.CircleMarker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((m) => m.Popup), { ssr: false });
const GeoJSON: any = dynamic(() => import('react-leaflet').then((m) => m.GeoJSON), { ssr: false });

interface Props {
  electionId: string;
  onSelectSchedule: (schedule: any) => void;
  onAddForLocation?: (location: string) => void;
}

export default function ScheduleHeatmap({ electionId, onSelectSchedule, onAddForLocation }: Props) {
  const [points, setPoints] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [geojson, setGeojson] = useState<any>(null);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [selectedDong, setSelectedDong] = useState<string | null>(null);

  // Leaflet CSS는 globals.css에 번들 포함 — 런타임 주입 불필요

  useEffect(() => {
    if (!electionId) return;
    setLoading(true);
    const auth = () => ({
      headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
    });
    Promise.all([
      fetch(`/api/candidate-schedules/${electionId}/points?days=${days}`, auth()).then((r) => r.json()),
      fetch(`/api/candidate-schedules/${electionId}/heatmap?days=${days}`, auth()).then((r) => r.json()),
      fetch(`/api/candidate-schedules/${electionId}/geojson?days=${days}`, auth()).then((r) => r.json()),
    ])
      .then(([p, h, g]) => {
        setPoints(p.items || []);
        setHeatmap(h.items || []);
        setGeojson(g);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [electionId, days]);

  // 소외도 점수 분포 — 색상 스케일 정규화용
  const maxPopulation = useMemo(() => {
    if (!geojson?.features) return 1;
    return Math.max(1, ...geojson.features.map((f: any) => f.properties.population || 0));
  }, [geojson]);

  // 폴리곤 색상 로직 — 방문 유무 + 인구 대비
  const polygonStyle = (feature: any) => {
    const p = feature.properties;
    const visits = p.visits || 0;
    const pop = p.population || 0;
    const popRatio = maxPopulation > 0 ? pop / maxPopulation : 0;

    let fillColor = '#e5e7eb'; // 기본 회색 (인구 0 또는 데이터 없음)
    if (visits > 0) {
      // 방문한 동 — 파란 계열 (방문 많을수록 진함)
      if (visits >= 5) fillColor = '#1d4ed8';
      else if (visits >= 3) fillColor = '#3b82f6';
      else fillColor = '#60a5fa';
    } else if (pop > 0) {
      // 미방문 — 인구 비율에 따라 빨강 계열 (인구 많을수록 진한 경고)
      if (popRatio >= 0.6) fillColor = '#dc2626';       // 진빨강
      else if (popRatio >= 0.3) fillColor = '#f87171';  // 빨강
      else if (popRatio >= 0.1) fillColor = '#fca5a5';  // 연빨강
      else fillColor = '#fecaca';                        // 매우 연한 빨강
    }

    const isSelected = selectedDong && p.dong_short === selectedDong;
    return {
      fillColor,
      fillOpacity: 0.55,
      weight: isSelected ? 2.5 : 0.8,
      color: isSelected ? '#1e40af' : '#94a3b8',
      opacity: 0.9,
    };
  };

  const onEachFeature = (feature: any, layer: any) => {
    const p = feature.properties;
    const pop = p.population ? p.population.toLocaleString('ko-KR') : '—';
    const lastStr = p.last_visit_at
      ? `마지막 ${Math.floor((Date.now() - new Date(p.last_visit_at).getTime()) / 86400000)}일 전`
      : '방문 없음';
    layer.bindPopup(`
      <div style="font-size:12px;line-height:1.5">
        <div style="font-weight:600">${p.adm_nm}</div>
        <div>방문 ${p.visits}회 · ${lastStr}</div>
        <div>인구 ${pop}명</div>
      </div>
    `);
    layer.on({
      click: () => setSelectedDong(p.dong_short),
    });
  };

  // TOP 5 소외 지역 — 인구 많은데 방문 적은 순
  const outreachTop5 = useMemo(() => {
    if (!geojson?.features) return [];
    return [...geojson.features]
      .filter((f: any) => (f.properties.population || 0) > 1000)  // 매우 적은 동 제외
      .sort((a: any, b: any) => {
        const scoreA = (a.properties.population || 0) - (a.properties.visits || 0) * 5000;
        const scoreB = (b.properties.population || 0) - (b.properties.visits || 0) * 5000;
        return scoreB - scoreA;
      })
      .slice(0, 5)
      .map((f: any) => f.properties);
  }, [geojson]);

  // 지도 중심 계산 (점들의 평균 or 충북 기본값)
  const center: LatLngExpression = useMemo(() => {
    if (points.length === 0) return [36.635, 127.489]; // 충북 청주 기본
    let sumLat = 0, sumLng = 0;
    for (const p of points) {
      sumLat += p.location_lat;
      sumLng += p.location_lng;
    }
    return [sumLat / points.length, sumLng / points.length];
  }, [points]);

  // 선택 동 일정만 필터
  const filteredPoints = useMemo(() =>
    selectedDong ? points.filter((p) => p.admin_dong === selectedDong) : points,
    [points, selectedDong],
  );

  return (
    <div className="space-y-3">
      {/* 기간 토글 + 안내 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 text-xs">
          {[7, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded border transition ${
                days === d
                  ? 'border-blue-500 bg-blue-500/10 text-blue-500 font-semibold'
                  : 'border-[var(--card-border)] hover:border-blue-300'
              }`}
            >
              최근 {d}일
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">
          {loading ? '불러오는 중…' : `방문 ${heatmap.reduce((sum, h) => sum + h.visits, 0)}건 · ${heatmap.length}개 동`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 지도 */}
        <div className="lg:col-span-2 h-[500px] rounded-xl overflow-hidden border border-[var(--card-border)]">
          {typeof window !== 'undefined' && (
            <LeafletMap center={center} zoom={12}>
              {/* OSM 타일 — URL 좌표 순서 {z}/{x}/{y} (표준) */}
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
              {/* 행정동 폴리곤 히트맵 (방문·인구 기반 색상) */}
              {geojson && (
                <GeoJSON
                  key={`${electionId}-${days}`}
                  data={geojson}
                  style={polygonStyle}
                  onEachFeature={onEachFeature}
                />
              )}
              {filteredPoints.map((p) => (
                <CircleMarker
                  key={p.id}
                  center={[p.location_lat, p.location_lng]}
                  pathOptions={{
                    color: COLOR_HEX[p.category as ScheduleCategory] || '#9ca3af',
                    fillColor: COLOR_HEX[p.category as ScheduleCategory] || '#9ca3af',
                    fillOpacity: 0.7,
                    weight: 1,
                  }}
                  radius={p.status === 'done' ? 6 : 10}
                  eventHandlers={{
                    click: () => onSelectSchedule({
                      id: p.id,
                      title: p.title,
                      category: p.category,
                      starts_at: p.starts_at,
                      ends_at: p.starts_at,
                      location: p.location,
                      admin_sido: p.admin_sido,
                      admin_sigungu: p.admin_sigungu,
                      admin_dong: p.admin_dong,
                      status: p.status,
                      all_day: false,
                    }),
                  }}
                >
                  <Popup>
                    <div className="text-xs font-semibold">{p.title}</div>
                    <div className="text-[10px] text-gray-500">
                      {CATEGORY_LABELS[p.category as ScheduleCategory]} · {new Date(p.starts_at).toLocaleDateString('ko-KR')}
                    </div>
                    {p.admin_dong && <div className="text-[10px]">{p.admin_sigungu} {p.admin_dong}</div>}
                  </Popup>
                </CircleMarker>
              ))}
            </LeafletMap>
          )}
        </div>

        {/* 동별 사이드바 */}
        <div className="space-y-3 lg:max-h-[500px] overflow-y-auto">
          {/* TOP 5 소외 지역 (인구 많은데 방문 적음) */}
          <div className="border border-rose-500/30 bg-rose-500/5 rounded-xl p-3">
            <p className="text-sm font-semibold mb-1">소외 지역 TOP 5</p>
            <p className="text-[10px] text-[var(--muted)] mb-2">인구 많은데 방문이 적은 동 (최근 {days}일)</p>
            {outreachTop5.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">데이터 준비 중…</p>
            ) : (
              <ul className="space-y-1">
                {outreachTop5.map((f: any, i: number) => (
                  <li key={i}>
                    <button
                      onClick={() => setSelectedDong(selectedDong === f.dong_short ? null : f.dong_short)}
                      className={`w-full text-left px-2 py-1.5 rounded border text-xs transition ${
                        selectedDong === f.dong_short
                          ? 'border-rose-500 bg-rose-500/10'
                          : 'border-rose-500/30 hover:border-rose-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{f.dong_short}</span>
                        <span className="text-[10px] text-rose-500 whitespace-nowrap">
                          {f.visits === 0 ? '방문 0회' : `${f.visits}회`}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--muted)] mt-0.5">
                        {f.sggnm} · 인구 {(f.population || 0).toLocaleString('ko-KR')}명
                      </div>
                      {onAddForLocation && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onAddForLocation(`${f.sggnm} ${f.dong_short}`); }}
                          className="mt-1 text-[10px] text-rose-500 hover:underline"
                        >
                          + 이 동에 일정 추가
                        </button>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 방문한 동 */}
          {heatmap.length > 0 && (
            <div className="border border-[var(--card-border)] rounded-xl p-3 bg-[var(--card-bg)]">
              <p className="text-sm font-semibold mb-2">방문 동 ({heatmap.length})</p>
              <ul className="space-y-1">
                {heatmap.slice(0, 10).map((h) => {
                  const key = `${h.admin_sigungu}-${h.admin_dong}`;
                  const lastDays = h.last_visit_at
                    ? Math.floor((Date.now() - new Date(h.last_visit_at).getTime()) / 86400000)
                    : null;
                  return (
                    <li key={key}>
                      <button
                        onClick={() => setSelectedDong(selectedDong === h.admin_dong ? null : h.admin_dong)}
                        className={`w-full text-left px-2 py-1.5 rounded border text-xs transition ${
                          selectedDong === h.admin_dong
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-[var(--card-border)] hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{h.admin_dong}</span>
                          <span className="text-[10px] text-blue-500">{h.visits}회</span>
                        </div>
                        <div className="text-[10px] text-[var(--muted)] mt-0.5">
                          {h.admin_sigungu}{lastDays !== null && ` · 마지막 ${lastDays}일 전`}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 범례 */}
          <div className="border border-[var(--card-border)] rounded-xl p-3 text-xs">
            <p className="font-semibold mb-2">범례</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#1d4ed8' }} /> 방문 5회+</div>
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#3b82f6' }} /> 방문 3~4회</div>
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#60a5fa' }} /> 방문 1~2회</div>
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#dc2626' }} /> 인구 많 · 미방문</div>
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#f87171' }} /> 인구 중 · 미방문</div>
              <div className="flex items-center gap-2"><span className="w-4 h-3 rounded" style={{ background: '#fecaca' }} /> 인구 적 · 미방문</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
