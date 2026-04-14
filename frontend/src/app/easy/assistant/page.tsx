'use client';
import { useState, useRef, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CitationBadge } from '@/components/chat/CitationBadge';

interface Msg {
  role: 'user' | 'ai';
  content: string;
  citations?: any[];
  time: string;
}

const QUICK_QUESTIONS = [
  { icon: '🔥', q: '오늘 뭐 해야 돼?' },
  { icon: '⚠️', q: '현재 가장 큰 위기 요인은?' },
  { icon: '💡', q: '경쟁 후보 공세 있어?' },
  { icon: '📰', q: '오늘 뉴스 핵심만 정리해줘' },
  { icon: '📊', q: '우리 후보 강점/약점 분석해줘' },
  { icon: '🎤', q: '토론에서 공격 포인트는?' },
  { icon: '📝', q: '블로그 주제 추천해줘' },
  { icon: '🏛️', q: '역대 이 지역 선거 결과는?' },
  { icon: '⚖️', q: '이 콘텐츠 선거법 위반인지 봐줘' },
];

export default function AssistantPage() {
  const { election } = useElection();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setMessages(prev => [...prev, { role: 'user', content: msg, time: new Date().toLocaleTimeString('ko') }]);
    setInput('');
    setSending(true);
    try {
      const resp = await api.sendChat(msg, election?.id, 'standard');
      setMessages(prev => [...prev, {
        role: 'ai',
        content: resp.reply,
        citations: resp.citations || [],
        time: new Date().toLocaleTimeString('ko'),
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'ai', content: `오류: ${e.message}`, time: new Date().toLocaleTimeString('ko') }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">💬 AI 비서</h1>
        <p className="text-sm text-[var(--muted)] mt-1">선거 데이터 + 실시간 웹 검색 기반 답변</p>
      </div>

      {messages.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          {QUICK_QUESTIONS.map((q, i) => (
            <button key={i} onClick={() => send(q.q)}
              className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 text-left hover:border-blue-500 transition">
              <div className="text-2xl mb-1">{q.icon}</div>
              <div className="text-sm">{q.q}</div>
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 py-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-bl-md prose prose-sm dark:prose-invert max-w-none prose-table:my-3 prose-table:border prose-table:border-collapse prose-th:bg-[var(--card-bg)] prose-th:border prose-th:border-[var(--card-border)] prose-th:p-2 prose-td:border prose-td:border-[var(--card-border)] prose-td:p-2 prose-strong:text-current'
            }`}>
              {m.role === 'user' ? (
                <span className="whitespace-pre-wrap">{m.content}</span>
              ) : (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--card-border)] not-prose">
                      <p className="text-[10px] text-[var(--muted)] mb-2 font-semibold">📎 출처 ({m.citations.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.citations.map((c, j) => (
                          <CitationBadge key={c.id} citation={c} num={j + 1} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-[var(--muted-bg)] rounded-2xl px-4 py-3 text-sm">
              <span className="inline-block animate-pulse">AI가 데이터 분석 중...</span>
            </div>
          </div>
        )}
      </div>

      <div className="pt-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={sending}
            placeholder="무엇이든 물어보세요..."
            className="flex-1 px-4 py-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl focus:border-blue-500 outline-none"
          />
          <button onClick={() => send()} disabled={sending || !input.trim()}
            className="px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 font-semibold">
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
