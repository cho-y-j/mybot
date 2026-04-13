'use client';
import { useState, useRef, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  context?: string[];
  time: string;
}

interface Session {
  id: string;
  title: string;
  updated_at: string;
}

const SUGGESTIONS = [
  "오늘 뉴스 현황을 분석해줘",
  "우리 후보의 강점과 약점은?",
  "경쟁자 대비 우리 전략은?",
  "감성 분석 결과를 알려줘",
  "현재 가장 큰 위기 요인은?",
  "유튜브 현황 분석해줘",
  "이번 주 핵심 이슈 정리해줘",
];

export default function ChatPage() {
  const { election, ourCandidate, loading: elLoading } = useElection();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [modelTier, setModelTier] = useState<'fast' | 'standard' | 'premium'>('standard');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 세션 목록 로드
  useEffect(() => {
    if (!election) return;
    api.getChatSessions(election.id).then(setSessions).catch(() => {});
  }, [election?.id]);

  // 세션 선택 시 메시지 로드
  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    try {
      const msgs = await api.getChatSessionMessages(sessionId);
      setMessages(msgs.map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'ai',
        content: m.content,
        time: new Date(m.created_at).toLocaleTimeString('ko'),
      })));
    } catch {
      setMessages([]);
    }
  };

  // 새 대화 시작
  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || sending) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: msg,
      time: new Date().toLocaleTimeString('ko'),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await api.sendChat(msg, election?.id, modelTier, activeSessionId || undefined);
      const aiMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'ai',
        content: resp.reply,
        context: resp.context_used,
        time: new Date().toLocaleTimeString('ko'),
      };
      setMessages(prev => [...prev, aiMsg]);

      // 새 세션이면 session_id 업데이트 + 목록 새로고침
      if (!activeSessionId && resp.session_id) {
        setActiveSessionId(resp.session_id);
      }
      api.getChatSessions(election?.id).then(setSessions).catch(() => {});
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'ai',
        content: `오류가 발생했습니다: ${err.message}`,
        time: new Date().toLocaleTimeString('ko'),
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;
    try {
      await api.deleteChatSession(sid);
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (activeSessionId === sid) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {}
  };

  if (elLoading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-3">
      {/* 세션 목록 사이드패널 */}
      <div className="w-64 flex-shrink-0 flex flex-col bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)]">
        <div className="p-3 border-b border-[var(--card-border)]">
          <button onClick={startNewChat}
            className="w-full py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition">
            + 새 대화
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="text-xs text-[var(--muted)] text-center py-8">대화 이력이 없습니다</p>
          ) : (
            sessions.map(s => (
              <div key={s.id}
                onClick={() => loadSession(s.id)}
                className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)] transition ${
                  activeSessionId === s.id ? 'bg-primary-500/10 border-l-2 border-l-primary-500' : ''
                }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.title}</p>
                  <p className="text-[10px] text-[var(--muted)]">
                    {new Date(s.updated_at).toLocaleDateString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button onClick={(e) => handleDeleteSession(s.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 text-xs px-1 transition">
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 대화 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <span>🤖</span> AI 분석 어시스턴트
            </h1>
            <p className="text-xs text-[var(--muted)]">
              {election?.name || '선거'} 데이터 기반 맞춤형 대화
            </p>
          </div>
          <div className="flex bg-[var(--muted-bg)] rounded-lg p-0.5 gap-0.5">
            {([
              { key: 'fast', icon: '⚡', label: '빠른' },
              { key: 'standard', icon: '✦', label: '고품질' },
              { key: 'premium', icon: '◆', label: '최고' },
            ] as const).map(m => (
              <button key={m.key} onClick={() => setModelTier(m.key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                  modelTier === m.key
                    ? m.key === 'fast' ? 'bg-green-500 text-white'
                      : m.key === 'standard' ? 'bg-blue-500 text-white'
                      : 'bg-violet-600 text-white'
                    : 'text-[var(--muted)]'
                }`}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] p-4 space-y-4">
          {messages.length === 0 && !activeSessionId && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="text-4xl mb-3">🤖</span>
              <p className="font-bold text-lg mb-1">
                {ourCandidate ? `${ourCandidate.name} 후보 분석 AI` : 'AI 분석 어시스턴트'}
              </p>
              <p className="text-sm text-[var(--muted)] mb-6">무엇이 궁금하신가요?</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => handleSend(s)}
                    className="text-xs bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-full px-3 py-1.5 text-[var(--muted)] hover:bg-primary-500/10 hover:text-primary-500 hover:border-primary-500/30 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${
                msg.role === 'user'
                  ? 'bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-3'
                  : 'bg-[var(--muted-bg)] rounded-2xl rounded-bl-md px-4 py-3 border border-[var(--card-border)]'
              }`}>
                {msg.role === 'ai' && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">🤖</span>
                    <span className="text-xs font-medium text-[var(--muted)]">AI 어시스턴트</span>
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: msg.content
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br/>')
                  }} />
                {msg.context && msg.context.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[var(--card-border)]">
                    <p className="text-[10px] text-[var(--muted)] mb-1">참고 데이터:</p>
                    <div className="flex flex-wrap gap-1">
                      {msg.context.map((c, i) => (
                        <span key={i} className="text-[10px] bg-[var(--card-bg)] text-[var(--muted)] rounded px-1.5 py-0.5">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className={`flex items-center gap-2 mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-[var(--muted)]'}`}>
                  <p className="text-[10px]">{msg.time}</p>
                  {msg.id !== 'welcome' && !msg.id.startsWith('u-') && !msg.id.startsWith('a-') && !msg.id.startsWith('e-') && (
                    <button onClick={async () => {
                      try {
                        await api.deleteChatMessage(msg.id);
                        setMessages(prev => prev.filter(m => m.id !== msg.id));
                      } catch {}
                    }} className="text-[10px] opacity-0 hover:opacity-100 hover:text-red-400 transition">삭제</button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-[var(--muted-bg)] rounded-2xl rounded-bl-md px-4 py-3 border border-[var(--card-border)]">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-[var(--muted)]">데이터 분석 중...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            className="input-field flex-1"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="질문을 입력하세요..."
            disabled={sending}
          />
          <button onClick={() => handleSend()} disabled={!input.trim() || sending}
            className="btn-primary px-6">
            {sending ? '...' : '전송'}
          </button>
        </div>
      </div>
    </div>
  );
}
