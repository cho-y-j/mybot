'use client';
import { useState, useRef, useEffect } from 'react';
import { api } from '@/services/api';
import { useElection } from '@/hooks/useElection';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Msg {
  role: 'user' | 'ai';
  content: string;
  time: string;
}

export default function FloatingAssistant() {
  const { election } = useElection();
  const [open, setOpen] = useState(false);
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
      setMessages(prev => [...prev, { role: 'ai', content: resp.reply, time: new Date().toLocaleTimeString('ko') }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'ai', content: `오류: ${e.message}`, time: new Date().toLocaleTimeString('ko') }]);
    } finally {
      setSending(false);
    }
  };

  const QUICK = [
    '오늘 뭐 해야 돼?',
    '경쟁자 공세 있어?',
    '이번주 핵심 이슈는?',
  ];

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center text-2xl transition z-40"
        title="AI 비서에게 물어보기">
        💬
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl flex flex-col z-40">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
        <div>
          <div className="font-bold text-sm">🤖 AI 비서</div>
          <div className="text-[10px] text-[var(--muted)]">무엇이든 물어보세요</div>
        </div>
        <button onClick={() => setOpen(false)} className="text-[var(--muted)] hover:text-white text-xl">
          ✕
        </button>
      </div>

      {/* 메시지 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="p-3 bg-blue-500/10 rounded-lg text-sm">
              <p className="font-semibold mb-1">안녕하세요! 👋</p>
              <p className="text-xs text-[var(--muted)]">
                선거 관련 어떤 질문이든 도와드립니다. 아래 예시를 눌러보세요.
              </p>
            </div>
            <div className="space-y-1">
              {QUICK.map(q => (
                <button key={q} onClick={() => send(q)}
                  className="w-full text-left text-xs px-3 py-2 bg-[var(--muted-bg)] hover:bg-blue-500/10 rounded transition">
                  → {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-bl-md prose prose-xs dark:prose-invert max-w-none prose-table:text-[10px] prose-th:bg-[var(--card-bg)] prose-th:border prose-th:border-[var(--card-border)] prose-th:p-1 prose-td:border prose-td:border-[var(--card-border)] prose-td:p-1'
            }`}>
              {m.role === 'user' ? (
                <span className="whitespace-pre-wrap">{m.content}</span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-[var(--muted-bg)] rounded-2xl px-3 py-2 text-xs">
              <span className="inline-block animate-pulse">생각 중...</span>
            </div>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="p-3 border-t border-[var(--card-border)]">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={sending}
            placeholder="무엇이든 물어보세요..."
            className="flex-1 px-3 py-2 text-xs bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-full focus:border-blue-500 outline-none"
          />
          <button onClick={() => send()} disabled={sending || !input.trim()}
            className="px-4 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 disabled:opacity-40">
            →
          </button>
        </div>
      </div>
    </div>
  );
}
