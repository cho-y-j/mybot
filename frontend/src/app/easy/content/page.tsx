'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const CONTENT_TYPES = [
  { value: 'blog', icon: '📝', label: '블로그 글', desc: '네이버 블로그·공식 사이트용 (1000~2000자)' },
  { value: 'sns', icon: '📱', label: 'SNS 포스팅', desc: '페이스북·인스타그램·X (500자 이내)' },
  { value: 'card', icon: '🎨', label: '카드뉴스', desc: '이미지 카드용 짧은 메시지' },
  { value: 'press', icon: '📰', label: '보도자료', desc: '언론사 송부용 공식 자료' },
  { value: 'defense', icon: '🛡️', label: '해명 자료', desc: '부정 보도 대응용' },
];

const PURPOSES = [
  { value: 'promote', label: '홍보/강점 확산' },
  { value: 'defend', label: '해명/방어' },
  { value: 'attack', label: '경쟁자 견제' },
  { value: 'inform', label: '정보 안내' },
];

const TARGETS = [
  { value: 'all', label: '전체 유권자' },
  { value: 'parents', label: '학부모' },
  { value: 'youth', label: '청년층 (20~30대)' },
  { value: 'senior', label: '시니어층 (50~60대)' },
];

const STYLES = [
  { value: 'formal', label: '공식 격식체' },
  { value: 'casual', label: '친근 구어체' },
  { value: 'emotional', label: '감성 공감' },
  { value: 'technical', label: '전문 정책' },
];

function ContentWizardInner() {
  const { election } = useElection();
  const params = useSearchParams();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contentType, setContentType] = useState(params.get('type') || 'blog');
  const [topic, setTopic] = useState(params.get('topic') || '');
  const [purpose, setPurpose] = useState(params.get('purpose') || 'promote');
  const [target, setTarget] = useState(params.get('target') || 'all');
  const [style, setStyle] = useState(params.get('style') || 'formal');

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (params.get('topic')) setStep(3);
    else if (params.get('type')) setStep(2);
  }, []);

  useEffect(() => {
    if (step !== 2 || !election?.id) return;
    loadSuggestions();
  }, [step, contentType, election?.id]);

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const r = await fetch(`/api/content/content-situations/${election?.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      });
      if (r.ok) {
        const data = await r.json();
        setSuggestions((data.situations || []).map((s: any) => s.topic));
      }
    } catch {}
    finally { setLoadingSuggestions(false); }
  };

  const generate = async () => {
    if (!election?.id || !topic.trim()) return;
    setGenerating(true);
    try {
      const t = localStorage.getItem('access_token');
      const p = new URLSearchParams({
        content_type: contentType,
        topic: topic.trim(),
        style,
        purpose,
        target,
      });
      const r = await fetch(`/api/content/generate-content/${election.id}?${p}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await r.json();
      setResult(data);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally { setGenerating(false); }
  };

  // ───────── Step 1: 유형 선택 ─────────
  if (step === 1) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">📝 콘텐츠 만들기</h1>
          <p className="text-sm text-[var(--muted)] mt-1">1/3 단계 — 어떤 콘텐츠를 만들까요?</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CONTENT_TYPES.map(c => (
            <button key={c.value}
              onClick={() => { setContentType(c.value); setStep(2); }}
              className={`border-2 rounded-xl p-5 text-left hover:border-blue-500 transition ${
                contentType === c.value ? 'border-blue-500 bg-blue-500/5' : 'border-[var(--card-border)]'
              }`}>
              <div className="text-4xl mb-2">{c.icon}</div>
              <div className="font-bold text-base">{c.label}</div>
              <div className="text-xs text-[var(--muted)] mt-1">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ───────── Step 2: 주제 선택 ─────────
  if (step === 2) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(1)}
            className="text-sm text-[var(--muted)] hover:text-blue-500">← 이전</button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">무엇에 대해 쓸까요?</h1>
            <p className="text-xs text-[var(--muted)] mt-1">2/3 단계 — {CONTENT_TYPES.find(c => c.value === contentType)?.label}</p>
          </div>
        </div>

        {/* AI 추천 주제 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">💡 AI 추천 주제</h2>
            <button onClick={loadSuggestions} className="text-xs text-[var(--muted)] hover:text-blue-500">↻</button>
          </div>
          {loadingSuggestions ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-[var(--muted-bg)] rounded animate-pulse" />
              ))}
            </div>
          ) : suggestions.length > 0 ? (
            <div className="space-y-2">
              {suggestions.slice(0, 5).map((s, i) => (
                <button key={i}
                  onClick={() => { setTopic(s); setStep(3); }}
                  className="w-full text-left px-4 py-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:border-blue-500 transition text-sm">
                  → {s}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">추천 주제가 없습니다. 직접 입력해주세요.</p>
          )}
        </div>

        {/* 직접 입력 */}
        <div>
          <h2 className="font-semibold mb-2">✏️ 직접 입력</h2>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="예: 김진균 후보 교육 혁신 공약 정리"
            className="w-full px-4 py-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:border-blue-500 outline-none"
          />
          <button onClick={() => topic.trim() && setStep(3)}
            disabled={!topic.trim()}
            className="mt-3 w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40">
            다음 →
          </button>
        </div>
      </div>
    );
  }

  // ───────── Step 3: 옵션 + 생성 ─────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setStep(2)}
          className="text-sm text-[var(--muted)] hover:text-blue-500">← 이전</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">옵션 설정 후 생성</h1>
          <p className="text-xs text-[var(--muted)] mt-1">3/3 단계</p>
        </div>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-3">
        <div>
          <div className="text-xs text-[var(--muted)]">유형</div>
          <div className="font-semibold">{CONTENT_TYPES.find(c => c.value === contentType)?.label}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted)]">주제</div>
          <div className="font-semibold">{topic}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[var(--muted)] block mb-1">목적</label>
          <select value={purpose} onChange={e => setPurpose(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
            {PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--muted)] block mb-1">대상</label>
          <select value={target} onChange={e => setTarget(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
            {TARGETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--muted)] block mb-1">톤</label>
          <select value={style} onChange={e => setStyle(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
            {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {!result && (
        <button onClick={generate} disabled={generating}
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold text-lg rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-40">
          {generating ? '✨ AI 생성 중... (최대 5분)' : '✨ 콘텐츠 생성하기'}
        </button>
      )}

      {result?.error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-sm">
          ❌ {result.error}
        </div>
      )}

      {result?.content && (
        <div className="space-y-4">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">✨ 생성 완료</h2>
              <div className="flex gap-2">
                <button onClick={() => navigator.clipboard.writeText(result.content)}
                  className="text-xs px-3 py-1 bg-[var(--muted-bg)] rounded hover:bg-blue-500/10">📋 복사</button>
                <button onClick={() => { setResult(null); setStep(1); }}
                  className="text-xs px-3 py-1 bg-[var(--muted-bg)] rounded hover:bg-blue-500/10">새로 만들기</button>
              </div>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown>
            </div>
          </div>

          {/* AI + 선거법 안내 */}
          <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-sm">
            <div className="font-semibold text-amber-800 dark:text-amber-300 mb-1">[AI 활용] 참고 안내</div>
            <ul className="text-amber-700 dark:text-amber-400 space-y-1 text-xs">
              <li>• 게시 전 사실 관계 확인 필수 (허위사실 공표 금지 - 제250조)</li>
              <li>• 경쟁 후보 인신공격·비방 금지 (제110조)</li>
              <li>• 금품 제공 약속 금지 (제112조)</li>
              <li>• 본문 첫줄에 "[AI 활용]" 표기 필수 (제82조의8, 과태료 300만원)</li>
              <li>• 선거일 90일 전부터 AI 딥페이크 영상/이미지 금지</li>
            </ul>
          </div>

          {/* 출처 */}
          {result.citations && result.citations.length > 0 && (
            <div className="p-3 rounded-xl border border-[var(--card-border)] bg-[var(--muted-bg)]">
              <p className="text-xs font-semibold mb-2">📎 참고 자료 ({result.citations.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {result.citations.map((c: any, i: number) => (
                  <a key={c.id} href={c.url || '#'} target={c.url ? '_blank' : undefined}
                    className="text-[10px] px-2 py-0.5 rounded border bg-[var(--card-bg)] hover:border-blue-400"
                    title={c.title}>
                    {c.type === 'nec' ? '🏛️' : c.type === 'news' ? '📰' : c.type === 'community' ? '💬' : c.type === 'youtube' ? '📺' : '📋'} {i + 1}. {(c.title || '').slice(0, 30)}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 선거법 검증 결과 */}
          {result.compliance && (
            <div className={`p-3 rounded-xl border text-sm ${
              result.compliance.compliant
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className={`font-bold ${result.compliance.compliant ? 'text-green-500' : 'text-red-500'}`}>
                ⚖️ {result.compliance.compliant ? '선거법 적합' : '선거법 위반 소지 있음'} (점수 {result.compliance.score}/100)
              </div>
              {result.compliance.violations?.map((v: any, i: number) => (
                <div key={i} className="text-xs text-red-500 mt-1">
                  • {v.rule}: {v.detail}
                </div>
              ))}
              {result.compliance.warnings?.map((w: any, i: number) => (
                <div key={i} className="text-xs text-amber-500 mt-1">
                  • {w.rule}: {w.detail}
                </div>
              ))}
            </div>
          )}

          {/* 다음 액션 */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => router.push('/easy/assistant')}
              className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-sm hover:border-blue-500">
              💬 AI에게 더 물어보기
            </button>
            <button onClick={() => router.push('/easy/content?type=sns&topic=' + encodeURIComponent(topic))}
              className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-sm hover:border-blue-500">
              📱 SNS 버전도 만들기
            </button>
            <button onClick={() => router.push('/easy/reports')}
              className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-sm hover:border-blue-500">
              📊 보고서 보기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContentWizard() {
  return (
    <Suspense fallback={<div className="animate-pulse">로딩 중...</div>}>
      <ContentWizardInner />
    </Suspense>
  );
}
