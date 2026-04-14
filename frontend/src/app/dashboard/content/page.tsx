'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

type Tab = 'generate' | 'multitone' | 'compliance' | 'law' | 'history';

export default function ContentToolsPage() {
  const { election, loading: elLoading } = useElection();
  const [tab, setTab] = useState<Tab>('generate');

  // AI 생성 v2
  const [genType, setGenType] = useState('blog');
  const [genPurpose, setGenPurpose] = useState('promote');
  const [genTopic, setGenTopic] = useState('');
  const [genDirection, setGenDirection] = useState('');
  const [genTarget, setGenTarget] = useState('all');
  const [genLength, setGenLength] = useState('medium');
  const [genStyle, setGenStyle] = useState('formal');
  const [genContext, setGenContext] = useState('');
  const [genResult, setGenResult] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [situations, setSituations] = useState<any[]>([]);
  const [situationsLoading, setSituationsLoading] = useState(false);
  const [quadrantItems, setQuadrantItems] = useState<any[]>([]);
  const [showQuadrant, setShowQuadrant] = useState(false);

  // 선거법 체크
  const [complianceText, setComplianceText] = useState('');
  const [complianceType, setComplianceType] = useState('general');
  const [complianceResult, setComplianceResult] = useState<any>(null);

  // 선거법 보기
  const [lawToc, setLawToc] = useState<any[]>([]);
  const [lawDetail, setLawDetail] = useState<any>(null);
  const [lawSearch, setLawSearch] = useState('');
  const [lawSearchResults, setLawSearchResults] = useState<any[]>([]);


  const [loading, setLoading] = useState(false);
  const [copiedTag, setCopiedTag] = useState('');

  useEffect(() => {
    if (tab === 'generate' && situations.length === 0 && election) loadSituations();
    if (tab === 'law' && lawToc.length === 0) loadLawToc();
  }, [tab, election]);

  const loadSituations = async () => {
    if (!election) return;
    setSituationsLoading(true);
    try {
      const data = await api.getContentSituations(election.id);
      setSituations(data.situations || []);
    } catch {} finally { setSituationsLoading(false); }
  };

  const loadLawToc = async () => {
    try {
      const data = await api.getElectionLawToc();
      setLawToc(data.sections || []);
    } catch {}
  };



  const loadQuadrantItems = async () => {
    if (!election) return;
    try {
      const d = await api.getStrategicQuadrant(election.id, 'all', 10);
      const items: any[] = [];
      for (const [key, q] of Object.entries(d.quadrants || {})) {
        for (const it of (q as any).items || []) {
          items.push({ ...it, quadrant: key, label: (q as any).label });
        }
      }
      setQuadrantItems(items);
    } catch {}
  };

  const handleGenerate = async () => {
    if (!election || !genTopic.trim()) return;
    setGenerating(true);
    setGenResult(null);
    // 폼 데이터를 context에 통합 전달
    const purposeLabel: Record<string, string> = { promote: '홍보/강점 확산', attack: '공격/경쟁자 약점 활용', defend: '방어/해명', policy: '정책 소개' };
    const targetLabel: Record<string, string> = { all: '전체 유권자', youth: '2030 청년층', senior: '5060 장년층', rural: '농촌/면 단위' };
    const lengthLabel: Record<string, string> = { short: 'SNS용 짧게 (200자 이내)', medium: '보통 (500자)', long: '블로그 길게 (1500자+)' };
    const enrichedContext = [
      genContext,
      `[목적] ${purposeLabel[genPurpose] || genPurpose}`,
      `[타겟] ${targetLabel[genTarget] || genTarget}`,
      `[분량] ${lengthLabel[genLength] || genLength}`,
      genDirection ? `[사용자 요청] ${genDirection}` : '',
    ].filter(Boolean).join('\n');
    try {
      const data = await api.generateContent(election.id, genType, genTopic.trim(), genStyle, enrichedContext, genPurpose, genTarget);
      setGenResult(data);
    } catch (e: any) {
      setGenResult({ error: e?.message || 'AI 생성 실패' });
    } finally { setGenerating(false); }
  };

  const handleCompliance = async () => {
    if (!election || !complianceText.trim()) return;
    try {
      const r = await api.checkCompliance(election.id, complianceText, complianceType);
      setComplianceResult(r);
    } catch (e: any) {
      alert('선거법 체크 실패: ' + (e?.message || ''));
    }
  };

  const handleLawSearch = async () => {
    if (!lawSearch.trim()) return;
    try {
      const data = await api.searchElectionLaw(lawSearch.trim());
      setLawSearchResults(data.results || []);
    } catch {}
  };

  const loadLawDetail = async (id: string) => {
    try {
      const data = await api.getElectionLawSection(id);
      setLawDetail(data);
    } catch {}
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTag(text.substring(0, 20));
    setTimeout(() => setCopiedTag(''), 2000);
  };

  if (elLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">콘텐츠 도구</h1>
        <p className="text-sm text-[var(--muted)]">AI 콘텐츠 생성 · 선거법 검증 · 법규 열람</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
        {([
          ['generate', 'AI 콘텐츠 생성'],
          ['history', '생성 히스토리'],
          ['multitone', 'SNS 멀티톤'],
          ['compliance', '선거법 검증'],
          ['law', '선거법 보기'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ AI 콘텐츠 생성 ═══ */}
      {tab === 'generate' && (
        <>
          {/* 상황 추천 */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold">지금 만들어야 할 콘텐츠</h3>
                <p className="text-xs text-[var(--muted)]">수집된 데이터 기반 자동 추천 — 클릭하면 AI가 초안을 생성합니다</p>
              </div>
              <button onClick={loadSituations} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
                {situationsLoading ? '분석중...' : '새로고침'}
              </button>
            </div>

            {situations.length > 0 ? (
              <div className="space-y-2">
                {situations.map((s: any, i: number) => (
                  <button key={i} onClick={() => {
                    setGenTopic(s.topic);
                    setGenContext(s.context || '');
                  }}
                    className={`w-full text-left p-3 rounded-xl border transition hover:border-blue-500/30 hover:bg-blue-500/5 ${
                      genTopic === s.topic ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--card-border)]'
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{s.icon}</span>
                      <span className="font-semibold text-sm flex-1">{s.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        s.priority === 'high' ? 'bg-red-500/10 text-red-500' : 'bg-[var(--muted-bg)] text-[var(--muted)]'
                      }`}>{s.priority === 'high' ? '긴급' : '추천'}</span>
                    </div>
                    <p className="text-xs text-[var(--muted)] ml-8">{s.reason}</p>
                  </button>
                ))}
              </div>
            ) : situationsLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-2 text-sm text-[var(--muted)]">데이터 분석 중...</span>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)] text-center py-4">추천 상황이 없습니다. 데이터를 먼저 수집하세요.</p>
            )}
          </div>

          {/* 생성 폼 v2 */}
          <div className="card">
            <h3 className="font-bold mb-4">📝 콘텐츠 생성</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* 유형 */}
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">콘텐츠 유형</label>
                <div className="flex flex-wrap gap-1.5">
                  {[['blog','블로그'],['sns','SNS'],['card','카드뉴스'],['press','보도자료'],['defense','해명문']].map(([v,l]) => (
                    <button key={v} onClick={() => setGenType(v)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition ${genType === v ? 'bg-purple-600 text-white border-purple-600' : 'border-[var(--card-border)] text-[var(--muted)] hover:border-purple-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* 목적 */}
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">목적</label>
                <div className="flex flex-wrap gap-1.5">
                  {[['promote','✨ 홍보/강점 확산'],['attack','🔥 공격/경쟁자 약점'],['defend','🛡️ 방어/해명'],['policy','📋 정책 소개']].map(([v,l]) => (
                    <button key={v} onClick={() => setGenPurpose(v)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition ${genPurpose === v ? 'bg-violet-600 text-white border-violet-600' : 'border-[var(--card-border)] text-[var(--muted)] hover:border-violet-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 주제/소재 */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">주제/소재</label>
              <div className="flex gap-2 mb-2">
                <input className="input-field flex-1" value={genTopic}
                  onChange={e => setGenTopic(e.target.value)}
                  placeholder="직접 입력 또는 아래 4사분면에서 선택..." />
                <button onClick={() => { setShowQuadrant(!showQuadrant); if (!showQuadrant && quadrantItems.length === 0) loadQuadrantItems(); }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:border-violet-500 whitespace-nowrap">
                  {showQuadrant ? '접기' : '4사분면에서 가져오기'}
                </button>
              </div>
              {showQuadrant && (
                <div className="bg-[var(--muted-bg)] rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
                  {quadrantItems.length === 0 ? (
                    <p className="text-xs text-[var(--muted)] text-center py-2">4사분면 데이터 로딩 중...</p>
                  ) : quadrantItems.map((it: any, i: number) => (
                    <button key={i} onClick={() => {
                      setGenTopic(it.title);
                      setGenContext(`[4사분면: ${it.label}] ${it.action_summary || ''} | 후보: ${it.candidate || ''}`);
                      setGenPurpose(it.quadrant === 'opportunity' ? 'attack' : it.quadrant === 'strength' ? 'promote' : it.quadrant === 'weakness' ? 'defend' : 'promote');
                      setShowQuadrant(false);
                    }}
                      className="w-full text-left p-2 rounded-lg hover:bg-[var(--card-bg)] transition flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        it.quadrant === 'opportunity' ? 'bg-orange-500 text-white' :
                        it.quadrant === 'strength' ? 'bg-blue-500 text-white' :
                        it.quadrant === 'weakness' ? 'bg-red-500 text-white' :
                        'bg-amber-500 text-white'
                      }`}>{it.label}</span>
                      <span className="text-xs flex-1 line-clamp-1">{it.title}</span>
                      {it.candidate && <span className="text-[10px] text-[var(--muted)]">{it.candidate}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 원하는 방향/요청 */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">원하는 방향/요청 <span className="font-normal">(선택)</span></label>
              <textarea className="input-field w-full" rows={2} value={genDirection}
                onChange={e => setGenDirection(e.target.value)}
                placeholder="예: 우리 후보의 핵심 공약을 강조해줘 / 경쟁 후보의 약점을 부각하되 직접 비방은 피해줘 / 청년층 대상으로 친근하게..." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {/* 타겟 */}
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">타겟</label>
                <select className="input-field w-full" value={genTarget} onChange={e => setGenTarget(e.target.value)}>
                  <option value="all">전체 유권자</option>
                  <option value="youth">2030 청년층</option>
                  <option value="senior">5060 장년층</option>
                  <option value="rural">농촌/면 단위</option>
                </select>
              </div>
              {/* 분량 */}
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">분량</label>
                <select className="input-field w-full" value={genLength} onChange={e => setGenLength(e.target.value)}>
                  <option value="short">짧게 (SNS, 200자)</option>
                  <option value="medium">보통 (500자)</option>
                  <option value="long">길게 (블로그, 1500자+)</option>
                </select>
              </div>
              {/* 톤 */}
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">톤/스타일</label>
                <select className="input-field w-full" value={genStyle} onChange={e => setGenStyle(e.target.value)}>
                  <option value="formal">공식적/신뢰감</option>
                  <option value="casual">친근한/편안한</option>
                  <option value="aggressive">강한/공격적</option>
                  <option value="emotional">감성적/호소</option>
                </select>
              </div>
            </div>

            {genContext && (
              <div className="text-xs text-[var(--muted)] bg-[var(--muted-bg)] rounded-lg p-2 mb-3">
                <span className="font-bold">📌 컨텍스트:</span> {genContext.substring(0, 150)}{genContext.length > 150 && '...'}
              </div>
            )}

            <button onClick={handleGenerate} disabled={generating || !genTopic.trim()}
              className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition">
              {generating ? '✨ AI 생성 중... (최대 90초)' : '✨ AI 콘텐츠 생성'}
            </button>
          </div>

          {genResult && !genResult.error && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">📄 생성된 콘텐츠</h3>
                <div className="flex gap-2">
                  <button onClick={() => handleCopy(genResult.content)}
                    className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                    {copiedTag ? '✅ 복사됨!' : '📋 복사'}
                  </button>
                  <button onClick={handleGenerate} disabled={generating}
                    className="text-xs px-3 py-1.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50">
                    🔄 다시 생성
                  </button>
                </div>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed bg-[var(--muted-bg)] rounded-xl p-4">
                {genResult.content}
              </div>

              {/* 수정 요청 — 대화형 */}
              <div className="mt-4 flex gap-2">
                <input className="input-field flex-1" value={genDirection}
                  onChange={e => setGenDirection(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                  placeholder="수정 요청: 좀 더 공격적으로 / 경쟁 후보 약점 추가 / 분량 줄여줘..." />
                <button onClick={handleGenerate} disabled={generating}
                  className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
                  ✏️ 수정 생성
                </button>
              </div>

              {/* 출처 각주 */}
              {genResult.citations && genResult.citations.length > 0 && (
                <div className="mt-4 p-3 rounded-xl border border-[var(--card-border)] bg-[var(--muted-bg)]">
                  <p className="text-xs text-[var(--muted)] mb-2 font-semibold">📎 참고 자료 ({genResult.citations.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {genResult.citations.map((c: any, i: number) => (
                      <a key={c.id} href={c.url || '#'} target={c.url ? '_blank' : undefined}
                        className="text-[10px] px-2 py-0.5 rounded border bg-[var(--card-bg)] hover:border-blue-400 transition"
                        title={c.title}>
                        {c.type === 'nec' ? '🏛️' : c.type === 'news' ? '📰' : c.type === 'community' ? '💬' : c.type === 'youtube' ? '📺' : '📋'} {i + 1}. {(c.title || '').slice(0, 30)}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* 선거법 체크 결과 */}
              {genResult.compliance && (
                <div className={`mt-4 p-3 rounded-xl border ${
                  genResult.compliance.compliant
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold text-sm ${genResult.compliance.compliant ? 'text-green-500' : 'text-red-500'}`}>
                      ⚖️ {genResult.compliance.compliant ? '선거법 적합' : '선거법 위반 소지'}
                    </span>
                    <span className="text-xs text-[var(--muted)]">점수: {genResult.compliance.score}/100</span>
                  </div>
                  {genResult.compliance.violations?.map((v: any, i: number) => (
                    <div key={i} className="text-xs text-red-500 mt-1">
                      <span className="font-bold">{v.rule}</span> — {v.detail} (벌칙: {v.penalty})
                    </div>
                  ))}
                  {genResult.compliance.warnings?.map((w: any, i: number) => (
                    <div key={i} className="text-xs text-amber-500 mt-1">
                      <span className="font-bold">{w.rule}</span> — {w.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {genResult?.error && (
            <div className="card text-center py-8 text-red-500">{genResult.error}</div>
          )}
        </>
      )}

      {/* ═══ SNS 멀티톤 ═══ */}
      {/* ═══ 생성 히스토리 ═══ */}
      {tab === 'history' && <ContentHistoryEmbed electionId={election?.id} />}

      {tab === 'multitone' && <MultiToneTab electionId={election?.id} />}

      {/* ═══ 선거법 검증 ═══ */}
      {tab === 'compliance' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-bold mb-3">콘텐츠 선거법 사전 검증</h3>
            <p className="text-xs text-[var(--muted)] mb-4">
              게시 전에 공직선거법 위반 여부를 확인하세요. 실제 법 조항 기반으로 검사합니다.
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

            <textarea className="input-field w-full" rows={6} value={complianceText}
              onChange={e => setComplianceText(e.target.value)}
              placeholder="검증할 콘텐츠를 붙여넣으세요..." />

            <button onClick={handleCompliance} disabled={!complianceText.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm mt-3 hover:bg-blue-700 disabled:opacity-50">
              선거법 검증하기
            </button>
          </div>

          {complianceResult && (
            <div className={`card border-2 ${complianceResult.compliant ? 'border-green-500/30' : 'border-red-500/30'}`}>
              <div className="flex items-center gap-3 mb-4">
                <span className={`text-2xl font-bold ${complianceResult.compliant ? 'text-green-500' : 'text-red-500'}`}>
                  {complianceResult.compliant ? '적합' : '위반 소지'}
                </span>
                <span className="text-sm text-[var(--muted)]">점수: {complianceResult.score}/100</span>
              </div>

              {complianceResult.violations?.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-red-500 mb-2 text-sm">위반 사항</h4>
                  {complianceResult.violations.map((v: any, i: number) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 mb-2">
                      <p className="font-bold text-sm text-red-500">{v.rule}</p>
                      <p className="text-sm mt-1">{v.detail}</p>
                      {v.penalty && <p className="text-xs text-red-400 mt-1">벌칙: {v.penalty}</p>}
                      {v.fix && <p className="text-xs text-[var(--muted)] mt-1">수정: {v.fix}</p>}
                    </div>
                  ))}
                </div>
              )}

              {complianceResult.warnings?.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-amber-500 mb-2 text-sm">주의 사항</h4>
                  {complianceResult.warnings.map((w: any, i: number) => (
                    <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mb-2">
                      <p className="font-bold text-sm text-amber-500">{w.rule}</p>
                      <p className="text-sm mt-1">{w.detail}</p>
                      {w.penalty && <p className="text-xs text-amber-400 mt-1">벌칙: {w.penalty}</p>}
                    </div>
                  ))}
                </div>
              )}

              {complianceResult.suggestions?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-blue-500 mb-2 text-sm">개선 제안</h4>
                  {complianceResult.suggestions.map((s: string, i: number) => (
                    <p key={i} className="text-sm text-blue-400 py-1">{s}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ 선거법 보기 ═══ */}
      {tab === 'law' && (
        <div className="space-y-4">
          {/* 검색 */}
          <div className="card">
            <h3 className="font-bold mb-3">공직선거법규 운용자료</h3>
            <p className="text-xs text-[var(--muted)] mb-3">2026 중앙선거관리위원회 발행 — 조항/운용기준/사례 검색</p>
            <div className="flex gap-2">
              <input className="input-field flex-1" value={lawSearch}
                onChange={e => setLawSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLawSearch()}
                placeholder="검색어 입력 (예: 행사, 홍보물, 금품, 교육감...)" />
              <button onClick={handleLawSearch}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700">
                검색
              </button>
            </div>
          </div>

          {/* 검색 결과 */}
          {lawSearchResults.length > 0 && (
            <div className="card">
              <h4 className="font-semibold mb-3 text-sm">검색 결과 ({lawSearchResults.length}건)</h4>
              <div className="space-y-2">
                {lawSearchResults.map((r: any) => (
                  <button key={r.id} onClick={() => loadLawDetail(r.id)}
                    className="w-full text-left p-3 rounded-xl border border-[var(--card-border)] hover:border-blue-500/30 hover:bg-blue-500/5 transition">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded">{r.article}</span>
                      <span className="font-semibold text-sm">{r.chapter}</span>
                    </div>
                    {r.content_preview && <p className="text-xs text-[var(--muted)] line-clamp-2">{r.content_preview}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 목차 */}
          {!lawDetail && lawSearchResults.length === 0 && (
            <div className="card">
              <h4 className="font-semibold mb-3 text-sm">목차</h4>
              <div className="space-y-2">
                {lawToc.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <button onClick={() => loadLawDetail(s.id)}
                      className="flex-1 text-left p-3 rounded-xl border border-[var(--card-border)] hover:border-blue-500/30 hover:bg-blue-500/5 transition flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-[var(--muted-bg)] text-[var(--muted)] px-2 py-0.5 rounded">{s.article}</span>
                        <span className="font-semibold text-sm">{s.chapter}</span>
                      </div>
                      <span className="text-xs text-[var(--muted)]">p.{s.page_start}-{s.page_end}</span>
                    </button>
                    <a href={`/election-law-2026.pdf#page=${s.page_start}`} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] px-2 py-1 bg-[var(--muted-bg)] text-[var(--muted)] rounded hover:bg-blue-500/10 hover:text-blue-500 shrink-0">
                      PDF
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 상세 보기 */}
          {lawDetail && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded">{lawDetail.article_number}</span>
                  <h3 className="font-bold mt-1">{lawDetail.chapter}</h3>
                  <p className="text-xs text-[var(--muted)]">p.{lawDetail.page_start}-{lawDetail.page_end}</p>
                </div>
                <div className="flex gap-2">
                  <a href={`/election-law-2026.pdf#page=${lawDetail.page_start}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">PDF 원문 보기 (p.{lawDetail.page_start})</a>
                  <button onClick={() => setLawDetail(null)}
                    className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">목차로 돌아가기</button>
                </div>
              </div>

              {lawDetail.content && (
                <div className="mb-4">
                  <h4 className="font-semibold text-sm mb-2 text-blue-500">관계 법규</h4>
                  <div className="whitespace-pre-wrap text-sm bg-[var(--muted-bg)] rounded-xl p-4 leading-relaxed max-h-96 overflow-y-auto">
                    {lawDetail.content}
                  </div>
                </div>
              )}

              {lawDetail.guidelines && (
                <div className="mb-4">
                  <h4 className="font-semibold text-sm mb-2 text-green-500">운용기준</h4>
                  <div className="whitespace-pre-wrap text-sm bg-green-500/5 border border-green-500/10 rounded-xl p-4 leading-relaxed max-h-96 overflow-y-auto">
                    {lawDetail.guidelines}
                  </div>
                </div>
              )}

              {lawDetail.examples && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-amber-500">사례예시</h4>
                  <div className="whitespace-pre-wrap text-sm bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 leading-relaxed max-h-96 overflow-y-auto">
                    {lawDetail.examples}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}


function MultiToneTab({ electionId }: { electionId?: string }) {
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'blog']);
  const [tones, setTones] = useState<string[]>(['formal', 'friendly']);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const toggleItem = (list: string[], item: string, setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  };

  const generate = async () => {
    if (!electionId || !topic) return;
    setLoading(true);
    try {
      const data = await api.generateMultiTone(electionId, topic, context, platforms, tones);
      setResult(data);
    } catch (e: any) {
      alert(e.message || '생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const platformOptions = [
    { key: 'instagram', label: '인스타그램' },
    { key: 'facebook', label: '페이스북' },
    { key: 'twitter', label: 'X(트위터)' },
    { key: 'blog', label: '블로그' },
    { key: 'cafe', label: '맘카페' },
  ];
  const toneOptions = [
    { key: 'formal', label: '공식' },
    { key: 'friendly', label: '친근' },
    { key: 'humor', label: '유머' },
    { key: 'emotional', label: '감동' },
  ];

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <h3 className="font-bold">SNS 멀티톤 콘텐츠 생성</h3>
        <p className="text-sm text-[var(--muted)]">하나의 주제를 플랫폼별 × 톤별 조합으로 동시 생성합니다.</p>
        <div>
          <label className="block text-sm font-medium mb-1">주제 *</label>
          <input value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="예: 무상급식 확대 정책" className="input w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">추가 맥락 (선택)</label>
          <textarea value={context} onChange={e => setContext(e.target.value)}
            placeholder="예: D-30 시점, 경쟁 후보가 반대 입장 표명" className="input w-full" rows={2} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">플랫폼 (다중 선택)</label>
          <div className="flex flex-wrap gap-2">
            {platformOptions.map(p => (
              <button key={p.key} onClick={() => toggleItem(platforms, p.key, setPlatforms)}
                className={`px-3 py-1.5 rounded-full text-sm border ${platforms.includes(p.key) ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-400 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">톤 (다중 선택)</label>
          <div className="flex flex-wrap gap-2">
            {toneOptions.map(t => (
              <button key={t.key} onClick={() => toggleItem(tones, t.key, setTones)}
                className={`px-3 py-1.5 rounded-full text-sm border ${tones.includes(t.key) ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-400 text-purple-700 dark:text-purple-300' : 'border-gray-300 dark:border-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-[var(--muted)]">
          생성 조합: {platforms.length} 플랫폼 × {tones.length} 톤 = {platforms.length * tones.length}개
        </div>
        <button onClick={generate} disabled={loading || !topic || platforms.length === 0 || tones.length === 0}
          className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50">
          {loading ? 'AI 생성 중...' : `${platforms.length * tones.length}개 콘텐츠 동시 생성`}
        </button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="text-sm text-[var(--muted)]">
            생성 완료: {result.generated}/{result.total}개
          </div>
          {(result.results || []).map((r: any, i: number) => (
            <div key={i} className="card">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                    {r.platform_name}
                  </span>
                  <span className="text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded">
                    {r.tone_name}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {r.char_count}/{r.max_chars}자
                  </span>
                </div>
                {r.content && (
                  <button onClick={() => { navigator.clipboard.writeText(r.content); alert('복사됨'); }}
                    className="text-xs text-blue-600 hover:underline">복사</button>
                )}
              </div>
              {r.content ? (
                <pre className="whitespace-pre-wrap text-sm bg-[var(--muted-bg)] p-3 rounded">{r.content}</pre>
              ) : (
                <div className="text-sm text-red-500">생성 실패</div>
              )}
              {r.compliance && !r.compliance.compliant && (
                <div className="mt-2 text-xs text-yellow-600">
                  선거법 주의: {r.compliance.warnings?.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ContentHistoryEmbed({ electionId }: { electionId?: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => { if (electionId) load(); }, [electionId, filter]);

  const load = async () => {
    if (!electionId) return;
    setLoading(true);
    try {
      const data = await api.getContentHistory(electionId, { contentTypes: filter || undefined, limit: 50 });
      setItems(data?.items || []);
    } catch {} finally { setLoading(false); }
  };

  const TYPE_LABELS: Record<string, string> = {
    blog: '블로그', sns: 'SNS', youtube: '유튜브', card: '카드뉴스',
    press: '보도자료', defense: '해명문', debate_script: '토론 대본',
  };

  if (loading) return <div className="card text-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-500 border-t-transparent rounded-full mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`px-3 py-1 rounded-lg text-xs ${!filter ? 'bg-primary-600 text-white' : 'bg-[var(--muted-bg)] text-[var(--muted)]'}`}>전체</button>
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded-lg text-xs ${filter === k ? 'bg-primary-600 text-white' : 'bg-[var(--muted-bg)] text-[var(--muted)]'}`}>{v}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="card text-center py-8 text-[var(--muted)]">생성된 콘텐츠가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => (
            <div key={item.id} onClick={async () => {
              try {
                const detail = await api.getContentHistoryDetail(item.id);
                setSelected(detail);
              } catch {}
            }}
              className="card cursor-pointer hover:border-primary-500/30 transition p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted-bg)] text-[var(--muted)]">
                  {TYPE_LABELS[item.content_type] || item.content_type}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {item.created_at ? new Date(item.created_at).toLocaleDateString('ko') : ''}
                </span>
              </div>
              <h4 className="text-sm font-medium line-clamp-1">{item.topic || item.title || '제목 없음'}</h4>
              {item.preview && <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{item.preview}</p>}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{selected.topic || '콘텐츠 상세'}</h3>
              <button onClick={() => setSelected(null)} className="text-[var(--muted)] hover:text-[var(--foreground)]">닫기</button>
            </div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{selected.content || selected.content_text || ''}</div>
          </div>
        </div>
      )}
    </div>
  );
}
