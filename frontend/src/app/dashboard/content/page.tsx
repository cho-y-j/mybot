'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

type Tab = 'hashtags' | 'blog' | 'suggestions' | 'compliance';

export default function ContentToolsPage() {
  const { election, loading: elLoading } = useElection();
  const [tab, setTab] = useState<Tab>('hashtags');
  const [hashtags, setHashtags] = useState<any>(null);
  const [blogTags, setBlogTags] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [complianceText, setComplianceText] = useState('');
  const [complianceType, setComplianceType] = useState('general');
  const [complianceResult, setComplianceResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copiedTag, setCopiedTag] = useState('');

  useEffect(() => {
    if (election) loadData();
  }, [election, tab]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      if (tab === 'hashtags' && !hashtags) setHashtags(await api.getHashtags(election.id));
      if (tab === 'blog' && !blogTags) setBlogTags(await api.getBlogTags(election.id));
      if (tab === 'suggestions' && !suggestions) setSuggestions(await api.getContentSuggestions(election.id));
    } catch {} finally { setLoading(false); }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTag(text);
    setTimeout(() => setCopiedTag(''), 2000);
  };

  const handleCopyAll = (tags: string[]) => {
    navigator.clipboard.writeText(tags.join(' '));
    setCopiedTag('all');
    setTimeout(() => setCopiedTag(''), 2000);
  };

  const handleCompliance = async () => {
    if (!election || !complianceText.trim()) return;
    try {
      const r = await api.checkCompliance(election.id, complianceText, complianceType);
      setComplianceResult(r);
    } catch {}
  };

  if (elLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'hashtags', label: '해시태그', icon: '#' },
    { key: 'blog', label: '블로그 태그', icon: '📝' },
    { key: 'suggestions', label: '콘텐츠 제안', icon: '💡' },
    { key: 'compliance', label: '선거법 체크', icon: '⚖️' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">콘텐츠 도구</h1>
        <p className="text-gray-500 mt-1">해시태그 추천, 블로그 태그, 콘텐츠 제안, 선거법 검증</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow text-primary-700' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── 해시태그 탭 ── */}
      {tab === 'hashtags' && hashtags && (
        <div className="space-y-4">
          {Object.entries(hashtags).filter(([k]) => ['campaign','issue_based','sns_trending','blog_seo','youtube'].includes(k)).map(([category, tags]: [string, any]) => {
            const labels: Record<string, string> = {
              campaign: '🏛 캠페인 (필수)', issue_based: '📋 이슈 기반',
              sns_trending: '📱 SNS 트렌딩', blog_seo: '🔍 블로그 SEO', youtube: '▶️ 유튜브',
            };
            return (
              <div key={category} className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{labels[category] || category}</h3>
                  <button onClick={() => handleCopyAll(tags as string[])}
                    className="text-xs text-primary-600 hover:underline">
                    {copiedTag === 'all' ? '복사됨!' : '전체 복사'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(tags as string[]).map((tag: string, i: number) => (
                    <button key={i} onClick={() => handleCopy(tag)}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                        copiedTag === tag
                          ? 'bg-green-100 border-green-300 text-green-700'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-primary-50 hover:border-primary-300'
                      }`}>
                      {copiedTag === tag ? '✓ 복사됨' : tag}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 블로그 태그 탭 ── */}
      {tab === 'blog' && blogTags && (
        <div className="space-y-4">
          {Object.entries(blogTags.categories || {}).map(([cat, tags]: [string, any]) => (
            <div key={cat} className="card">
              <h3 className="font-semibold mb-3">{cat} ({tags.length}개)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {tags.map((t: any, i: number) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{t.tag}</span>
                      <button onClick={() => handleCopy(t.variations.join(', '))}
                        className="text-xs text-primary-500">복사</button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {t.variations.map((v: string, j: number) => (
                        <span key={j} className="text-xs bg-white border rounded px-1.5 py-0.5 text-gray-500">{v}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 콘텐츠 제안 탭 ── */}
      {tab === 'suggestions' && suggestions && (
        <div className="space-y-3">
          {suggestions.suggestions?.map((s: any, i: number) => {
            const typeIcon: Record<string, string> = { blog: '📝', sns: '📱', youtube: '▶️' };
            const priorityColor: Record<string, string> = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' };
            return (
              <div key={i} className="card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{typeIcon[s.type] || '📌'}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">{s.title}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor[s.priority]}`}>
                        {s.priority === 'high' ? '높음' : s.priority === 'medium' ? '보통' : '낮음'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{s.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.tags.map((t: string, j: number) => (
                        <span key={j} className="text-xs bg-blue-50 text-blue-600 rounded px-2 py-0.5">#{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 선거법 체크 탭 ── */}
      {tab === 'compliance' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3">콘텐츠 선거법 사전 검증</h3>
            <p className="text-sm text-gray-500 mb-4">
              게시 전에 선거법 위반 여부를 확인하세요. AI 생성물 표기, 비방, 금품 제공 등을 자동 검사합니다.
            </p>

            <div className="mb-3">
              <select className="input-field w-48" value={complianceType}
                onChange={e => setComplianceType(e.target.value)}>
                <option value="general">일반 콘텐츠</option>
                <option value="sms">문자 메시지</option>
                <option value="blog">블로그</option>
                <option value="sns">SNS</option>
                <option value="youtube">유튜브</option>
              </select>
            </div>

            <textarea className="input-field" rows={6} value={complianceText}
              onChange={e => setComplianceText(e.target.value)}
              placeholder="검증할 콘텐츠를 붙여넣으세요..." />

            <button onClick={handleCompliance} disabled={!complianceText.trim()}
              className="btn-primary mt-3">⚖️ 선거법 검증하기</button>
          </div>

          {complianceResult && (
            <div className={`card border-2 ${complianceResult.compliant ? 'border-green-300' : 'border-red-300'}`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{complianceResult.compliant ? '✅' : '⚠️'}</span>
                <div>
                  <h3 className="font-bold text-lg">
                    {complianceResult.compliant ? '적합' : '위반 사항 발견'}
                  </h3>
                  <p className="text-sm text-gray-500">점수: {complianceResult.score}/100</p>
                </div>
              </div>

              {complianceResult.violations?.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-red-600 mb-2">위반 사항</h4>
                  {complianceResult.violations.map((v: any, i: number) => (
                    <div key={i} className="bg-red-50 rounded p-3 mb-2">
                      <p className="font-medium text-sm text-red-800">{v.rule}</p>
                      <p className="text-sm text-red-600">{v.detail}</p>
                      <p className="text-xs text-red-500 mt-1">수정 방법: {v.fix}</p>
                    </div>
                  ))}
                </div>
              )}

              {complianceResult.warnings?.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-amber-600 mb-2">주의 사항</h4>
                  {complianceResult.warnings.map((w: any, i: number) => (
                    <div key={i} className="bg-amber-50 rounded p-3 mb-2">
                      <p className="font-medium text-sm text-amber-800">{w.rule}</p>
                      <p className="text-sm text-amber-600">{w.detail}</p>
                    </div>
                  ))}
                </div>
              )}

              {complianceResult.suggestions?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-blue-600 mb-2">개선 제안</h4>
                  {complianceResult.suggestions.map((s: string, i: number) => (
                    <p key={i} className="text-sm text-blue-600 py-1">💡 {s}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-4 border-primary-500 border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
