'use client';
import { useState } from 'react';
import { api } from '@/services/api';

interface Action {
  priority: 'high' | 'medium' | 'low';
  action: string;
  why: string;
}

interface Structured {
  key_findings: string[];
  strength_strategy: string;
  weakness_strategy: string;
  top_actions: Action[];
}

interface AIStrategy {
  text: string;
  structured: Structured | null;
  ai_generated: boolean;
}

export default function StructuredAIStrategy({
  electionId,
  initial,
  onRefresh,
}: {
  electionId: string;
  initial: AIStrategy;
  onRefresh?: () => void;
}) {
  const [data, setData] = useState<AIStrategy>(initial);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const result = await api.generateHistoryAIStrategy(electionId);
      setData(result);
      onRefresh?.();
    } catch (e: any) {
      setError(e?.message || 'AI 전략 생성 실패');
    } finally {
      setGenerating(false);
    }
  }

  const structured = data?.structured;
  const hasStructured = structured && (structured.key_findings?.length || structured.top_actions?.length);

  function priorityBadge(p: string) {
    if (p === 'high') return 'bg-red-500 text-white';
    if (p === 'medium') return 'bg-orange-500 text-white';
    return 'bg-gray-400 text-white';
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold">AI 전략 분석 (Claude)</h3>
          <p className="text-xs text-gray-500 mt-1">
            {hasStructured
              ? '4섹션 구조화 분석 완료'
              : '아직 생성되지 않음. 데이터 기반 전략을 자동 생성합니다.'}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
        >
          {generating ? '생성 중... (1~3분)' : hasStructured ? '재분석' : 'AI 전략 생성'}
        </button>
      </div>

      {error && <div className="card text-sm text-red-600">{error}</div>}

      {hasStructured ? (
        <>
          {/* Key Findings */}
          <div className="card">
            <h4 className="text-sm font-bold text-violet-600 dark:text-violet-400 mb-3">🔍 핵심 발견 사항</h4>
            <ul className="space-y-2">
              {structured!.key_findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-violet-500 font-bold">{i + 1}.</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Strength / Weakness */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card border-l-4 border-blue-500">
              <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-2">✨ 강세 지역 활용 전략</h4>
              <p className="text-sm leading-relaxed whitespace-pre-line">{structured!.strength_strategy}</p>
            </div>
            <div className="card border-l-4 border-red-500">
              <h4 className="text-sm font-bold text-red-600 dark:text-red-400 mb-2">⚠️ 약세 지역 공략 전략</h4>
              <p className="text-sm leading-relaxed whitespace-pre-line">{structured!.weakness_strategy}</p>
            </div>
          </div>

          {/* Top Actions */}
          <div className="card">
            <h4 className="text-sm font-bold text-orange-600 dark:text-orange-400 mb-3">🎯 다음 단계 액션</h4>
            <div className="space-y-3">
              {structured!.top_actions.map((a, i) => (
                <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${priorityBadge(a.priority)}`}>
                      {a.priority.toUpperCase()}
                    </span>
                    <div className="font-semibold text-sm flex-1">{a.action}</div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">근거: {a.why}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : data?.text ? (
        <div className="card">
          <p className="text-sm whitespace-pre-line">{data.text}</p>
          <p className="text-xs text-gray-400 mt-2">⚠️ JSON 파싱 실패 — 원본 텍스트를 표시합니다.</p>
        </div>
      ) : (
        <div className="card text-center text-gray-500 py-12 text-sm">
          위 "AI 전략 생성" 버튼을 눌러주세요.
        </div>
      )}
    </div>
  );
}
