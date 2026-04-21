'use client';
/**
 * 일정 추가 패널 — 한 줄 / 여러 줄 / 수동 3가지 모드
 * 인라인 expand 방식 (모달 아님)
 */
import { useState } from 'react';
import { api } from '@/services/api';
import {
  CATEGORY_LABELS, CATEGORY_COLORS, ScheduleCategory,
} from '@/lib/schedules';

type Mode = 'single' | 'multi' | 'manual' | 'photo';

interface Props {
  electionId: string;
  candidates: Array<{ id: string; name: string; is_our_candidate?: boolean }>;
  defaultCandidateId?: string;
  onSaved: () => void;
  onClose?: () => void;
}

export default function ScheduleAddPanel({
  electionId, candidates, defaultCandidateId, onSaved, onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>('single');
  const [candidateId, setCandidateId] = useState(defaultCandidateId || candidates[0]?.id || '');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 수동 입력 필드
  const [mTitle, setMTitle] = useState('');
  const [mDate, setMDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mStartTime, setMStartTime] = useState('09:00');
  const [mEndTime, setMEndTime] = useState('11:00');
  const [mLocation, setMLocation] = useState('');
  const [mCategory, setMCategory] = useState<ScheduleCategory>('rally');
  const [mIsPublic, setMIsPublic] = useState(false);

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await api.parseCandidateScheduleText(electionId, text, candidateId);
      if (!res.parsed || res.parsed.length === 0) {
        setError('AI가 일정을 이해하지 못했어요. 시간/장소를 더 구체적으로 써보세요.');
        setParsed([]);
      } else {
        // editable state 추가
        setParsed(res.parsed.map((p: any) => ({ ...p, _public: false })));
      }
    } catch (e: any) {
      setError(e?.message || '파싱 실패');
    } finally {
      setParsing(false);
    }
  };

  const handleSaveBulk = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = parsed.map((p) => ({
        candidate_id: candidateId,
        title: p.title,
        description: p.description || null,
        location: p.location || null,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        all_day: !!p.all_day,
        category: p.category,
        recurrence_rule: p.recurrence_rule || null,
        visibility: p._public ? 'public' : undefined,
      }));
      if (payload.length === 1) {
        await api.createCandidateSchedule(electionId, payload[0]);
      } else {
        await api.createCandidateSchedulesBulk(electionId, payload);
      }
      setText('');
      setParsed([]);
      onSaved();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = async () => {
    if (!mTitle.trim()) {
      setError('제목을 입력하세요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const startIso = new Date(`${mDate}T${mStartTime}:00+09:00`).toISOString();
      const endIso = new Date(`${mDate}T${mEndTime}:00+09:00`).toISOString();
      await api.createCandidateSchedule(electionId, {
        candidate_id: candidateId,
        title: mTitle,
        location: mLocation || null,
        starts_at: startIso,
        ends_at: endIso,
        category: mCategory,
        visibility: mIsPublic ? 'public' : undefined,
      });
      setMTitle(''); setMLocation('');
      onSaved();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-blue-500/30 bg-blue-500/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 text-sm flex-wrap">
          {[
            { v: 'single' as const, label: '한 줄' },
            { v: 'multi' as const, label: '여러 줄 붙여넣기' },
            { v: 'manual' as const, label: '수동 입력' },
            { v: 'photo' as const, label: '현장 사진' },
          ].map((m) => (
            <button
              key={m.v}
              onClick={() => { setMode(m.v); setParsed([]); setError(null); }}
              className={`px-3 py-1.5 rounded-lg border ${
                mode === m.v
                  ? 'border-blue-500 bg-blue-500/10 font-semibold'
                  : 'border-[var(--card-border)] hover:border-blue-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">닫기</button>
        )}
      </div>

      {candidates.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-[var(--muted)]">후보</label>
          <select
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className="px-2 py-1 border rounded bg-[var(--card-bg)] border-[var(--card-border)]"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.is_our_candidate ? ' (우리)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === 'single' && (
        <div className="space-y-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleParse(); }}
            placeholder="예: 내일 오후 3시 청주시청 앞 유세"
            className="w-full px-3 py-2.5 border rounded-lg bg-[var(--card-bg)] border-[var(--card-border)] text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleParse}
              disabled={parsing || !text.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {parsing ? 'AI 해석 중…' : '파싱 → 확인'}
            </button>
            {typeof window !== 'undefined' && (
              (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
            ) && (
              <VoiceInputButton onResult={(t) => setText(t)} />
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)]">Enter: 파싱 / 모바일: 마이크 버튼</p>
        </div>
      )}

      {mode === 'multi' && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'카톡에서 받은 하루 일정 그대로 붙여넣기:\n09:00 시청 조회\n10:30 봉명동 거리인사\n14:00~16:00 상당구청 간담회\n18:00 후원회'}
            className="w-full px-3 py-2.5 border rounded-lg bg-[var(--card-bg)] border-[var(--card-border)] text-sm font-mono"
            rows={6}
          />
          <button
            onClick={handleParse}
            disabled={parsing || !text.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {parsing ? 'AI 해석 중… (4~15초 소요)' : 'AI로 일괄 파싱'}
          </button>
        </div>
      )}

      {mode === 'photo' && (
        <PhotoExifMode
          electionId={electionId}
          candidateId={candidateId}
          onSaved={onSaved}
        />
      )}

      {mode === 'manual' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-[var(--muted)] mb-1 block">제목</label>
            <input
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">날짜</label>
            <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)}
              className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[var(--muted)] mb-1 block">시작</label>
              <input type="time" value={mStartTime} onChange={(e) => setMStartTime(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] mb-1 block">종료</label>
              <input type="time" value={mEndTime} onChange={(e) => setMEndTime(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-[var(--muted)] mb-1 block">장소</label>
            <input value={mLocation} onChange={(e) => setMLocation(e.target.value)}
              placeholder="예: 충북 청주시 상당로 155"
              className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">카테고리</label>
            <select value={mCategory} onChange={(e) => setMCategory(e.target.value as ScheduleCategory)}
              className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input id="mpub" type="checkbox" checked={mIsPublic} onChange={(e) => setMIsPublic(e.target.checked)} />
            <label htmlFor="mpub" className="text-sm">홈페이지 공개</label>
          </div>
          <div className="md:col-span-2">
            <button onClick={handleManualSave} disabled={saving || !mTitle.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-500 bg-rose-500/10 px-3 py-2 rounded">{error}</div>
      )}

      {parsed.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-[var(--card-border)]">
          <p className="text-sm font-semibold">
            {parsed.length}건 해석됨 — 확인 후 저장
          </p>
          {parsed.map((p, idx) => (
            <ParsedItemCard
              key={idx}
              item={p}
              onChange={(patch) => {
                const next = [...parsed];
                next[idx] = { ...next[idx], ...patch };
                setParsed(next);
              }}
              onRemove={() => setParsed(parsed.filter((_, i) => i !== idx))}
            />
          ))}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSaveBulk} disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? '저장 중…' : `${parsed.length}건 저장`}
            </button>
            <button onClick={() => setParsed([])}
              className="px-4 py-2 text-sm text-[var(--muted)]">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function ParsedItemCard({
  item, onChange, onRemove,
}: {
  item: any; onChange: (patch: any) => void; onRemove: () => void;
}) {
  const s = new Date(item.starts_at);
  const e = new Date(item.ends_at);
  const fmt = (d: Date) => d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const lowConf = item.confidence < 0.7;
  return (
    <div className={`rounded-lg border ${lowConf ? 'border-amber-500/50 bg-amber-500/5' : 'border-[var(--card-border)]'} p-3`}>
      <div className="flex items-start gap-3">
        <div className={`w-1 h-10 rounded ${CATEGORY_COLORS[item.category as ScheduleCategory] || 'bg-gray-400'} shrink-0`} />
        <div className="flex-1 min-w-0">
          <input
            value={item.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="w-full font-medium bg-transparent border-b border-transparent focus:border-[var(--card-border)] focus:outline-none text-sm"
          />
          <div className="text-xs text-[var(--muted)] mt-1">
            {fmt(s)} ~ {fmt(e)}
          </div>
          {item.location && (
            <input
              value={item.location || ''}
              onChange={(e) => onChange({ location: e.target.value })}
              className="w-full text-xs text-[var(--muted)] mt-1 bg-transparent border-b border-transparent focus:border-[var(--card-border)] focus:outline-none"
            />
          )}
          <div className="flex items-center gap-3 mt-2 text-xs">
            <select value={item.category} onChange={(e) => onChange({ category: e.target.value })}
              className="px-2 py-0.5 border rounded bg-[var(--card-bg)] border-[var(--card-border)]">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!item._public} onChange={(e) => onChange({ _public: e.target.checked })} />
              공개
            </label>
            <span className={`${lowConf ? 'text-amber-500' : 'text-[var(--muted)]'}`}>
              신뢰도 {(item.confidence * 100).toFixed(0)}%
            </span>
            {item.recurrence_rule && <span className="text-blue-500">반복 {item.recurrence_rule}</span>}
          </div>
          {item.warnings && item.warnings.length > 0 && (
            <ul className="text-xs text-amber-600 dark:text-amber-400 mt-1 list-disc list-inside">
              {item.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
        <button onClick={onRemove} className="text-xs text-[var(--muted)] hover:text-rose-500">삭제</button>
      </div>
    </div>
  );
}


/** 모바일 STT 버튼 (Web Speech API). 크롬/삼성 브라우저에서 동작. */
function VoiceInputButton({ onResult }: { onResult: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const start = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'ko-KR';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setListening(true);
    r.onresult = (ev: any) => {
      const text = ev.results[0][0].transcript;
      onResult(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
  };
  return (
    <button
      onClick={start}
      disabled={listening}
      className={`px-3 py-2 rounded-lg text-sm border ${
        listening ? 'border-rose-500 bg-rose-500/10 text-rose-500'
                  : 'border-[var(--card-border)] hover:border-blue-300'
      }`}
      title="음성 입력"
    >
      {listening ? '듣는 중…' : '음성'}
    </button>
  );
}


/** 사진 EXIF로 일정 역방향 생성 — GPS 좌표·촬영시각 추출하여 일정 자동 채움. 파일 업로드 없음 (메타데이터만). */
function PhotoExifMode({
  electionId, candidateId, onSaved,
}: {
  electionId: string; candidateId: string; onSaved: () => void;
}) {
  const [extracted, setExtracted] = useState<{
    lat?: number; lng?: number; takenAt?: string; preview?: string;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ScheduleCategory>('street');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string>('');

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setExtracted(null);
    try {
      const { default: exifr } = await import('exifr');
      const [meta, preview] = await Promise.all([
        exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude']),
        new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(file);
        }),
      ]);

      if (!meta || (!meta.latitude && !meta.GPSLatitude)) {
        setError('이 사진에는 GPS 좌표가 없습니다. 카메라 위치 정보 ON 상태로 찍은 사진을 올려주세요.');
        setLoading(false);
        return;
      }

      const lat = meta.latitude ?? meta.GPSLatitude;
      const lng = meta.longitude ?? meta.GPSLongitude;
      const taken = meta.DateTimeOriginal || meta.CreateDate;

      setExtracted({
        lat, lng,
        takenAt: taken ? new Date(taken).toISOString() : new Date().toISOString(),
        preview,
      });

      // 역지오코딩 (백엔드 카카오 API 호출) — 백엔드 생성 후 저장 시점에 자동 처리됨
      // 여기서는 화면 표시용으로 좌표 텍스트만
      setAddress(`위도 ${lat.toFixed(5)}, 경도 ${lng.toFixed(5)}`);
    } catch (e: any) {
      setError(e?.message || 'EXIF 파싱 실패 — 다른 사진으로 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!extracted || !title.trim()) {
      setError('제목을 입력하세요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const starts = new Date(extracted.takenAt!);
      const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000); // 2h 기본
      await api.createCandidateSchedule(electionId, {
        candidate_id: candidateId,
        title,
        location: address,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        category,
        visibility: isPublic ? 'public' : undefined,
        // lat/lng는 location 텍스트 기반 지오코딩이 자동 처리, 수동으로 주입하려면 API 확장 필요
      });
      setExtracted(null);
      setTitle('');
      onSaved();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        유세 현장에서 찍은 사진을 올리면 <strong>촬영 시각 + GPS 좌표</strong>를 자동 추출해 일정을 만듭니다.
        사진 파일은 서버에 저장되지 않습니다 (메타데이터만 사용).
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="block w-full text-sm border rounded-lg p-2 bg-[var(--card-bg)] border-[var(--card-border)]"
      />

      {loading && <p className="text-xs text-blue-500">EXIF 분석 중…</p>}

      {extracted && (
        <div className="border border-[var(--card-border)] rounded-lg p-3 space-y-2">
          {extracted.preview && (
            <img src={extracted.preview} alt="미리보기" className="max-h-40 rounded border border-[var(--card-border)]" />
          )}
          <div className="text-xs text-[var(--muted)] space-y-0.5">
            <div>촬영 시각: {new Date(extracted.takenAt!).toLocaleString('ko-KR')}</div>
            <div>위치: {address}</div>
          </div>

          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">일정 제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 용암동 거리인사 (현장 사진)"
              className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm"
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap text-sm">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ScheduleCategory)}
              className="px-2 py-1 border rounded bg-[var(--card-bg)] border-[var(--card-border)]"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              공개
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {saving ? '저장 중…' : '일정 생성'}
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-500 bg-rose-500/10 px-3 py-2 rounded">{error}</div>
      )}
    </div>
  );
}
