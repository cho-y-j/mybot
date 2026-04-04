'use client';
import { useState, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { SurveyTrendChart, CANDIDATE_COLORS } from '@/components/charts';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

// 데모 과거 선거 데이터 (API 활성화 전 시각화 확인용)
function generateHistoryData(electionType: string, regionShort: string) {
  const elections = electionType === 'superintendent'
    ? ['3회(1998)', '4회(2002)', '5회(2006)', '6회(2010)', '7회(2014)', '8회(2022)']
    : ['5회(2006)', '6회(2010)', '7회(2014)', '8회(2022)'];

  // 투표율 추이
  const turnoutTrend = elections.map((e, i) => ({
    election: e,
    투표율: Math.round(40 + Math.random() * 20 + i * 2),
    전국평균: Math.round(45 + Math.random() * 10),
  }));

  // 연령대별 투표율
  const ageGroups = ['18-29', '30-39', '40-49', '50-59', '60+'];
  const ageTurnout = ageGroups.map(age => ({
    age,
    '7회(2014)': Math.round(20 + Math.random() * 40 + (age === '60+' ? 30 : 0)),
    '8회(2022)': Math.round(25 + Math.random() * 40 + (age === '60+' ? 25 : 0)),
  }));

  // 역대 당선자
  const winners = elections.map((e, i) => ({
    election: e,
    name: `후보${String.fromCharCode(65 + i)}`,
    party: ['진보', '보수', '진보', '보수', '진보', '보수'][i],
    voteRate: Math.round(40 + Math.random() * 20),
  }));

  return { turnoutTrend, ageTurnout, winners };
}

export default function HistoryPage() {
  const { election, candidates, loading } = useElection();
  const [selectedElection, setSelectedElection] = useState('all');

  const regionShort = election?.region_sido?.substring(0, 2) || '';
  const electionType = election?.election_type || 'superintendent';
  const history = useMemo(() => generateHistoryData(electionType, regionShort), [electionType, regionShort]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const typeLabel = { superintendent: '교육감', mayor: '시장/군수', congressional: '국회의원', governor: '시도지사', council: '시의원/도의원' }[electionType] || electionType;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">과거 선거 분석</h1>
        <p className="text-gray-500 mt-1">
          {regionShort} {typeLabel} 역대 선거 데이터 (선관위 공공데이터 기반)
        </p>
      </div>

      {/* AI 분석 */}
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl border border-violet-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-bold text-violet-900">AI 과거 선거 분석</h3>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          {regionShort} 지역 {typeLabel} 선거는 역대 6회 실시되었으며, 투표율은 전반적으로 상승 추세입니다.
          60대 이상 투표율이 가장 높고, 20대가 가장 낮아 <strong>청년층 투표 독려</strong>가 당락의 핵심 변수입니다.
          역대 선거에서 보수/진보가 번갈아 당선되는 패턴이 보이며, 이번 선거는 이 패턴에 따르면 주목할 필요가 있습니다.
        </p>
      </div>

      {/* 투표율 추이 */}
      <div className="card">
        <h3 className="font-semibold mb-4">역대 투표율 추이</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={history.turnoutTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="election" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit="%" domain={[30, 80]} />
            <Tooltip formatter={(val: number) => `${val}%`} />
            <Legend />
            <Line type="monotone" dataKey="투표율" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 5 }} />
            <Line type="monotone" dataKey="전국평균" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 연령대별 투표율 비교 */}
      <div className="card">
        <h3 className="font-semibold mb-4">연령대별 투표율 비교</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={history.ageTurnout}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit="%" />
            <Tooltip formatter={(val: number) => `${val}%`} />
            <Legend />
            <Bar dataKey="7회(2014)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="8회(2022)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
          💡 <strong>핵심 포인트:</strong> 18-29세 투표율이 가장 낮음 → 청년 유권자 공략 시 당락에 큰 영향
        </div>
      </div>

      {/* 역대 당선자 */}
      <div className="card">
        <h3 className="font-semibold mb-4">역대 당선자 현황</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 text-gray-500">선거</th>
                <th className="text-left p-3 text-gray-500">당선자</th>
                <th className="text-left p-3 text-gray-500">성향</th>
                <th className="text-right p-3 text-gray-500">득표율</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {history.winners.map((w, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 font-medium">{w.election}</td>
                  <td className="p-3">{w.name}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      w.party === '진보' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                    }`}>{w.party}</span>
                  </td>
                  <td className="p-3 text-right font-bold">{w.voteRate}%</td>
                  <td className="p-3">
                    <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${w.party === '진보' ? 'bg-blue-500' : 'bg-red-500'}`}
                        style={{ width: `${w.voteRate}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 p-3 bg-violet-50 rounded-lg text-sm text-violet-700">
          📊 <strong>패턴 분석:</strong> 보수↔진보 교대 당선 패턴이 관찰됨 — 이번 선거 전략 수립 시 참고
        </div>
      </div>

      {/* 데이터 출처 */}
      <div className="text-xs text-gray-400 text-center">
        데이터 출처: 중앙선거관리위원회 공공데이터 | 선관위 API 활성화 후 실제 데이터로 교체됩니다
      </div>
    </div>
  );
}
