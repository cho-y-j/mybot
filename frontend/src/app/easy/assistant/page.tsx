'use client';
import { useState, useRef, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CitationBadge } from '@/components/chat/CitationBadge';

interface Msg {
  id: string;
  role: 'user' | 'ai';
  content: string;
  citations?: any[];
  time: string;
}

interface Session {
  id: string;
  title: string;
  updated_at: string;
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false); // 모바일 토글
  const scrollRef = useRef<HTMLDivElement>(null);

  // 세션 목록 로드
  useEffect(() => {
    if (!election?.id) return;
    api.getChatSessions(election.id).then(setSessions).catch(() => {});
  }, [election?.id]);

  // 메시지 자동 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setShowSessions(false);
    try {
      const msgs = await api.getChatSessionMessages(sessionId);
      setMessages(msgs.map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'ai',
        content: m.content,
        citations: m.citations || [],
        time: new Date(m.created_at).toLocaleTimeString('ko'),
      })));
    } catch {}
  };

  const newSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setShowSessions(false);
  };

  const deleteSession = async (sessionId: string, title: string) => {
    if (!confirm(`"${title}" 대화를 삭제하시겠습니까?`)) return;
    try {
      await api.deleteChatSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {}
  };

  const deleteMessage = async (messageId: string) => {
    if (!messageId.startsWith('u-') && !messageId.startsWith('a-') && !messageId.startsWith('e-')) {
      try {
        await api.deleteChatMessage(messageId);
      } catch {}
    }
    setMessages(prev => prev.filter(m => m.id !== messageId));
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    const tempId = `u-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: msg, time: new Date().toLocaleTimeString('ko') }]);
    setInput('');
    setSending(true);
    try {
      const resp = await api.sendChat(msg, election?.id, 'standard', activeSessionId || undefined);
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'ai',
        content: resp.reply,
        citations: resp.citations || [],
        time: new Date().toLocaleTimeString('ko'),
      }]);
      // 새 세션이면 ID 저장 + 목록 새로고침
      if (!activeSessionId && resp.session_id) {
        setActiveSessionId(resp.session_id);
      }
      api.getChatSessions(election?.id).then(setSessions).catch(() => {});
    } catch (e: any) {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'ai', content: `오류: ${e.message}`, time: new Date().toLocaleTimeString('ko') }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-9rem)]">
      {/* 세션 사이드바 — 기본 접힘, 토글로 열고 닫기 */}
      {showSessions && (
      <aside className={`fixed inset-0 z-30 bg-black/40 lg:static lg:bg-transparent lg:w-64 lg:flex-shrink-0`}
        onClick={(e) => e.target === e.currentTarget && setShowSessions(false)}>
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl flex flex-col h-full max-h-full lg:max-h-[calc(100vh-9rem)] overflow-hidden
          fixed lg:relative top-0 right-0 bottom-0 w-72 lg:w-full">
          <div className="p-3 border-b border-[var(--card-border)] flex items-center justify-between">
            <h3 className="font-semibold text-sm">대화 목록</h3>
            <div className="flex gap-1">
              <button onClick={newSession} title="새 대화"
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">+ 새 대화</button>
              <button onClick={() => setShowSessions(false)} className="text-[var(--muted)] hover:text-white px-2">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="p-4 text-xs text-[var(--muted)] text-center">대화 기록 없음</p>
            ) : sessions.map(s => (
              <div key={s.id}
                className={`group flex items-start gap-2 p-3 border-b border-[var(--card-border)]/50 cursor-pointer hover:bg-[var(--muted-bg)] ${
                  activeSessionId === s.id ? 'bg-blue-500/10' : ''
                }`}
                onClick={() => loadSession(s.id)}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{s.title}</p>
                  <p className="text-[10px] text-[var(--muted)]">
                    {new Date(s.updated_at).toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id, s.title); }}
                  className="opacity-0 group-hover:opacity-100 lg:opacity-100 text-red-400 hover:text-red-300 text-xs px-1">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>
      )}

      {/* 메인 챗 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-3 flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">💬 AI 비서</h1>
            <p className="text-xs lg:text-sm text-[var(--muted)] mt-1">선거 데이터 + 실시간 웹 검색</p>
          </div>
          <div className="flex gap-2">
            <button onClick={newSession}
              className="text-xs px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:border-blue-500">
              + 새 대화
            </button>
            <button onClick={() => setShowSessions(!showSessions)}
              className="text-xs px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:border-blue-500">
              {showSessions ? '◀ 접기' : `📋 대화 목록 (${sessions.length})`}
            </button>
          </div>
        </div>

        {messages.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 lg:gap-3 mb-4">
            {QUICK_QUESTIONS.map((q, i) => (
              <button key={i} onClick={() => send(q.q)}
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-2 lg:p-3 text-left hover:border-blue-500 transition">
                <div className="text-xl lg:text-2xl mb-0.5 lg:mb-1">{q.icon}</div>
                <div className="text-[11px] lg:text-sm leading-tight">{q.q}</div>
              </button>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 py-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex group ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] lg:max-w-[85%] rounded-2xl px-3 lg:px-4 py-2 lg:py-3 text-sm relative ${
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
                <button onClick={() => deleteMessage(m.id)}
                  className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center transition">
                  ✕
                </button>
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
              className="flex-1 px-3 lg:px-4 py-2 lg:py-3 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl focus:border-blue-500 outline-none"
            />
            <button onClick={() => send()} disabled={sending || !input.trim()}
              className="px-4 lg:px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 font-semibold text-sm">
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
