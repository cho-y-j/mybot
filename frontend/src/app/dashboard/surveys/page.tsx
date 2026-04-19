'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import { CANDIDATE_COLORS } from '@/components/charts';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

type TabType = 'trend' | 'all' | 'crosstab' | 'add';

const TYPE_LABEL: Record<string, string> = {
  superintendent: '교육감', mayor: '시장', governor: '도지사',
  gun_head: '군수', gu_head: '구청장', congressional: '국회의원',
  metro_council: '시·도의원', basic_council: '구·시·군의원',
};
const TYPE_COLOR: Record<string, string> = {
  superintendent: 'bg-blue-600', mayor: 'bg-emerald-600', governor: 'bg-violet-600',
  congressional: 'bg-amber-600', metro_council: 'bg-teal-600', basic_council: 'bg-pink-600',
};

const SKIP_KEYS = new Set([
  '모름', '없음', '없다', '모름/무응답', '기타', '그외', '기타 인물', '잘모름',
  '없음/모름', '없다/모름', '기타후보', '기타인물', '기타정당', '소계',
  '지지정당없음', '찬성한다', '반대한다',
]);

function parseResults(r: any): Record<string, number> {
  if (!r) return {};
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return {}; } }
  const flat: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number') flat[k] = v;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v as Record<string, any>)) {
        if (typeof sv === 'number') flat[sk] = sv;
      }
    }
  }
  return flat;
}

// ── 여론조사 등록 폼 ──
function SurveyAddForm({ electionId, onSaved }: { electionId: string; onSaved: () => void }) {
  const [org, setOrg] = useState('');
  const [surveyDate, setSurveyDate] = useState('');
  const [method, setMethod] = useState('');
  const [sampleSize, setSampleSize] = useState('');
  const [moe, setMoe] = useState('');
  const [rows, setRows] = useState<{ name: string; value: string }[]>([
    { name: '', value: '' }, { name: '', value: '' }, { name: '', value: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addRow = () => setRows([...rows, { name: '', value: '' }]);
  const removeRow = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const updateRow = (i: number, field: 'name' | 'value', val: string) => {
    const next = [...rows]; next[i] = { ...next[i], [field]: val }; setRows(next);
  };
  const handleSubmit = async () => {
    if (!org || !surveyDate) { setError('조사기관과 날짜는 필수입니다'); return; }
    const results: Record<string, number> = {};
    rows.forEach(r => { if (r.name.trim() && r.value.trim()) results[r.name.trim()] = parseFloat(r.value); });
    if (Object.keys(results).length === 0) { setError('후보 결과를 1개 이상 입력해주세요'); return; }
    setSaving(true); setError('');
    try {
      await api.createSurvey(electionId, {
        survey_org: org, survey_date: surveyDate, method: method || undefined,
        sample_size: sampleSize ? parseInt(sampleSize) : undefined,
        margin_of_error: moe ? parseFloat(moe) : undefined,
        questions: [{ question_text: '지지율', question_type: 'simple', results }],
      });
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.detail || e?.message || '등록 실패'); }
    finally { setSaving(false); }
  };
  return (
    <div className="card space-y-4">
      <h3 className="font-bold text-lg">여론조사 등록</h3>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-[var(--muted)] mb-1 block">조사기관 *</label>
          <input value={org} onChange={e => setOrg(e.target.value)} placeholder="한국갤럽" className="w-full px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" /></div>
        <div><label className="text-xs text-[var(--muted)] mb-1 block">조사일 *</label>
          <input type="date" value={surveyDate} onChange={e => setSurveyDate(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" /></div>
        <div><label className="text-xs text-[var(--muted)] mb-1 block">조사방법</label>
          <input value={method} onChange={e => setMethod(e.target.value)} placeholder="무선전화면접(100)" className="w-full px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" /></div>
        <div className="flex gap-2">
          <div className="flex-1"><label className="text-xs text-[var(--muted)] mb-1 block">표본수</label>
            <input type="number" value={sampleSize} onChange={e => setSampleSize(e.target.value)} placeholder="500" className="w-full px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" /></div>
          <div className="flex-1"><label className="text-xs text-[var(--muted)] mb-1 block">오차범위(%p)</label>
            <input type="number" step="0.1" value={moe} onChange={e => setMoe(e.target.value)} placeholder="4.4" className="w-full px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" /></div>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-[var(--muted)]">후보별 결과 (%)</label>
          <button onClick={addRow} className="text-xs text-blue-500 hover:underline">+ 후보 추가</button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input value={r.name} onChange={e => updateRow(i, 'name', e.target.value)} placeholder="후보명" className="flex-1 px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm" />
              <input type="number" step="0.1" value={r.value} onChange={e => updateRow(i, 'value', e.target.value)} placeholder="%" className="w-24 px-3 py-2 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-sm text-right" />
              {rows.length > 1 && <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-500 text-lg px-1">&times;</button>}
            </div>
          ))}
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button onClick={handleSubmit} disabled={saving} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {saving ? '등록 중...' : '여론조사 등록'}
      </button>
    </div>
  );
}

// ── 여론조사 카드 ──
function SurveyCard({ survey: s, candidateNames, compact }: { survey: any; candidateNames: string[]; compact?: boolean }) {
  const r = parseResults(s.results);
  const entries = Object.entries(r).filter(([k]) => !SKIP_KEYS.has(k)).sort(([,a],[,b]) => (b as number) - (a as number));
  const undec = ['모름', '없음', '모름/무응답', '없다', '잘모름', '없음/모름'].reduce((sum, k) => sum + (r[k] || 0), 0);
  const maxVal = entries.length > 0 ? Math.max(...entries.map(([,v]) => Number(v) || 0)) : 0;
  const isOur = (name: string) => candidateNames.some(cn => name.includes(cn) || cn.includes(name));
  const hasOurs = s.has_our_candidate;
  const typeLabel = TYPE_LABEL[s.election_type] || s.election_type;
  const typeColor = TYPE_COLOR[s.election_type] || 'bg-gray-500';

  if (compact) {
    // 축소 모드: 상위 3명만 한줄
    const top3 = entries.slice(0, 3);
    return (
      <div className="rounded-lg border border-[var(--card-border)] p-3">
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
          <div className="flex items-center gap-2">
            {s.election_type && <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${typeColor}`}>{typeLabel}</span>}
            <span className="font-medium text-sm">{s.org}</span>
            <span className="text-xs text-[var(--muted)]">{s.date}</span>
          </div>
          <span className="text-xs text-[var(--muted)]">n={s.sample_size || '?'}</span>
        </div>
        {top3.length > 0 ? (
          <div className="flex gap-3 flex-wrap">
            {top3.map(([name, val], i) => {
              const ours = isOur(name);
              return (
                <span key={i} className="text-sm">
                  <span className={ours ? 'font-bold text-blue-500' : i === 0 ? 'font-bold text-amber-500' : 'text-[var(--muted)]'}>{name}</span>
                  <span className={`ml-1 font-bold ${ours ? 'text-blue-500' : i === 0 ? 'text-amber-500' : ''}`}>{val as number}%</span>
                </span>
              );
            })}
          </div>
        ) : <span className="text-xs text-[var(--muted)]">결과 미입력 (메타데이터만)</span>}
      </div>
    );
  }

  // 전체 모드: 바 차트 포함
  return (
    <div className={`p-3 rounded-lg ${hasOurs ? 'bg-[var(--muted-bg)] ring-1 ring-blue-500/20' : 'bg-[var(--muted-bg)] opacity-75'}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          {s.election_type && <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${typeColor}`}>{typeLabel}</span>}
          <span className="font-medium text-sm">{s.org}</span>
          <span className="text-xs text-[var(--muted)]">{s.date}</span>
        </div>
        <div className="text-xs text-[var(--muted)]">
          n={s.sample_size || '?'} | ±{s.margin_of_error || '?'}%p
          {undec > 0 && <span className="text-amber-500 ml-2">부동층 {undec.toFixed(1)}%</span>}
        </div>
      </div>
      {entries.length === 0 ? (
        <span className="text-xs text-[var(--muted)]">결과 미입력 (메타데이터만)</span>
      ) : <div className="space-y-1.5">
        {entries.map(([name, val], j) => {
          const v = Number(val) || 0;
          const ours = isOur(name);
          const isMax = v === maxVal && v > 0;
          return (
            <div key={name} className="flex items-center gap-2">
              <span className={`w-28 text-xs truncate ${ours ? 'text-blue-500 font-bold' : ''}`}>
                {name}{ours ? ' ' : ''}
              </span>
              <div className="flex-1 h-2.5 bg-[var(--card-border)] rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${v / 50 * 100}%`, backgroundColor: ours ? '#3b82f6' : isMax ? '#f59e0b' : CANDIDATE_COLORS[j % CANDIDATE_COLORS.length] }} />
              </div>
              <span className={`w-12 text-right text-xs font-mono ${isMax ? 'font-bold text-amber-500' : ours ? 'text-blue-500' : ''}`}>
                {v}%
              </span>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

// ── 2026-04-19: 그룹핑된 여론조사 카드 (1개 조사 = 여러 질문) ──
function GroupedSurveyCard({
  group,
  ourType,
  ourCandName,
  candidateNames,
  compact,
}: {
  group: any;
  ourType?: string;
  ourCandName?: string;
  candidateNames: string[];
  compact?: boolean;
}) {
  const isOur = (name: string) => candidateNames.some(cn => name.includes(cn) || cn.includes(name));
  return (
    <div className={`rounded-xl border ${group.is_our_election ? 'border-blue-500/30 bg-blue-500/5' : 'border-[var(--card-border)] bg-[var(--muted-bg)]'} p-3 space-y-3`}>
      {/* 조사 메타 */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[var(--card-border)]/50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{group.survey_org}</span>
          <span className="text-xs text-[var(--muted)]">{group.survey_date}</span>
          {group.region_sido && (
            <span className="text-xs text-[var(--muted)]">· {group.region_sido} {group.region_sigungu || ''}</span>
          )}
        </div>
        <div className="text-[11px] text-[var(--muted)]">
          {group.sample_size && <>n={group.sample_size}</>}
          {group.margin_of_error && <> · ±{group.margin_of_error}%p</>}
          {group.questions?.length > 1 && <span className="ml-2 text-[var(--foreground)]">질문 {group.questions.length}개</span>}
        </div>
      </div>

      {/* 질문별 결과 */}
      {(group.questions || []).map((q: any, qi: number) => {
        const results = q.results || {};
        // 2026-04-19: 후보 vs 비후보(모름/없음/기타) 분리. 비후보는 무조건 하단.
        const NON_CAND_PATTERNS = ['모름', '없음', '없다', '잘모름', '무응답', '응답', '기타', '지지정당없음', '선택', '해당없음'];
        const isNonCand = (k: string) =>
          NON_CAND_PATTERNS.some(p => k.includes(p)) ||
          // 후보 이름이 아닌 메타 카테고리 키 (dict 키가 한글 1~2글자면서 숫자 응답 분포) 방어
          k.length === 0;
        const all = Object.entries(results)
          .map(([k, v]) => [k, Number(v) || 0] as [string, number]);
        const candEntries = all.filter(([k]) => !isNonCand(k)).sort((a, b) => b[1] - a[1]);
        const otherEntries = all.filter(([k]) => isNonCand(k)).sort((a, b) => b[1] - a[1]);
        const maxVal = candEntries.length > 0 ? Math.max(...candEntries.map(([, v]) => v)) : 0;
        // 렌더용으로 합침 — 후보 먼저, 비후보는 뒤 (시각적으로 구분)
        const entries = candEntries;
        const isOurQ = q.is_our_election_type;
        const typeLabel: Record<string, string> = {
          superintendent: '교육감', mayor: '시장', governor: '도지사',
          gun_head: '군수', gu_head: '구청장', congressional: '국회의원',
        };
        const etLabel = typeLabel[q.election_type || ''] || q.election_type || '지지율';

        return (
          <div key={q.id || qi} className={`${isOurQ ? '' : 'opacity-70'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isOurQ ? 'bg-blue-600 text-white' : 'bg-[var(--muted-bg)] text-[var(--muted)]'}`}>
                {etLabel}
              </span>
              {isOurQ && <span className="text-[10px] text-blue-500 font-semibold">★ 우리 선거</span>}
              {q.has_our_candidate && q.our_rank && ourCandName && (
                <span className="text-[10px] text-[var(--muted)]">
                  {ourCandName} {q.our_rank}위 · {q.our_value}%
                </span>
              )}
            </div>
            {entries.length === 0 ? (
              <p className="text-[11px] text-[var(--muted)]">결과 미입력</p>
            ) : compact ? (
              // 참고용: 상위 3명만
              <div className="flex gap-3 flex-wrap text-xs">
                {entries.slice(0, 3).map(([n, v], i) => (
                  <span key={n}>
                    <span className={i === 0 ? 'font-bold' : ''}>{n}</span>
                    <span className="ml-1 font-mono">{v}%</span>
                  </span>
                ))}
              </div>
            ) : (
              // 상세: 바 차트 (후보만 상단, 비후보는 하단 회색 별도)
              <div className="space-y-1">
                {entries.slice(0, 8).map(([name, val]) => {
                  const ours = isOur(name);
                  const isMax = val === maxVal && val > 0;
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <span className={`w-24 text-xs truncate ${ours ? 'text-blue-500 font-bold' : ''}`}>
                        {name}{ours ? ' ★' : ''}
                      </span>
                      <div className="flex-1 h-2 bg-[var(--card-border)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (val / Math.max(maxVal, 1)) * 100)}%`,
                            backgroundColor: ours ? '#3b82f6' : isMax ? '#f59e0b' : '#94a3b8',
                          }} />
                      </div>
                      <span className={`w-12 text-right text-xs font-mono ${isMax ? 'font-bold text-amber-500' : ours ? 'text-blue-500' : ''}`}>
                        {val}%
                      </span>
                    </div>
                  );
                })}
                {/* 비후보 응답(모름/없음/기타) — 하단 회색 구역 */}
                {otherEntries.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[var(--card-border)]/40">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--muted)]">
                      <span className="opacity-70">부동층·기타:</span>
                      {otherEntries.map(([n, v]) => (
                        <span key={n} className="whitespace-nowrap">
                          <span>{n}</span>
                          <span className="ml-1 font-mono opacity-80">{v}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════
// 메인 페이지
// ══════════════════════════════════════
export default function SurveysPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const [surveys, setSurveys] = useState<any[]>([]);
  // 2026-04-19: 그룹핑된 데이터 (API 레벨에서 org+date+region 기준 묶음 + 우리 선거/참고 분리)
  const [grouped, setGrouped] = useState<{
    our_election_type?: string;
    our_candidates?: string[];
    our_candidate_name?: string;
    groups?: any[];
    total_groups?: number;
    total_questions?: number;
  } | null>(null);
  const [deepData, setDeepData] = useState<any>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  // 2026-04-19: 기본 탭을 'all'(그룹핑된 여론조사)로. 구 overview는 AI 분석 전용 요약.
  const [tab, setTab] = useState<TabType>('all');
  const [expandedAI, setExpandedAI] = useState(false);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [selectedCrosstabs, setSelectedCrosstabs] = useState<any>(null);
  const [loadingCrosstab, setLoadingCrosstab] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    if (election) {
      loadSurveys();
      loadCachedDeepAnalysis();  // 캐시 있으면 즉시 표시, 없으면 조용히 스킵
    }
  }, [election?.id]);

  const loadCachedDeepAnalysis = async () => {
    if (!election) return;
    try {
      const r = await api.getSurveyDeepAnalysis(election.id, { cacheOnly: true });
      if (r?._cache?.hit) setDeepData(r);
    } catch {}
  };

  const loadSurveys = async () => {
    if (!election) return;
    try {
      const [d, g] = await Promise.all([
        api.getSurveys(election.id),
        api.getSurveysGrouped(election.id).catch(() => null),
      ]);
      setSurveys(d.surveys || []);
      setGrouped(g);
    } catch (e: any) { console.error('survey load error:', e); }
    finally { setLoading(false); }
  };
  // 실행/재분석 — 항상 서버에서 새로 생성 (캐시 무효화)
  const loadDeepAnalysis = async () => {
    if (!election) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const hasCache = deepData?._cache?.hit;
      const r = await api.getSurveyDeepAnalysis(election.id, { force: hasCache });
      if (r?.error) {
        setAnalyzeError(r.error);
      } else if (r?.sections?.ai_strategy?.ai_generated === false) {
        const detail = r.sections.ai_strategy.text || '';
        setAnalyzeError(`AI 분석을 완성하지 못했습니다. ${detail.slice(0, 200)}`);
      }
      setDeepData(r);
    } catch (e: any) {
      setAnalyzeError(`분석 요청 실패: ${e?.message || '알 수 없는 오류'}`);
    } finally {
      setAnalyzing(false);
    }
  };
  const loadCrosstab = async (surveyId: string) => {
    if (!election) return; setLoadingCrosstab(true); setSelectedSurveyId(surveyId);
    try { setSelectedCrosstabs(await api.getSurveyCrosstabs(election.id, surveyId)); }
    catch (e: any) { setSelectedCrosstabs(null); }
    finally { setLoadingCrosstab(false); }
  };

  // 등록된 후보 이름
  const candidateNames = useMemo(() =>
    candidates.filter(c => c.enabled).map(c => c.name),
    [candidates]);

  const isOurCandidate = (name: string) =>
    candidateNames.some(cn => name.includes(cn) || cn.includes(name));

  // ── 우리 후보 포함 여론조사만 (지지율/추이용) ──
  const ourSurveys = useMemo(() =>
    surveys.filter(s => s.has_our_candidate),
    [surveys]);

  // ── 추이 차트: 등록된 후보 이름 기준으로 모든 여론조사에서 추출 ──
  const trendData = useMemo(() => {
    return [...ourSurveys].reverse().map(s => {
      const r = parseResults(s.results);
      const row: any = { date: s.date?.substring(2, 7)?.replace('-', '/') || '', org: s.org, fullDate: s.date };
      candidateNames.forEach(cn => {
        // 정확히 일치하거나 포함하는 키 찾기
        for (const [k, v] of Object.entries(r)) {
          if (k.includes(cn) || cn.includes(k)) { row[cn] = v; break; }
        }
      });
      const undecided = ['모름', '없음', '모름/무응답', '잘모름', '없음/모름'].reduce((sum, k) => sum + (r[k] || 0), 0);
      if (undecided > 0) row['부동층'] = undecided;
      return row;
    });
  }, [ourSurveys, candidateNames]);

  // 전체 보기: 유형별 카운트
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: surveys.length };
    surveys.forEach(s => {
      const t = s.election_type || 'untagged';
      counts[t] = (counts[t] || 0) + 1;
    });
    if (surveys.some(s => s.has_our_candidate)) counts['ours'] = surveys.filter(s => s.has_our_candidate).length;
    return counts;
  }, [surveys]);

  // 필터된 목록
  const filteredSurveys = useMemo(() => {
    if (typeFilter === 'all') return surveys;
    if (typeFilter === 'ours') return surveys.filter(s => s.has_our_candidate);
    if (typeFilter === 'untagged') return surveys.filter(s => !s.election_type);
    return surveys.filter(s => s.election_type === typeFilter);
  }, [surveys, typeFilter]);

  const myType = election?.election_type || '';
  const myTypeLabel = TYPE_LABEL[myType] || myType;

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  // 최신 (우리 후보 포함)
  const latest = ourSurveys[0];
  const latestR = latest ? parseResults(latest.results) : {};

  // AI 분석
  const sections = deepData?.sections || {};
  const sw = sections.strength_weakness || {};
  const aiStrategy = sections.ai_strategy || {};

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">여론조사 분석</h1>
          <p className="text-sm text-[var(--muted)]">
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded text-white font-bold mr-1 ${TYPE_COLOR[myType] || 'bg-gray-600'}`}>{myTypeLabel}</span>
            우리 후보 관련 {ourSurveys.length}건 · 전체 {surveys.length}건
          </p>
        </div>
        <button onClick={loadDeepAnalysis} disabled={analyzing}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50">
          {analyzing ? '분석 중...' : 'AI 분석'}
        </button>
      </div>

      {/* 탭 (2026-04-19: AI 분석 탭 제거 — 콘텐츠는 여론조사/교차분석 탭 상단에 통합) */}
      <div className="flex gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
        {([
          ['all', `여론조사 (${grouped?.total_groups ?? 0})`],
          ['trend', '추이 분석'],
          ['crosstab', '교차 분석'],
          ['add', '등록'],
        ] as [TabType, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ 지지율 현황 ═══ */}
      {/* ═══ 추이 분석 (우리 후보만!) ═══ */}
      {tab === 'trend' && (
        <>
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${TYPE_COLOR[myType] || 'bg-gray-600'}`}>{myTypeLabel}</span>
              <h3 className="font-bold">후보별 지지율 추이</h3>
              <span className="text-xs text-[var(--muted)]">{candidateNames.join(' · ')} ({ourSurveys.length}건)</span>
            </div>
            {trendData.length >= 2 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12 }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate || ''} />
                  <Legend />
                  {candidateNames.map((name, i) => (
                    <Line key={name} type="monotone" dataKey={name}
                      stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
                      strokeWidth={name === ourCandidate?.name ? 3 : 2}
                      dot={{ r: name === ourCandidate?.name ? 5 : 3, fill: CANDIDATE_COLORS[i % CANDIDATE_COLORS.length] }}
                      activeDot={{ r: 7 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-[var(--muted)] text-center py-8">2건 이상 여론조사가 필요합니다</p>}
          </div>

          {/* 부동층 추이 */}
          {trendData.filter(d => d['부동층']).length >= 2 && (
            <div className="card">
              <h3 className="font-bold mb-4">부동층 추이</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData.filter(d => d['부동층'])} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <defs><linearGradient id="undecidedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12 }} />
                  <Area type="monotone" dataKey="부동층" stroke="#f59e0b" fill="url(#undecidedGrad)" strokeWidth={2.5} dot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 조사별 상세 */}
          <div className="card">
            <h3 className="font-bold mb-3">조사별 상세</h3>
            <div className="space-y-2">
              {ourSurveys.map((s, i) => {
                const r = parseResults(s.results);
                return (
                  <div key={i} className="p-3 rounded-lg bg-[var(--muted-bg)]">
                    <div className="flex items-center gap-2 mb-2">
                      {s.election_type && <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${TYPE_COLOR[s.election_type] || 'bg-gray-500'}`}>{TYPE_LABEL[s.election_type] || ''}</span>}
                      <span className="font-medium">{s.date}</span>
                      <span className="text-xs text-[var(--muted)]">{s.org} | n={s.sample_size || '?'}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(r).filter(([k]) => !SKIP_KEYS.has(k)).sort(([,a],[,b]) => (b as number) - (a as number)).map(([n, v]) => (
                        <span key={n} className={`text-xs px-2 py-1 rounded-full ${isOurCandidate(n) ? 'bg-blue-500/20 text-blue-500 font-bold' : 'bg-[var(--card-border)]'}`}>
                          {n} {v}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══ 여론조사 (all) = 그룹핑된 조사 단위 + AI 전략 분석 통합 ═══ */}
      {tab === 'all' && (
        <div className="card bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="font-bold">AI 전략 분석</h3>
              {deepData?._cache?.hit && deepData._cache.generated_at && (
                <span className="text-[10px] text-[var(--muted)]">
                  분석 시점: {new Date(deepData._cache.generated_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {deepData._cache.age_hours !== undefined && ` · ${deepData._cache.age_hours < 24 ? `${Math.round(deepData._cache.age_hours)}시간 전` : `${Math.round(deepData._cache.age_hours/24)}일 전`}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadDeepAnalysis} disabled={analyzing}
                className="text-xs px-3 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
                {analyzing ? '분석 중... (약 30초)' : aiStrategy?.text ? '재분석' : 'AI 분석 실행'}
              </button>
              {aiStrategy?.text && (
                <button onClick={() => setExpandedAI(!expandedAI)} className="text-xs text-blue-500">
                  {expandedAI ? '접기' : '전체 보기'}
                </button>
              )}
            </div>
          </div>
          {deepData?._cache?.stale && deepData._cache.stale_reason && (
            <div className="mb-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 p-2 rounded flex items-center justify-between gap-2">
              <span>{deepData._cache.stale_reason}</span>
              <button onClick={loadDeepAnalysis} disabled={analyzing} className="underline font-medium hover:text-amber-500">
                지금 재분석
              </button>
            </div>
          )}
          {analyzeError && (
            <div className="mb-2 text-xs bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 p-2 rounded">
              {analyzeError}
            </div>
          )}
          {aiStrategy?.text ? (
            <div className={`text-sm leading-relaxed whitespace-pre-line ${!expandedAI ? 'max-h-40 overflow-hidden' : ''}`}>
              {aiStrategy.text}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">아직 AI 전략 분석이 없습니다. 오른쪽 버튼을 눌러 실행하세요.</p>
          )}
        </div>
      )}
      {tab === 'all' && grouped && (() => {
        const groups = grouped.groups || [];
        const ours = groups.filter(g => g.is_our_election);
        const others = groups.filter(g => !g.is_our_election);
        const otherByType: Record<string, any[]> = {};
        others.forEach(g => {
          const t = g.questions?.[0]?.election_type || 'untagged';
          (otherByType[t] = otherByType[t] || []).push(g);
        });
        const TYPE_ORDER = ['superintendent', 'governor', 'congressional', 'mayor', 'gun_head', 'gu_head'];
        const otherTypes = [
          ...TYPE_ORDER.filter(t => otherByType[t]),
          ...Object.keys(otherByType).filter(t => !TYPE_ORDER.includes(t) && t !== 'untagged').sort(),
          ...(otherByType['untagged'] ? ['untagged'] : []),
        ];
        return (
          <div className="space-y-6">
            {/* ── 우리 선거 조사 ── */}
            <section>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-blue-500/30">
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white font-bold">{TYPE_LABEL[grouped.our_election_type || ''] || '우리 선거'}</span>
                <h3 className="font-bold">{grouped.our_candidate_name ? `${grouped.our_candidate_name} 후보` : '우리 선거'} 관련 여론조사</h3>
                <span className="text-xs text-[var(--muted)]">({ours.length}건)</span>
              </div>
              {ours.length === 0 ? (
                <div className="card text-center py-8 text-[var(--muted)]">
                  <p className="text-sm">우리 선거 관련 여론조사가 없습니다.</p>
                  <p className="text-xs mt-2">"등록" 탭에서 직접 입력하세요.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ours.map((g, i) => (
                    <GroupedSurveyCard key={g.group_key || i} group={g} ourType={grouped.our_election_type} ourCandName={grouped.our_candidate_name} candidateNames={candidateNames} />
                  ))}
                </div>
              )}
            </section>

            {/* ── 참고: 다른 선거 여론조사 (같은 지역) ── */}
            {others.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-[var(--card-border)]">
                  <h3 className="font-bold text-[var(--muted)]">참고 — 같은 지역 다른 선거 여론조사</h3>
                  <span className="text-xs text-[var(--muted)]">({others.length}건)</span>
                </div>
                {/* 선거 유형별 서브탭 */}
                <div className="flex gap-2 flex-wrap mb-3">
                  {otherTypes.map(t => {
                    const label = t === 'untagged' ? '미분류' : (TYPE_LABEL[t] || t);
                    const color = TYPE_COLOR[t] || 'bg-gray-500';
                    const active = typeFilter === t || (typeFilter === 'all' && otherTypes[0] === t);
                    return (
                      <button key={t} onClick={() => setTypeFilter(t)}
                        className={`text-xs px-3 py-1 rounded-full transition font-medium ${active ? `${color} text-white` : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
                        {label} ({otherByType[t].length})
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const activeType = otherTypes.includes(typeFilter) ? typeFilter : otherTypes[0];
                  const rows = otherByType[activeType] || [];
                  return (
                    <div className="space-y-2 opacity-85">
                      {rows.map((g, i) => (
                        <GroupedSurveyCard key={g.group_key || i} group={g} ourType={grouped.our_election_type} ourCandName={grouped.our_candidate_name} candidateNames={candidateNames} compact />
                      ))}
                    </div>
                  );
                })()}
              </section>
            )}

            {groups.length === 0 && (
              <div className="card text-center py-8 text-[var(--muted)]">여론조사 자료가 없습니다.</div>
            )}
          </div>
        );
      })()}

      {/* ═══ 교차 분석 ═══ (2026-04-19: AI 세그먼트 분석 통합) */}
      {tab === 'crosstab' && (
        <>
          {/* AI 세그먼트 분석 — 이전 overview 탭에서 이동 */}
          {((sw.strengths || []).length > 0 || (sw.weaknesses || []).length > 0) ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="card">
                <h3 className="font-bold text-green-600 mb-3">강점 세그먼트 ({ourCandidate?.name} 우위)</h3>
                {(sw.strengths || []).map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 mb-1 rounded-lg bg-green-500/5 text-sm">
                    <span><span className="text-xs text-[var(--muted)]">[{s.dimension}]</span> {s.segment}</span>
                    <span className="font-bold text-green-600">+{s.gap}%p</span>
                  </div>
                ))}
                {(sw.strengths || []).length === 0 && <p className="text-xs text-[var(--muted)]">아직 분석 전</p>}
              </div>
              <div className="card">
                <h3 className="font-bold text-red-600 mb-3">약점 세그먼트 ({ourCandidate?.name} 열세)</h3>
                {(sw.weaknesses || []).slice(0, 8).map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 mb-1 rounded-lg bg-red-500/5 text-sm">
                    <span><span className="text-xs text-[var(--muted)]">[{s.dimension}]</span> {s.segment}</span>
                    <span className="font-bold text-red-600">{s.gap}%p</span>
                  </div>
                ))}
                {(sw.weaknesses || []).length === 0 && <p className="text-xs text-[var(--muted)]">아직 분석 전</p>}
              </div>
            </div>
          ) : (
            <div className="card mb-4 text-center py-4">
              <p className="text-xs text-[var(--muted)] mb-2">AI 세그먼트 분석이 아직 없습니다 (교차분석 기반 강점/약점 세그먼트)</p>
              <button onClick={loadDeepAnalysis} disabled={analyzing}
                className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
                {analyzing ? '분석 중...' : '세그먼트 분석 실행'}
              </button>
            </div>
          )}

          <div className="card">
            <h3 className="font-bold mb-3">여론조사 선택 (교차분석 데이터 있는 것만)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {ourSurveys.filter(s => (s.question_count || 0) > 0).map((s) => (
                <button key={s.id} onClick={() => loadCrosstab(s.id)}
                  className={`text-left p-3 rounded-xl border transition ${selectedSurveyId === s.id ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--card-border)] hover:bg-[var(--muted-bg)]'}`}>
                  <div className="font-semibold text-sm">{s.date}</div>
                  <div className="text-xs text-[var(--muted)]">{s.org}</div>
                  <div className="text-xs text-[var(--muted)]">n={s.sample_size} | 질문 {s.question_count}개</div>
                </button>
              ))}
              {ourSurveys.filter(s => (s.question_count || 0) > 0).length === 0 && (
                <div className="col-span-3 text-center py-8 text-[var(--muted)] text-sm">교차분석 데이터가 있는 여론조사가 없습니다.</div>
              )}
            </div>
          </div>

          {loadingCrosstab && <div className="text-center py-8"><div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" /></div>}
          {!selectedSurveyId && !loadingCrosstab && (
            <div className="card text-center py-12 text-[var(--muted)]">위에서 여론조사를 선택하면 교차분석이 표시됩니다.</div>
          )}
          {selectedSurveyId && selectedCrosstabs && !selectedCrosstabs.has_crosstabs && !loadingCrosstab && (
            <div className="card text-center py-12 text-[var(--muted)]">이 여론조사에는 교차분석 데이터가 없습니다.</div>
          )}
          {selectedCrosstabs?.has_crosstabs && !loadingCrosstab && (
            <>
              <div className="text-sm text-[var(--muted)] mb-2">{selectedCrosstabs.survey?.org} ({selectedCrosstabs.survey?.date}) 교차분석</div>
              {Object.entries(selectedCrosstabs.crosstabs || {}).map(([dim, segments]: [string, any]) => {
                const dimCands = new Set<string>();
                (segments as any[]).forEach((seg: any) => Object.keys(seg.candidates || {}).forEach(k => dimCands.add(k)));
                const dimCandList = Array.from(dimCands);
                if (dimCandList.length === 0) return null;
                return (
                  <div key={dim} className="card">
                    <h3 className="font-bold mb-3">{dim}별 지지율</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--card-border)]">
                            <th className="text-left p-2 text-[var(--muted)]">{dim}</th>
                            {dimCandList.map(n => (
                              <th key={n} className={`text-right p-2 ${isOurCandidate(n) ? 'text-blue-500' : 'text-[var(--muted)]'}`}>{n}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(segments as any[]).map((seg: any, i: number) => {
                            const vals = dimCandList.map(n => seg.candidates?.[n] || 0);
                            const maxVal = Math.max(...vals);
                            return (
                              <tr key={i} className="border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)]">
                                <td className="p-2 font-medium">{seg.segment}</td>
                                {dimCandList.map(n => {
                                  const v = seg.candidates?.[n];
                                  const isMax = v === maxVal && v > 0;
                                  return (
                                    <td key={n} className={`p-2 text-right font-mono ${isMax ? 'font-bold bg-amber-500/10' : isOurCandidate(n) ? 'text-blue-500' : ''}`}>
                                      {v !== undefined ? `${v}%` : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ═══ 등록 ═══ */}
      {tab === 'add' && <SurveyAddForm electionId={election.id} onSaved={() => { setTab('all'); loadSurveys(); }} />}
    </div>
  );
}
