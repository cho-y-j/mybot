'use client';
import { useState } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

export default function DebatePage() {
  const { election, loading: elLoading } = useElection();
  const [topics, setTopics] = useState('');
  const [opponent, setOpponent] = useState('');
  const [style, setStyle] = useState('balanced');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    opening: true, key_points: true, rebuttals: true, closing: true,
  });

  const generate = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const topicList = topics ? topics.split(',').map(t => t.trim()).filter(Boolean) : [];
      const data = await api.generateDebateScript(
        election.id, topicList, opponent || undefined, style
      );
      setResult(data);
    } catch (e: any) {
      alert(e.message || '생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const copyAll = () => {
    if (!result) return;
    const text = [
      `[오프닝]\n${result.opening}`,
      `\n[핵심 공략 포인트]`,
      ...(result.key_points || []).map((kp: any, i: number) =>
        `${i + 1}. ${kp.topic}\n   우리 입장: ${kp.our_position}\n   근거: ${kp.data_point}\n   질문: ${kp.attack_question}`
      ),
      `\n[예상 반박 대비]`,
      ...(result.rebuttals || []).map((r: any, i: number) =>
        `${i + 1}. 상대 주장: ${r.opponent_claim}\n   반박: ${r.our_response}`
      ),
      `\n[마무리]\n${result.closing}`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    alert('클립보드에 복사됨');
  };

  if (elLoading) return <div className="p-6 text-gray-500">로딩 중...</div>;
  if (!election) return <div className="p-6 text-red-500">선거를 선택하세요</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">토론 대본 생성기</h1>
      <p className="text-gray-500 dark:text-gray-400">
        AI가 상대 후보 약점 데이터를 분석하여 토론/면접용 스크립트를 생성합니다.
      </p>

      {/* 입력 폼 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">상대 후보 (빈칸 시 자동 선택)</label>
          <input
            value={opponent} onChange={e => setOpponent(e.target.value)}
            placeholder="예: 홍길동"
            className="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">토론 주제 (쉼표 구분, 빈칸 시 자동)</label>
          <input
            value={topics} onChange={e => setTopics(e.target.value)}
            placeholder="예: 교육 정책, 급식, 돌봄"
            className="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">스타일</label>
          <div className="flex gap-2">
            {[
              { value: 'aggressive', label: '공격적', desc: '상대 약점 강하게 지적' },
              { value: 'balanced', label: '균형', desc: '공격+방어 적절 배합' },
              { value: 'defensive', label: '방어적', desc: '우리 강점 중심' },
            ].map(s => (
              <button
                key={s.value}
                onClick={() => setStyle(s.value)}
                className={`flex-1 p-3 rounded border text-sm ${
                  style === s.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-gray-500 mt-1">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={generate} disabled={loading}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'AI 분석 중...' : '토론 대본 생성'}
        </button>
      </div>

      {/* 결과 */}
      {result && !result.error && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">
                {result.our_candidate} vs {result.opponent}
              </h2>
              {result.ai_generated && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">AI</span>
              )}
            </div>
            <button onClick={copyAll} className="text-sm text-blue-600 hover:underline">
              전체 복사
            </button>
          </div>

          {/* 오프닝 */}
          <Section
            title="오프닝 발언" emoji="🎤"
            open={openSections.opening} toggle={() => toggleSection('opening')}
          >
            <p className="whitespace-pre-wrap">{result.opening}</p>
          </Section>

          {/* 핵심 공략 */}
          <Section
            title={`핵심 공략 포인트 (${result.key_points?.length || 0}개)`} emoji="⚔️"
            open={openSections.key_points} toggle={() => toggleSection('key_points')}
          >
            <div className="space-y-4">
              {(result.key_points || []).map((kp: any, i: number) => (
                <div key={i} className="border-l-4 border-blue-400 pl-4 space-y-1">
                  <div className="font-medium text-blue-700 dark:text-blue-300">{i + 1}. {kp.topic}</div>
                  <div><span className="text-xs text-gray-500">우리 입장:</span> {kp.our_position}</div>
                  <div><span className="text-xs text-gray-500">근거:</span> {kp.data_point}</div>
                  <div className="bg-red-50 dark:bg-red-900/20 p-2 rounded text-sm">
                    <span className="text-red-600 font-medium">질문:</span> {kp.attack_question}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 반박 대비 */}
          <Section
            title={`예상 반박 대비 (${result.rebuttals?.length || 0}개)`} emoji="🛡️"
            open={openSections.rebuttals} toggle={() => toggleSection('rebuttals')}
          >
            <div className="space-y-3">
              {(result.rebuttals || []).map((r: any, i: number) => (
                <div key={i} className="space-y-1">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    상대: &quot;{r.opponent_claim}&quot;
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded text-sm">
                    반박: {r.our_response}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 마무리 */}
          <Section
            title="마무리 발언" emoji="🏁"
            open={openSections.closing} toggle={() => toggleSection('closing')}
          >
            <p className="whitespace-pre-wrap">{result.closing}</p>
          </Section>

          {/* 선거법 검증 */}
          {result.compliance && (
            <div className={`p-4 rounded-lg border ${
              result.compliance.compliant
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center gap-2 font-medium">
                {result.compliance.compliant ? '✅' : '⚠️'}
                선거법 검증: {result.compliance.compliant ? '통과' : '주의 필요'}
                {result.compliance.score != null && (
                  <span className="text-sm text-gray-500">({result.compliance.score}점)</span>
                )}
              </div>
              {result.compliance.warnings?.length > 0 && (
                <ul className="mt-2 text-sm space-y-1">
                  {result.compliance.warnings.map((w: string, i: number) => (
                    <li key={i} className="text-yellow-700 dark:text-yellow-300">• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          {result.error}
        </div>
      )}
    </div>
  );
}

function Section({ title, emoji, open, toggle, children }: {
  title: string; emoji: string; open: boolean; toggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <span className="font-medium">{emoji} {title}</span>
        <span className="text-gray-400">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}
