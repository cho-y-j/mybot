'use client';
import { useEffect, useState, useMemo } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  blog: { label: '블로그', icon: '📝', color: 'blue' },
  sns: { label: 'SNS', icon: '📱', color: 'purple' },
  youtube: { label: '유튜브', icon: '🎥', color: 'red' },
  card: { label: '카드뉴스', icon: '🗂', color: 'orange' },
  press: { label: '보도자료', icon: '📰', color: 'gray' },
  defense: { label: '해명문', icon: '🛡', color: 'amber' },
  debate_script: { label: '토론 대본', icon: '⚔️', color: 'violet' },
};

const TYPE_FILTERS = [
  { value: '', label: '전체' },
  { value: 'blog', label: '블로그' },
  { value: 'sns', label: 'SNS' },
  { value: 'youtube', label: '유튜브' },
  { value: 'card', label: '카드뉴스' },
  { value: 'press', label: '보도자료' },
  { value: 'defense', label: '해명문' },
  { value: 'debate_script', label: '토론 대본' },
];

export default function ContentHistoryPage() {
  const { election, loading: elLoading } = useElection();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!election) return;
    load();
  }, [election?.id, filter]);

  const load = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const data = await api.getContentHistory(election.id, {
        contentTypes: filter || undefined,
        limit: 100,
      });
      setItems(data?.items || []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (item: any) => {
    setDetailLoading(true);
    try {
      const detail = await api.getContentHistoryDetail(item.id);
      setSelected(detail);
    } catch (e: any) {
      alert('상세 로드 실패: ' + (e?.message || ''));
    } finally {
      setDetailLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((it: any) =>
      (it.title || '').toLowerCase().includes(q) ||
      (it.preview || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  // 날짜별 그룹핑 (최신 순)
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    filtered.forEach((it: any) => {
      const d = (it.created_at || it.date || '').substring(0, 10) || '날짜 없음';
      if (!g[d]) g[d] = [];
      g[d].push(it);
    });
    return Object.entries(g).sort((a, b) => {
      if (a[0] === '날짜 없음') return 1;
      if (b[0] === '날짜 없음') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [filtered]);

  const copyBody = () => {
    if (!selected?.body) return;
    navigator.clipboard.writeText(selected.body);
    alert('클립보드에 복사됨');
  };

  if (elLoading) return <div className="p-6 text-gray-500">로딩 중...</div>;
  if (!election) return <div className="p-6 text-red-500">선거를 선택하세요</div>;

  return (
    <div className="space-y-5 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">콘텐츠 히스토리</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          이전에 생성한 블로그·SNS·토론 대본을 다시 보고 재사용하세요.
        </p>
      </div>

      {/* 필터 + 검색 */}
      <div className="card flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 flex-wrap">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value || 'all'}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                filter === f.value
                  ? 'bg-blue-500 text-white'
                  : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="제목·본문 검색..."
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm"
        />
      </div>

      {loading ? (
        <div className="card text-center py-16 text-[var(--muted)]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-5xl mb-3">📭</div>
          <p className="text-[var(--muted)]">
            {items.length === 0 ? '아직 생성된 콘텐츠가 없습니다.' : '검색 결과가 없습니다.'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-2">
            <a href="/dashboard/content" className="text-blue-500 hover:underline">콘텐츠 생성기</a>에서 만들어보세요.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, groupItems]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-[var(--muted)] mb-2 sticky top-0 py-1">
                {date === '날짜 없음' ? (
                  <span className="text-amber-500 italic">날짜 미상</span>
                ) : date}
                <span className="ml-2 text-xs font-normal">({groupItems.length}건)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {groupItems.map((it: any) => {
                  const meta = TYPE_LABELS[it.content_type] || { label: it.content_type, icon: '📄', color: 'gray' };
                  return (
                    <button
                      key={it.id}
                      onClick={() => openDetail(it)}
                      className="text-left p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:border-blue-500/50 hover:shadow-md transition"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{meta.icon}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded bg-${meta.color}-100 text-${meta.color}-700 dark:bg-${meta.color}-900/40 dark:text-${meta.color}-300 font-semibold`}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-[var(--muted)] ml-auto">
                          {(it.created_at || '').substring(11, 16)}
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm line-clamp-2 mb-1">{it.title}</h4>
                      <p className="text-xs text-[var(--muted)] line-clamp-2">{it.preview}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 상세 모달 */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div
            className="bg-[var(--card-bg)] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-[var(--card-border)]">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{(TYPE_LABELS[selected.content_type] || {}).icon || '📄'}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded dark:bg-blue-900/40 dark:text-blue-300">
                    {(TYPE_LABELS[selected.content_type] || {}).label || selected.content_type}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {(selected.created_at || '').substring(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <h2 className="text-lg font-bold">{selected.title}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none pl-4"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{selected.body}</pre>
            </div>
            <div className="flex gap-2 p-4 border-t border-[var(--card-border)]">
              <button onClick={copyBody} className="btn-primary text-sm px-4 py-2">
                📋 전체 복사
              </button>
              <button onClick={() => setSelected(null)} className="btn-secondary text-sm px-4 py-2">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
