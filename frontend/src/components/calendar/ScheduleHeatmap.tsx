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

interface Props {
  electionId: string;
  onSelectSchedule: (schedule: any) => void;
  onAddForLocation?: (location: string) => void;
}

export default function ScheduleHeatmap({ electionId, onSelectSchedule, onAddForLocation }: Props) {
  const [points, setPoints] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [selectedDong, setSelectedDong] = useState<string | null>(null);

  // Leaflet CSS는 globals.css에 번들 포함 — 런타임 주입 불필요

  useEffect(() => {
    if (!electionId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/candidate-schedules/${electionId}/points?days=${days}`, {
        headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
      }).then((r) => r.json()),
      fetch(`/api/candidate-schedules/${electionId}/heatmap?days=${days}`, {
        headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
      }).then((r) => r.json()),
    ])
      .then(([p, h]) => {
        setPoints(p.items || []);
        setHeatmap(h.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [electionId, days]);

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
          <div className="border border-[var(--card-border)] rounded-xl p-3 bg-[var(--card-bg)]">
            <p className="text-sm font-semibold mb-2">방문 동 ({heatmap.length})</p>
            {heatmap.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                아직 방문한 동이 없어요. 일정을 추가하면 자동으로 지오코딩되어 여기 표시됩니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {heatmap.map((h) => {
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
                          <span className="text-[10px] text-[var(--muted)]">{h.visits}회</span>
                        </div>
                        <div className="text-[10px] text-[var(--muted)] mt-0.5">
                          {h.admin_sigungu}
                          {lastDays !== null && ` · 마지막 ${lastDays}일 전`}
                        </div>
                        {onAddForLocation && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onAddForLocation(`${h.admin_sigungu} ${h.admin_dong}`); }}
                            className="mt-1 text-[10px] text-blue-500 hover:underline"
                          >
                            + 이 동에 일정 추가
                          </button>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-3 text-xs text-[var(--muted)]">
            <p className="font-semibold text-amber-600 dark:text-amber-400 mb-1">Phase 3 MVP 안내</p>
            <p>
              읍면동 경계 폴리곤 히트맵 + TOP 5 소외 지역 자동 추천(AI 기반)은 다음 단계에서 추가됩니다.
              현재는 일정에 입력된 좌표 기준으로 방문 동을 집계합니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
