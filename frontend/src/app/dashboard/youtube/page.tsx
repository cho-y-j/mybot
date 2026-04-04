'use client';
import { useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';

export default function YouTubePage() {
  const { election, candidates, candidateNames, loading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  // 데모 유튜브 데이터 (각 후보별 동적 생성)
  const ytData = candidates.filter(c => c.enabled).map(c => {
    const hash = c.name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return {
      name: c.name,
      isOurs: c.is_our_candidate,
      videos: Array.from({ length: 3 }, (_, i) => ({
        title: `${c.name} 후보 ${['핵심 공약 발표', '현장 방문 영상', '토론회 하이라이트'][i]}`,
        channel: ['충북TV', '교육뉴스', '선거방송'][i],
        views: Math.floor((hash * (i + 1) * 137) % 50000) + 5000,
        likes: Math.floor((hash * (i + 1) * 43) % 2000) + 100,
        comments: Math.floor((hash * (i + 1) * 17) % 300) + 20,
        published: `${i + 1}일 전`,
        sentiment: ['positive', 'neutral', 'negative'][i % 3],
      })),
      totalViews: Math.floor((hash * 137) % 100000) + 20000,
      totalVideos: Math.floor((hash * 23) % 10) + 3,
    };
  });

  const maxViews = Math.max(...ytData.map(d => d.totalViews));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">유튜브 모니터링</h1>

      {/* AI 유튜브 분석 */}
      <div className="bg-gradient-to-r from-red-50 to-pink-50 rounded-xl border border-red-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-bold text-red-900">AI 유튜브 분석</h3>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          {ytData.sort((a, b) => b.totalViews - a.totalViews)[0]?.name} 후보가 총 조회수에서 선두({ytData[0]?.totalViews.toLocaleString()}회)입니다.
          유튜브는 젊은 유권자층에게 큰 영향력을 가지므로, 영상 콘텐츠 전략을 강화하는 것이 중요합니다.
        </p>
      </div>

      {/* 후보별 유튜브 현황 카드 */}
      <div className={`grid grid-cols-1 md:grid-cols-${Math.min(ytData.length, 4)} gap-4`}>
        {ytData.map(d => (
          <div key={d.name} className={`card ${d.isOurs ? 'ring-2 ring-blue-400' : ''}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: colorMap[d.name] }}>{d.name[0]}</div>
              <div>
                <h3 className="font-bold">{d.name}</h3>
                {d.isOurs && <span className="text-xs text-blue-500">우리 후보</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xl font-bold text-gray-800">{d.totalViews.toLocaleString()}</p>
                <p className="text-xs text-gray-500">총 조회수</p>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xl font-bold text-gray-800">{d.totalVideos}</p>
                <p className="text-xs text-gray-500">영상 수</p>
              </div>
            </div>
            {/* 비교 바 */}
            <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${d.totalViews / maxViews * 100}%`, backgroundColor: colorMap[d.name] }} />
            </div>
          </div>
        ))}
      </div>

      {/* 최근 영상 목록 */}
      {ytData.map(d => (
        <div key={d.name} className="card">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: colorMap[d.name] }}>{d.name[0]}</div>
            <h3 className="font-semibold">{d.name} 관련 영상</h3>
            {d.isOurs && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">우리 후보</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {d.videos.map((v, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4 hover:shadow-md transition-shadow">
                {/* 영상 썸네일 대체 */}
                <div className="bg-gray-200 rounded-lg h-28 flex items-center justify-center mb-3">
                  <svg className="w-10 h-10 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <h4 className="font-medium text-sm text-gray-800 line-clamp-2">{v.title}</h4>
                <p className="text-xs text-gray-400 mt-1">{v.channel} | {v.published}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>👁 {v.views.toLocaleString()}</span>
                  <span>👍 {v.likes.toLocaleString()}</span>
                  <span>💬 {v.comments}</span>
                  <span className={`ml-auto px-1.5 py-0.5 rounded text-xs ${
                    v.sentiment === 'positive' ? 'bg-green-100 text-green-600' :
                    v.sentiment === 'negative' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {v.sentiment === 'positive' ? '긍정' : v.sentiment === 'negative' ? '부정' : '중립'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
