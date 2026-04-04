'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SurveyTrendChart } from '@/components/charts';

export default function SurveysPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    survey_org: '', survey_date: '', method: '', sample_size: '', margin_of_error: '',
  });
  const [questions, setQuestions] = useState<any[]>([
    { question_text: '', question_type: 'simple', condition_text: '', results: {} },
  ]);

  // Candidate names: our candidate first
  const candNames = (() => {
    const enabled = candidates.filter(c => c.enabled).map(c => c.name);
    if (!ourCandidate) return enabled;
    return [ourCandidate.name, ...enabled.filter(n => n !== ourCandidate.name)];
  })();

  useEffect(() => {
    if (election) loadSurveys();
  }, [election]);

  const loadSurveys = async () => {
    if (!election) return;
    setError(null);
    try {
      const d = await api.getSurveys(election.id);
      setSurveys(d.surveys || []);
    } catch (e: any) {
      setError(e.message || '여론조사 데이터를 불러올 수 없습니다.');
      setSurveys([]);
    } finally { setLoading(false); }
  };

  const handleAddQuestion = () => {
    setQuestions([...questions, { question_text: '', question_type: 'simple', condition_text: '', results: {} }]);
  };

  const updateQuestion = (idx: number, field: string, value: any) => {
    const updated = [...questions];
    updated[idx] = { ...updated[idx], [field]: value };
    setQuestions(updated);
  };

  const updateQuestionResult = (qIdx: number, candidateName: string, value: string) => {
    const updated = [...questions];
    const results = { ...updated[qIdx].results };
    results[candidateName] = parseFloat(value) || 0;
    updated[qIdx] = { ...updated[qIdx], results };
    setQuestions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!election) return;
    try {
      await api.createSurvey(election.id, {
        ...form,
        sample_size: parseInt(form.sample_size) || null,
        margin_of_error: parseFloat(form.margin_of_error) || null,
        questions,
      });
      setShowAdd(false);
      setForm({ survey_org: '', survey_date: '', method: '', sample_size: '', margin_of_error: '' });
      setQuestions([{ question_text: '', question_type: 'simple', condition_text: '', results: {} }]);
      loadSurveys();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!election || !confirm('삭제하시겠습니까?')) return;
    try { await api.deleteSurvey(election.id, id); loadSurveys(); } catch {}
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  if (error) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">여론조사</h1>
      <div className="card text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={loadSurveys} className="btn-primary text-sm">다시 시도</button>
      </div>
    </div>
  );

  // Parse results safely (might be string or object)
  const parseResults = (r: any): Record<string, number> => {
    if (!r) return {};
    if (typeof r === 'string') {
      try { return JSON.parse(r); } catch { return {}; }
    }
    return r;
  };

  // Trend chart data
  const trendData = surveys.filter(s => {
    const r = parseResults(s.results);
    return r && Object.keys(r).length > 0;
  })
    .reverse()
    .map(s => {
      const r = parseResults(s.results);
      const row: any = { date: s.date?.substring(5) || '' };
      candNames.forEach(n => { row[n] = r[n] || 0; });
      return row;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">여론조사</h1>
          <p className="text-gray-500 mt-1">총 {surveys.length}건 | 실시간 데이터</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm">+ 여론조사 등록</button>
      </div>

      {/* Trend Chart */}
      {trendData.length >= 2 && (
        <div className="card">
          <h3 className="font-semibold mb-4">후보별 지지율 추이</h3>
          <SurveyTrendChart data={trendData} candidates={candNames} />
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className="card border-2 border-primary-200">
          <h3 className="font-semibold mb-4">여론조사 등록</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">조사기관 *</label>
                <input className="input-field" value={form.survey_org} onChange={e => setForm({...form, survey_org: e.target.value})} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">조사일 *</label>
                <input type="date" className="input-field" value={form.survey_date} onChange={e => setForm({...form, survey_date: e.target.value})} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">표본수</label>
                <input className="input-field" value={form.sample_size} onChange={e => setForm({...form, sample_size: e.target.value})} placeholder="1000" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">오차범위 (%p)</label>
                <input className="input-field" value={form.margin_of_error} onChange={e => setForm({...form, margin_of_error: e.target.value})} placeholder="3.1" />
              </div>
            </div>

            {/* Questions */}
            {questions.map((q, qi) => (
              <div key={qi} className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">질문 {qi + 1}</span>
                  <select className="input-field w-36 text-sm" value={q.question_type}
                    onChange={e => updateQuestion(qi, 'question_type', e.target.value)}>
                    <option value="simple">단순 지지율</option>
                    <option value="conditional">조건부</option>
                    <option value="issue_based">이슈별</option>
                    <option value="matchup">양자대결</option>
                  </select>
                </div>
                <input className="input-field" value={q.question_text}
                  onChange={e => updateQuestion(qi, 'question_text', e.target.value)}
                  placeholder="질문: 교육감 후보 중 누구를 지지하십니까?" />
                {q.question_type !== 'simple' && (
                  <input className="input-field" value={q.condition_text}
                    onChange={e => updateQuestion(qi, 'condition_text', e.target.value)}
                    placeholder="조건: 진보 단일화 가정" />
                )}
                {/* Candidate result inputs - our candidate first */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {candNames.map(name => (
                    <div key={name} className="flex items-center gap-1">
                      <span className="text-xs text-gray-600 w-16 truncate">{name}</span>
                      <input className="input-field text-sm w-20" type="number" step="0.1"
                        placeholder="%" value={q.results[name] || ''}
                        onChange={e => updateQuestionResult(qi, name, e.target.value)} />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 w-16">모름/무응답</span>
                    <input className="input-field text-sm w-20" type="number" step="0.1"
                      placeholder="%" value={q.results['모름/무응답'] || ''}
                      onChange={e => updateQuestionResult(qi, '모름/무응답', e.target.value)} />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                </div>
              </div>
            ))}

            <button type="button" onClick={handleAddQuestion} className="text-sm text-primary-600">+ 질문 추가</button>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary">등록</button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">취소</button>
            </div>
          </form>
        </div>
      )}

      {/* Survey List */}
      {surveys.length === 0 && !showAdd && (
        <div className="card text-center py-12 text-gray-400">
          등록된 여론조사가 없습니다.
        </div>
      )}

      <div className="space-y-3">
        {surveys.map(s => {
          const r = parseResults(s.results);
          // Sort: our candidate first, then by value desc
          const sorted = Object.entries(r).sort((a: any, b: any) => {
            const aOurs = a[0] === ourCandidate?.name;
            const bOurs = b[0] === ourCandidate?.name;
            if (aOurs && !bOurs) return -1;
            if (!aOurs && bOurs) return 1;
            return b[1] - a[1];
          });

          return (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{s.org}</span>
                    <span className="text-xs text-gray-400">{s.date}</span>
                    {s.question_count > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">질문 {s.question_count}개</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.method || '-'} | n={s.sample_size || '-'}{s.margin_of_error ? ` | \u00B1${s.margin_of_error}%p` : ''}
                  </p>
                </div>
                <button onClick={() => handleDelete(s.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
              </div>
              {/* Results bar chart */}
              <div className="space-y-2">
                {sorted.map(([name, value]: [string, any]) => {
                  const cand = candidates.find(c => c.name === name);
                  const isOurs = cand?.is_our_candidate || false;
                  const color = isOurs ? '#3b82f6' : name.includes('모름') ? '#cbd5e1' : '#64748b';
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <span className={`text-sm w-24 truncate ${isOurs ? 'font-bold text-blue-600' : 'text-gray-700'}`}>
                        {name}
                      </span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all flex items-center pl-2"
                          style={{ width: `${Math.max((value as number) / 60 * 100, 5)}%`, backgroundColor: color }}>
                          <span className="text-[11px] text-white font-bold">{(value as number).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
