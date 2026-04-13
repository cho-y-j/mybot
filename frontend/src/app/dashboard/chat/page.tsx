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

const SUGGESTIONS = [
  "오늘 뉴스 현황을 분석해줘",
  "우리 후보의 강점과 약점은?",
  "경쟁자 대비 우리 전략은?",
  "감성 분석 결과를 알려줘",
  "현재 가장 큰 위기 요인은?",
  "유튜브 현황 분석해줘",
  "검색 트렌드 어떤 상황이야?",
  "이번 주 핵심 이슈 정리해줘",
];

export default function ChatPage() {
  const { election, ourCandidate, loading: elLoading } = useElection();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [modelTier, setModelTier] = useState<'fast' | 'standard' | 'premium'>('standard');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 이전 대화 이력 불러오기 + 초기 인사
  useEffect(() => {
    if (!election || !ourCandidate) return;
    api.getChatHistory(election.id).then((history: any[]) => {
      if (history && history.length > 0) {
        const loaded: Message[] = history.map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'ai',
          content: m.content,
          time: new Date(m.created_at).toLocaleTimeString('ko'),
        }));
        setMessages(loaded);
      } else {
        setMessages([{
          id: 'welcome',
          role: 'ai',
          content: `안녕하세요! **${election.name}** 분석 AI입니다.\n\n` +
            `**${ourCandidate.name}** 후보 중심으로 수집된 데이터를 기반으로 답변합니다.\n` +
            `뉴스, 감성분석, 검색트렌드, 유튜브, 여론조사 등 모든 데이터를 활용합니다.\n\n` +
            `무엇이 궁금하신가요?`,
          time: new Date().toLocaleTimeString('ko'),
        }]);
      }
    }).catch(() => {
      setMessages([{
        id: 'welcome', role: 'ai',
        content: `안녕하세요! **${election.name}** 분석 AI입니다.\n무엇이 궁금하신가요?`,
        time: new Date().toLocaleTimeString('ko'),
      }]);
    });
  }, [election, ourCandidate]);

  const handleClearHistory = async () => {
    if (!confirm('대화 이력을 모두 삭제하시겠습니까?')) return;
    try {
      await api.clearChatHistory(election?.id);
      setMessages([{
        id: 'welcome', role: 'ai',
        content: '대화 이력이 삭제되었습니다. 새로운 대화를 시작하세요.',
        time: new Date().toLocaleTimeString('ko'),
      }]);
    } catch {}
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
      const resp = await api.sendChat(msg, election?.id, modelTier);
      const aiMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'ai',
        content: resp.reply,
        context: resp.context_used,
        time: new Date().toLocaleTimeString('ko'),
      };
      setMessages(prev => [...prev, aiMsg]);
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

  if (elLoading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="text-2xl">🤖</span> AI 분석 어시스턴트
          </h1>
          <p className="text-sm text-gray-500">
            수집된 {election?.name || '선거'} 데이터 기반 맞춤형 대화
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleClearHistory}
            className="px-3 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20"
            title="대화 이력 삭제">
            대화 초기화
          </button>
          {/* 모델 선택 토글 */}
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 gap-0.5">
            {([
              { key: 'fast', icon: '⚡', label: '빠른답변', desc: '~3초' },
              { key: 'standard', icon: '✦', label: '고품질', desc: '~8초' },
              { key: 'premium', icon: '◆', label: '최고품질', desc: '~20초' },
            ] as const).map(m => (
              <button key={m.key} onClick={() => setModelTier(m.key)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  modelTier === m.key
                    ? m.key === 'fast' ? 'bg-green-500 text-white shadow-sm'
                      : m.key === 'standard' ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                title={`${m.label} (${m.desc})`}>
                <span className="mr-1">{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
          {messages.length > 1 && (
            <button onClick={() => setMessages(messages.slice(0, 1))}
              className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${
              msg.role === 'user'
                ? 'bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-3'
                : 'bg-gray-50 text-gray-800 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-100'
            }`}>
              {msg.role === 'ai' && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">🤖</span>
                  <span className="text-xs font-medium text-gray-400">AI 어시스턴트</span>
                </div>
              )}
              <div className="text-sm whitespace-pre-wrap leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br/>')
                }} />
              {msg.context && msg.context.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-[10px] text-gray-400 mb-1">참고 데이터:</p>
                  <div className="flex flex-wrap gap-1">
                    {msg.context.map((c, i) => (
                      <span key={i} className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className={`flex items-center gap-2 mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-300'}`}>
                <p className="text-[10px]">{msg.time}</p>
                {msg.id !== 'welcome' && (
                  <button onClick={async () => {
                    if (msg.id.startsWith('u-') || msg.id.startsWith('a-') || msg.id.startsWith('e-')) {
                      setMessages(prev => prev.filter(m => m.id !== msg.id));
                    } else {
                      try {
                        await api.deleteChatMessage(msg.id);
                        setMessages(prev => prev.filter(m => m.id !== msg.id));
                      } catch {}
                    }
                  }} className="text-[10px] opacity-40 hover:opacity-100 hover:text-red-400">삭제</button>
                )}
              </div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-50 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-100">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-gray-400">데이터 분석 중...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => handleSend(s)}
              className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          className="input-field flex-1"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="질문을 입력하세요... (예: 오늘 뉴스 분석해줘)"
          disabled={sending}
        />
        <button onClick={() => handleSend()} disabled={!input.trim() || sending}
          className="btn-primary px-6">
          {sending ? '...' : '전송'}
        </button>
      </div>
    </div>
  );
}
