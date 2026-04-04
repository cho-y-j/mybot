'use client';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [tgData, setTgData] = useState<any>(null);
  const [botForm, setBotForm] = useState({ bot_token: '' });
  const [recipientForm, setRecipientForm] = useState({ chat_id: '', name: '', chat_type: 'private' });
  const [tenantForm, setTenantForm] = useState({ name: '', slug: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try { setTenant(await api.getMyTenant()); } catch {}
    try {
      const res = await fetch('/api/telegram/recipients', {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      });
      if (res.ok) setTgData(await res.json());
    } catch {}
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setTenant(await api.createTenant(tenantForm));
      setMessage('조직이 생성되었습니다');
    } catch (err: any) { setError(err.message); }
  };

  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/telegram/connect-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        body: JSON.stringify(botForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setMessage(`봇 연결 성공: @${data.bot_username}`);
      setBotForm({ bot_token: '' });
      loadAll();
    } catch (err: any) { setError(err.message); }
  };

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/telegram/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        body: JSON.stringify(recipientForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setMessage(data.message);
      setRecipientForm({ chat_id: '', name: '', chat_type: 'private' });
      loadAll();
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteRecipient = async (id: string) => {
    if (!confirm('이 수신자를 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/telegram/recipients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      });
      loadAll();
    } catch {}
  };

  const handleToggleRecipient = async (id: string, field: string, currentVal: boolean) => {
    try {
      await fetch(`/api/telegram/recipients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        body: JSON.stringify({ [field]: !currentVal }),
      });
      loadAll();
    } catch {}
  };

  const handleTestAll = async () => {
    try {
      const r = await api.testTelegram();
      setMessage(r.message);
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">설정</h1>

      {message && <div className="bg-success-50 text-success-600 p-3 rounded-lg text-sm">{message}</div>}
      {error && <div className="bg-danger-50 text-danger-600 p-3 rounded-lg text-sm">{error}</div>}

      {/* 조직 */}
      {!tenant ? (
        <div className="card">
          <h3 className="font-semibold mb-4">조직 생성</h3>
          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">조직 이름</label>
              <input className="input-field" value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                placeholder="예: 김진균 선거캠프" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">식별자 (영문)</label>
              <input className="input-field" value={tenantForm.slug}
                onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                placeholder="예: kim-camp-2026" required />
            </div>
            <button type="submit" className="btn-primary">조직 생성</button>
          </form>
        </div>
      ) : (
        <div className="card">
          <h3 className="font-semibold mb-4">조직 정보</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">조직명:</span> {tenant.name}</div>
            <div><span className="text-gray-500">요금제:</span> <span className="font-medium uppercase">{tenant.plan}</span></div>
            <div><span className="text-gray-500">최대 후보:</span> {tenant.max_candidates}명</div>
            <div><span className="text-gray-500">최대 키워드:</span> {tenant.max_keywords}개</div>
          </div>
        </div>
      )}

      {/* 텔레그램 봇 연결 */}
      <div className="card">
        <h3 className="font-semibold mb-4">텔레그램 봇</h3>
        {tgData?.bot_connected ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg mb-4">
            <span className="w-3 h-3 bg-green-500 rounded-full" />
            <span className="font-medium text-green-700">연결됨: @{tgData.bot_username}</span>
          </div>
        ) : (
          <form onSubmit={handleConnectBot} className="space-y-3 mb-4">
            <p className="text-sm text-gray-500">
              @BotFather에서 봇을 만들고 토큰을 입력하세요. 고객의 봇을 사용합니다.
            </p>
            <input className="input-field" value={botForm.bot_token}
              onChange={(e) => setBotForm({ bot_token: e.target.value })}
              placeholder="1234567890:ABCDefGHIjklMNOpqrsTUVwxyz" required />
            <button type="submit" className="btn-primary">봇 연결</button>
          </form>
        )}
      </div>

      {/* 수신자 관리 */}
      {tgData?.bot_connected && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">수신자 관리</h3>
            <button onClick={handleTestAll} className="btn-secondary text-sm">전체 테스트 발송</button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            보고서를 받을 사람/그룹을 추가하세요. 여러 명이 받을 수 있습니다.
          </p>

          {/* 수신자 목록 */}
          {tgData.recipients?.length > 0 ? (
            <div className="space-y-2 mb-6">
              {tgData.recipients.map((r: any) => (
                <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border ${r.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{r.chat_type === 'group' ? '👥' : '👤'}</span>
                    <div>
                      <span className="font-medium">{r.name}</span>
                      <span className="text-xs text-gray-400 ml-2">ID: {r.chat_id}</span>
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => handleToggleRecipient(r.id, 'receive_news', r.receive_news)}
                          className={`text-xs px-2 py-0.5 rounded-full ${r.receive_news ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                          📰 뉴스
                        </button>
                        <button onClick={() => handleToggleRecipient(r.id, 'receive_briefing', r.receive_briefing)}
                          className={`text-xs px-2 py-0.5 rounded-full ${r.receive_briefing ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                          📋 브리핑
                        </button>
                        <button onClick={() => handleToggleRecipient(r.id, 'receive_alert', r.receive_alert)}
                          className={`text-xs px-2 py-0.5 rounded-full ${r.receive_alert ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                          🚨 알림
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleRecipient(r.id, 'is_active', r.is_active)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${r.is_active ? 'left-[20px]' : 'left-0.5'}`} />
                    </button>
                    <button onClick={() => handleDeleteRecipient(r.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm mb-4">
              아직 수신자가 없습니다. 아래에서 추가하세요.
            </div>
          )}

          {/* 수신자 추가 */}
          <form onSubmit={handleAddRecipient} className="border-t pt-4 space-y-3">
            <h4 className="font-medium text-sm">수신자 추가</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">이름</label>
                <input className="input-field" value={recipientForm.name}
                  onChange={(e) => setRecipientForm({ ...recipientForm, name: e.target.value })}
                  placeholder="예: 캠프 대표, 전략팀" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">채팅 ID</label>
                <input className="input-field" value={recipientForm.chat_id}
                  onChange={(e) => setRecipientForm({ ...recipientForm, chat_id: e.target.value })}
                  placeholder="123456789" required />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">유형</label>
              <select className="input-field" value={recipientForm.chat_type}
                onChange={(e) => setRecipientForm({ ...recipientForm, chat_type: e.target.value })}>
                <option value="private">👤 개인</option>
                <option value="group">👥 그룹 채팅</option>
              </select>
            </div>
            <button type="submit" className="btn-primary w-full">수신자 추가</button>
          </form>
        </div>
      )}

      {/* 브리핑 발송 */}
      {tgData?.bot_connected && tgData.recipients?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">수동 브리핑 발송</h3>
          <p className="text-sm text-gray-500 mb-3">
            모든 활성 수신자에게 브리핑을 즉시 발송합니다.
          </p>
          <div className="flex gap-2">
            <button onClick={async () => {
              try { const r = await api.sendBriefing('morning'); setMessage(r.message); } catch (e: any) { setError(e.message); }
            }} className="btn-secondary text-sm">☀️ 오전 브리핑</button>
            <button onClick={async () => {
              try { const r = await api.sendBriefing('afternoon'); setMessage(r.message); } catch (e: any) { setError(e.message); }
            }} className="btn-secondary text-sm">🌤 오후 브리핑</button>
            <button onClick={async () => {
              try { const r = await api.sendBriefing('daily'); setMessage(r.message); } catch (e: any) { setError(e.message); }
            }} className="btn-primary text-sm">🌙 일일 보고서</button>
          </div>
        </div>
      )}
    </div>
  );
}
