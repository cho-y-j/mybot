'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { useElection } from '@/hooks/useElection';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Msg {
  role: 'user' | 'ai';
  content: string;
  time: string;
}

const BTN_SIZE = 48;          // px — 동그란 버튼 크기
const SAFE_MARGIN = 8;        // 화면 가장자리 여백
const DRAG_THRESHOLD = 5;     // 이 거리 미만 이동은 클릭으로 처리
const POS_STORAGE_KEY = 'fa_btn_pos_v1';

interface Pos { x: number; y: number; }

function clampToViewport(p: Pos): Pos {
  if (typeof window === 'undefined') return p;
  const maxX = window.innerWidth - BTN_SIZE - SAFE_MARGIN;
  const maxY = window.innerHeight - BTN_SIZE - SAFE_MARGIN;
  return { x: Math.max(SAFE_MARGIN, Math.min(p.x, maxX)), y: Math.max(SAFE_MARGIN, Math.min(p.y, maxY)) };
}

function defaultPos(): Pos {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  return { x: window.innerWidth - BTN_SIZE - 24, y: window.innerHeight - BTN_SIZE - 24 };
}

export default function FloatingAssistant() {
  const { election } = useElection();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 드래그 가능한 버튼 위치 (localStorage 저장)
  const [btnPos, setBtnPos] = useState<Pos>(defaultPos);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  // 첫 마운트 — 저장된 위치 복원 + viewport 안에 클램프
  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          setBtnPos(clampToViewport(p));
          return;
        }
      }
    } catch {}
    setBtnPos(defaultPos());
  }, []);

  // 창 크기 변경 시 viewport 안으로 재클램프
  useEffect(() => {
    const onResize = () => setBtnPos(p => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: btnPos.x, origY: btnPos.y, moved: false };
  }, [btnPos.x, btnPos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragState.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.moved = true;
    setBtnPos(clampToViewport({ x: s.origX + dx, y: s.origY + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    const s = dragState.current;
    if (!s) return;
    if (s.moved) {
      try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(btnPos)); } catch {}
    } else {
      setOpen(true);   // 클릭으로 처리
    }
    dragState.current = null;
  }, [btnPos]);

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
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragState.current = null; }}
        style={{ left: btnPos.x, top: btnPos.y, width: BTN_SIZE, height: BTN_SIZE, touchAction: 'none' }}
        className="fixed flex items-center justify-center bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full shadow-lg hover:shadow-xl transition-colors z-40 cursor-grab active:cursor-grabbing select-none"
        title="AI 비서 — 길게 눌러서 드래그">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-2 right-2 lg:bottom-6 lg:right-6 w-[calc(100vw-1rem)] lg:w-96 max-w-[calc(100vw-1rem)] h-[80vh] lg:h-[600px] max-h-[calc(100vh-1rem)] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl flex flex-col z-40">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="font-bold text-sm">AI 비서</div>
            <div className="text-[10px] text-[var(--muted)]">무엇이든 물어보세요</div>
          </div>
        </div>
        <button onClick={() => setOpen(false)}
          aria-label="닫기"
          className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted-bg)] transition">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 메시지 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="p-3 bg-blue-500/10 rounded-lg text-sm">
              <p className="font-semibold mb-1">안녕하세요</p>
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
        <div className="flex gap-2 min-w-0">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={sending}
            placeholder="무엇이든 물어보세요..."
            className="flex-1 min-w-0 px-3 py-2 text-xs bg-[var(--muted-bg)] border border-[var(--card-border)] rounded-full focus:border-blue-500 outline-none"
          />
          <button onClick={() => send()} disabled={sending || !input.trim()}
            aria-label="전송"
            className="shrink-0 w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
