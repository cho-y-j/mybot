'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';

type Step = 'region' | 'candidate' | 'preview' | 'done';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('region');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 마스터 데이터
  const [regions, setRegions] = useState<any[]>([]);
  const [electionTypes, setElectionTypes] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);

  // 사용자 입력
  const [form, setForm] = useState({
    election_name: '',
    election_type: '',
    sido: '',
    sigungu: '',
    election_date: '',
    our_name: '',
    our_party: '',
    plan: 'full' as 'full' | 'analysis_only' | 'homepage_only',
    homepage_code: '',
  });
  const [codeCheck, setCodeCheck] = useState<{ available: boolean | null; reason: string }>({
    available: null, reason: '',
  });
  const [competitors, setCompetitors] = useState<{ name: string; party: string }[]>([]);

  // 미리보기 데이터
  const [preview, setPreview] = useState<any>(null);

  // 결과
  const [result, setResult] = useState<any>(null);

  // 마스터 데이터 로드 (인증/리다이렉트는 / 페이지에서 처리)
  useEffect(() => {
    (async () => {
      if (!api.isAuthenticated()) {
        router.replace('/login');
        return;
      }
      try {
        const [r, e, p] = await Promise.all([
          api.getRegions(), api.getElectionTypes(), api.getParties(),
        ]);
        setRegions(r);
        setElectionTypes(e);
        setParties(p);
      } catch (err) {
        console.error('onboarding init error:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택된 시도의 시군구
  const selectedRegion = regions.find(r => r.sido === form.sido);
  const districts = selectedRegion?.districts || [];

  // 선거명 자동 생성 — 기초단체장은 시군구 포함
  useEffect(() => {
    if (form.sido && form.election_type) {
      const short = regions.find(r => r.sido === form.sido)?.short || '';
      const typeLabel = electionTypes.find(t => t.value === form.election_type)?.label || '';
      const sidoLevel = ['superintendent', 'governor'].includes(form.election_type);
      const district = !sidoLevel && form.sigungu ? ` ${form.sigungu}` : '';
      setForm(f => ({ ...f, election_name: `2026 ${short}${district} ${typeLabel} 선거` }));
    }
  }, [form.sido, form.sigungu, form.election_type]);

  const handlePreview = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await api.previewSetup({ ...form, competitors });
      setPreview(data);
      setStep('preview');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleApply = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await api.applySetup({ ...form, competitors });
      setResult(data);
      setStep('done');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const addCompetitor = () => setCompetitors([...competitors, { name: '', party: '' }]);
  const updateComp = (i: number, field: string, val: string) => {
    const u = [...competitors];
    (u[i] as any)[field] = val;
    setCompetitors(u);
  };
  const removeComp = (i: number) => setCompetitors(competitors.filter((_, j) => j !== i));

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-purple-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow">
              <span className="text-white font-bold">EP</span>
            </div>
            <span className="text-2xl font-bold">ElectionPulse</span>
          </div>
          <p className="text-gray-500">선거 분석 시작하기</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(['region', 'candidate', 'preview', 'done'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step === s ? 'bg-primary-600 text-white' :
                ['region','candidate','preview','done'].indexOf(step) > i ? 'bg-green-500 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>{i + 1}</div>
              {i < 3 && <div className={`w-12 h-0.5 ${['region','candidate','preview','done'].indexOf(step) > i ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">{error}</div>}

        {/* ───── Step 1: 지역 + 선거 유형 ───── */}
        {step === 'region' && (
          <div className="card space-y-5">
            <div>
              <h2 className="text-xl font-bold">1. 선거 정보</h2>
              <p className="text-sm text-gray-500 mt-1">지역과 선거 유형을 선택하면 자동으로 설정됩니다</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">시/도 *</label>
                <select className="input-field" value={form.sido}
                  onChange={e => setForm({ ...form, sido: e.target.value, sigungu: '' })}>
                  <option value="">선택하세요</option>
                  {regions.map(r => (
                    <option key={r.sido} value={r.sido}>{r.short} ({r.sido})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">시/군/구</label>
                {['governor', 'superintendent'].includes(form.election_type) ? (
                  <div className="input-field bg-gray-100 text-gray-400 cursor-not-allowed">광역 선거 — 시/도 전체</div>
                ) : (
                  <select className="input-field" value={form.sigungu}
                    onChange={e => setForm({ ...form, sigungu: e.target.value })}
                    disabled={!form.sido}>
                    <option value="">선택하세요</option>
                    {districts.map((d: string) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">선거 유형 *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {electionTypes.map(t => (
                  <button key={t.value} type="button"
                    onClick={() => setForm({ ...form, election_type: t.value, sigungu: ['governor', 'superintendent'].includes(t.value) ? '' : form.sigungu })}
                    className={`p-3 rounded-lg border text-sm text-left transition-all ${
                      form.election_type === t.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <span className="font-medium">{t.label}</span>
                    <span className="block text-xs text-gray-400 mt-0.5">이슈 {t.issue_count}개</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">선거일 *</label>
              <input type="date" className="input-field" value={form.election_date}
                onChange={e => setForm({ ...form, election_date: e.target.value })} />
            </div>

            {form.sido && form.election_type && (
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <span className="font-medium text-blue-700">자동 생성 예정:</span>
                <span className="text-blue-600 ml-1">{form.election_name}</span>
              </div>
            )}

            <button onClick={() => setStep('candidate')}
              disabled={!form.sido || !form.election_type || !form.election_date}
              className="btn-primary w-full py-3">
              다음: 후보자 정보
            </button>
          </div>
        )}

        {/* ───── Step 2: 후보자 ───── */}
        {step === 'candidate' && (
          <div className="card space-y-5">
            <div>
              <h2 className="text-xl font-bold">2. 후보자 정보</h2>
              <p className="text-sm text-gray-500 mt-1">본인 정보만 필수, 경쟁자는 나중에 추가 가능</p>
            </div>

            {/* 우리 후보 */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-blue-800">우리 후보 (필수)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">이름 *</label>
                  <input className="input-field" value={form.our_name}
                    onChange={e => setForm({ ...form, our_name: e.target.value })}
                    placeholder="홍길동" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">정당</label>
                  <select className="input-field" value={form.our_party}
                    onChange={e => setForm({ ...form, our_party: e.target.value })}>
                    <option value="">선택</option>
                    {parties.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 경쟁 후보 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">경쟁 후보 (선택)</h3>
                <button type="button" onClick={addCompetitor}
                  className="text-sm text-primary-600 hover:text-primary-700">+ 추가</button>
              </div>

              {competitors.length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">
                  나중에 대시보드에서 추가할 수 있습니다
                </p>
              )}

              {competitors.map((c, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input className="input-field flex-1" placeholder="이름"
                    value={c.name} onChange={e => updateComp(i, 'name', e.target.value)} />
                  <select className="input-field w-36" value={c.party}
                    onChange={e => updateComp(i, 'party', e.target.value)}>
                    <option value="">정당</option>
                    {parties.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button onClick={() => removeComp(i)}
                    className="text-red-400 hover:text-red-600 px-2"></button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('region')} className="btn-secondary flex-1">이전</button>
              <button onClick={handlePreview} disabled={!form.our_name || loading}
                className="btn-primary flex-1 py-3">
                {loading ? '분석 중...' : '다음: 설정 확인'}
              </button>
            </div>
          </div>
        )}

        {/* ───── Step 3: 미리보기 ───── */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="card">
              <h2 className="text-xl font-bold mb-1">3. 자동 생성된 설정 확인</h2>
              <p className="text-sm text-gray-500">아래 설정이 자동으로 적용됩니다. 시작 후 수정할 수 있습니다.</p>
            </div>

            {/* 선거 정보 */}
            <div className="card">
              <h3 className="font-semibold mb-3">선거 정보</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">선거</span><br/><strong>{preview.election.name}</strong></div>
                <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">지역</span><br/><strong>{preview.election.region}</strong></div>
                <div className="bg-gray-50 rounded p-2"><span className="text-gray-500">선거일</span><br/><strong>{preview.election.date}</strong></div>
              </div>
            </div>

            {/* 후보별 키워드 */}
            <div className="card">
              <h3 className="font-semibold mb-3">후보별 검색 키워드 (자동 생성)</h3>
              {preview.candidates.map((c: any, i: number) => (
                <div key={i} className={`mb-3 p-3 rounded-lg ${c.is_ours ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{c.name}</span>
                    {c.party && <span className="text-xs text-gray-500">{c.party}</span>}
                    {c.is_ours && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">우리 후보</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.keywords.map((kw: string, j: number) => (
                      <span key={j} className="text-xs bg-white border rounded px-2 py-0.5">{kw}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 모니터링 키워드 */}
            <div className="card">
              <h3 className="font-semibold mb-3">모니터링 키워드 ({preview.monitoring_keywords.length}개)</h3>
              <div className="flex flex-wrap gap-1">
                {preview.monitoring_keywords.map((kw: string, i: number) => (
                  <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">{kw}</span>
                ))}
              </div>
            </div>

            {/* 커뮤니티 + 언론 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="card">
                <h3 className="font-semibold mb-2">커뮤니티 타겟</h3>
                {preview.community_targets.map((c: string, i: number) => (
                  <div key={i} className="text-sm py-1 text-gray-600"> {c}</div>
                ))}
              </div>
              <div className="card">
                <h3 className="font-semibold mb-2">지역 언론</h3>
                {preview.local_media.map((m: string, i: number) => (
                  <div key={i} className="text-sm py-1 text-gray-600"> {m}</div>
                ))}
              </div>
            </div>

            {/* 홈페이지 주소 직접 지정 */}
            {form.plan !== 'analysis_only' && (
              <div className="card">
                <h3 className="font-semibold mb-2"> 내 홈페이지 주소</h3>
                <p className="text-xs text-gray-500 mb-3">후보 홍보 시 이 링크를 공유합니다. 나중에 변경 가능.</p>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-500">ai.on1.kr/</span>
                  <input type="text" maxLength={30}
                    value={form.homepage_code}
                    onChange={e => {
                      const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                      setForm(f => ({ ...f, homepage_code: v }));
                      setCodeCheck({ available: null, reason: '' });
                      if (v.length >= 3) {
                        fetch(`/api/sso/homepage/check-code?code=${encodeURIComponent(v)}`)
                          .then(r => r.json())
                          .then(d => setCodeCheck({ available: !!d.available, reason: d.reason || '' }))
                          .catch(() => {});
                      }
                    }}
                    placeholder="예: kimjingyun"
                    className="input flex-1" />
                </div>
                {form.homepage_code.length >= 3 && codeCheck.available !== null && (
                  <p className={`text-xs mt-2 ${codeCheck.available ? 'text-emerald-600' : 'text-red-500'}`}>
                    {codeCheck.available ? '' : ''} {codeCheck.reason}
                  </p>
                )}
                {!form.homepage_code && (
                  <p className="text-xs text-gray-400 mt-2">(비워두면 8자리 임시 주소 자동 배정)</p>
                )}
              </div>
            )}

            {/* 플랜 선택 */}
            <div className="card">
              <h3 className="font-semibold mb-3"> 플랜 선택</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { value: 'full', label: ' 분석 + 홈페이지', desc: 'AI 분석 + 후보 홈페이지 자동 생성 (ai.on1.kr/{내코드})', recommended: true },
                  { value: 'homepage_only', label: ' 홈페이지만', desc: '홍보용 후보 홈페이지만 필요한 경우' },
                  { value: 'analysis_only', label: ' 분석만', desc: '이미 자체 사이트가 있어 분석만 필요한 경우' },
                ].map(p => (
                  <button key={p.value} type="button"
                    onClick={() => setForm(f => ({ ...f, plan: p.value as any }))}
                    className={`text-left p-3 rounded-lg border-2 transition ${
                      form.plan === p.value
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{p.label}</span>
                      {p.recommended && <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded">추천</span>}
                    </div>
                    <p className="text-xs text-gray-500">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* 스케줄 */}
            <div className="card">
              <h3 className="font-semibold mb-3">자동 수집 스케줄</h3>
              {preview.schedules.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <span className="font-mono text-sm text-primary-600 w-12">{s.fixed_times[0]}</span>
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">{s.schedule_type}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('candidate')} className="btn-secondary flex-1">이전</button>
              <button onClick={handleApply} disabled={loading}
                className="btn-primary flex-1 py-3 text-lg">
                {loading ? '설정 적용 중...' : ' 분석 시작하기'}
              </button>
            </div>
          </div>
        )}

        {/* ───── Step 4: 완료 + 부트스트랩 진행률 ───── */}
        {step === 'done' && result && (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4"></div>
            <h2 className="text-2xl font-bold mb-2">설정 완료!</h2>
            <p className="text-gray-500 mb-6">{result.message}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 max-w-lg mx-auto">
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-blue-600">{result.summary.competitors + 1}</p>
                <p className="text-xs text-gray-500">후보</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-amber-600">{result.summary.keywords}</p>
                <p className="text-xs text-gray-500">키워드</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-green-600">{result.summary.schedules}</p>
                <p className="text-xs text-gray-500">스케줄</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-purple-600">{result.summary.local_media}</p>
                <p className="text-xs text-gray-500">언론사</p>
              </div>
            </div>

            {/* 부트스트랩 진행률 폴링 */}
            <BootstrapProgress electionId={result.election_id} onDone={() => router.push('/dashboard')} />
          </div>
        )}
      </div>
    </div>
  );
}


// ── 부트스트랩 진행률 폴링 컴포넌트 ──
function BootstrapProgress({ electionId, onDone }: { electionId: string; onDone: () => void }) {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!electionId) return;
    let stopped = false;

    const poll = async () => {
      try {
        const s = await api.getBootstrapStatus(electionId);
        if (stopped) return;
        setStatus(s);
        if (s.phase === 'done' || s.phase === 'failed') return; // 폴링 중단
        setTimeout(poll, 5000);
      } catch (e: any) {
        if (!stopped) setError(e.message || '상태 조회 실패');
      }
    };
    poll();

    return () => { stopped = true; };
  }, [electionId]);

  if (error) {
    return (
      <div className="text-sm text-red-600 mb-4">상태 조회 실패: {error}</div>
    );
  }
  if (!status) {
    return (
      <div className="text-sm text-gray-500 mb-4">수집 준비 중...</div>
    );
  }

  const phase = status.phase || 'unknown';
  const progress = status.progress || 0;
  const message = status.message || '';
  const counts = status.counts || {};
  const isDone = phase === 'done';
  const isFailed = phase === 'failed';

  const phaseLabel: Record<string, string> = {
    starting: ' 준비 중',
    collecting: ' 데이터 수집 중',
    analyzing: ' AI 분석 중',
    done: ' 완료',
    failed: ' 실패',
    unknown: ' 상태 확인 중',
  };

  const barColor = isDone ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-blue-500';

  return (
    <div className="max-w-lg mx-auto mb-6">
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">{phaseLabel[phase] || phase}</span>
          <span className="text-sm font-mono text-gray-500">{progress}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
          <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{message}</p>

        {/* 실시간 카운트 */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2">
            <div className="text-gray-500">뉴스</div>
            <div className="font-semibold">{counts.analyzed_news || 0} / {counts.news || 0}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2">
            <div className="text-gray-500">커뮤니티</div>
            <div className="font-semibold">{counts.analyzed_community || 0} / {counts.community || 0}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2">
            <div className="text-gray-500">유튜브</div>
            <div className="font-semibold">{counts.analyzed_youtube || 0} / {counts.youtube || 0}</div>
          </div>
        </div>
      </div>

      {/* 액션 버튼 */}
      {isDone ? (
        <div className="flex gap-3 justify-center mt-5">
          <button onClick={onDone} className="btn-primary px-8 py-3">
            대시보드로 이동
          </button>
        </div>
      ) : isFailed ? (
        <div className="flex gap-3 justify-center mt-5">
          <button onClick={() => window.location.reload()} className="btn-secondary px-6 py-2">
            다시 시도
          </button>
          <button onClick={onDone} className="text-sm text-gray-500 px-4 py-2">
            그래도 대시보드로
          </button>
        </div>
      ) : (
        <div className="text-center mt-4">
          <p className="text-xs text-gray-500">
             보통 1~3분 소요. 탭을 닫아도 백그라운드에서 계속 수집됩니다.
          </p>
          <button onClick={onDone} className="text-xs text-blue-500 hover:underline mt-2">
            지금 대시보드로 건너뛰기 →
          </button>
        </div>
      )}
    </div>
  );
}
