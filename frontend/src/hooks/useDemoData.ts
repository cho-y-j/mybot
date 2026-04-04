/**
 * API 데이터가 없을 때 후보자 기반 데모 데이터 자동 생성.
 * 실 데이터 수집 시작 후에는 API 데이터로 자동 교체됨.
 */
import type { Candidate } from './useElection';

// 시드 기반 난수 (동일 입력 → 동일 출력)
function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  return () => { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 13), 0x45d9f3b); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function generateDemoData(candidates: Candidate[]) {
  const names = candidates.filter(c => c.enabled).map(c => c.name);
  if (!names.length) return null;

  const ours = candidates.find(c => c.is_our_candidate);
  const oursName = ours?.name || names[0];

  // 후보별 뉴스 감성
  const newsBar = names.map(name => {
    const rng = seededRandom(name + 'news');
    const positive = Math.floor(rng() * 8) + 2;
    const negative = Math.floor(rng() * 5) + 1;
    const neutral = Math.floor(rng() * 6) + 1;
    return { name, count: positive + negative + neutral, positive, negative, neutral };
  });

  // 14일 감성 트렌드 (우리 후보 기준)
  const sentimentTrend = Array.from({ length: 14 }, (_, i) => {
    const rng = seededRandom(oursName + 'trend' + i);
    return {
      date: `${Math.floor((i + 20) / 31) + 3}/${((i + 20) % 31) + 1}`,
      positive: Math.floor(rng() * 12) + 3,
      negative: Math.floor(rng() * 8) + 1,
      neutral: Math.floor(rng() * 5) + 1,
    };
  });

  // 후보별 검색량 추이
  const searchTrend = Array.from({ length: 14 }, (_, i) => {
    const row: any = { date: `${Math.floor((i + 20) / 31) + 3}/${((i + 20) % 31) + 1}` };
    names.forEach(name => {
      const rng = seededRandom(name + 'search' + i);
      const base = name === oursName ? 30 : (name === names[1] ? 50 : 20);
      row[name] = Math.floor(rng() * 30) + base;
    });
    return row;
  });

  // 레이더 차트 (후보 경쟁력)
  const metrics = ['뉴스 노출', '검색량', '긍정 비율', '유튜브', '커뮤니티', '여론조사'];
  const radar = metrics.map(metric => {
    const row: any = { metric };
    names.forEach(name => {
      const rng = seededRandom(name + metric);
      row[name] = Math.floor(rng() * 60) + 20;
    });
    return row;
  });

  // 여론조사 추이
  const surveyDates = ['2/15', '2/28', '3/10', '3/20', '4/01'];
  const surveys = surveyDates.map((date, di) => {
    const row: any = { date };
    names.forEach(name => {
      const rng = seededRandom(name + 'survey' + di);
      const base = name === oursName ? 25 : (name === names[1] ? 32 : 18);
      row[name] = Math.floor(rng() * 10) + base + di;
    });
    return row;
  });

  // AI 인사이트 (동적 생성)
  const oursNews = newsBar.find(n => n.name === oursName);
  const topNews = [...newsBar].sort((a, b) => b.count - a.count)[0];
  const oursPosRate = oursNews ? Math.round(oursNews.positive / oursNews.count * 100) : 0;

  const aiInsight = {
    summary: `현재 ${topNews.name} 후보가 뉴스 노출량에서 ${topNews.count}건으로 선두입니다. `
      + `${oursName} 후보는 긍정률 ${oursPosRate}%로 ${oursPosRate > 60 ? '양호하지만' : '다소 낮으며'}, `
      + `절대 노출량은 ${oursNews?.count || 0}건으로 ${oursNews && topNews.count > oursNews.count ? '경쟁자 대비 부족합니다' : '선전하고 있습니다'}.`,
    strategies: names.slice(0, 3).map((name, i) => {
      const d = newsBar.find(n => n.name === name)!;
      const posRate = Math.round(d.positive / d.count * 100);
      if (name === oursName) {
        return `${name}: ${d.count < topNews.count ? '뉴스 노출량 확대 필요' : '현재 노출량 유지'} — 긍정률 ${posRate}%`;
      }
      return `${name}: 뉴스 ${d.count}건, 부정 ${d.negative}건 ${d.negative > 3 ? '— 약점 공략 가능' : '— 모니터링 지속'}`;
    }),
    risk: `${oursName} 후보의 노출량이 경쟁자 대비 ${
      oursNews && topNews.count > oursNews.count
        ? `${Math.round(oursNews.count / topNews.count * 100)}% 수준. 적극적 미디어 전략 필요.`
        : '양호하나, 부정 뉴스 발생 시 대응 체계 점검 필요.'
    }`,
  };

  // 알림 (동적)
  const alerts: any[] = [];
  newsBar.forEach(d => {
    if (d.negative >= 4) {
      alerts.push({ level: 'warning', title: `${d.name} 부정 뉴스 다수`, message: `${d.name} 후보 관련 부정 뉴스 ${d.negative}건 감지`, time: '오늘' });
    }
  });
  if (oursNews && topNews.count > oursNews.count * 1.5) {
    alerts.push({ level: 'critical', title: '검색량/노출 열세', message: `${oursName} 후보 노출이 ${topNews.name} 대비 ${Math.round(oursNews.count / topNews.count * 100)}% 수준`, time: '오늘' });
  }
  alerts.push({ level: 'opportunity', title: '이슈 선점 기회', message: '교육 관련 이슈 검색량 급상승 — 선제적 공약 발표로 선점 가능', time: '분석 결과' });

  // 최근 뉴스 (데모)
  const recentNews = names.flatMap(name => [
    { title: `${name} 후보 핵심 공약 발표...교육 혁신 비전 제시`, source: '지역일보', sentiment: 'positive' as const, candidate: name, time: `${Math.floor(Math.random() * 12) + 1}시간 전` },
    { title: `${name} 후보 지역 교육 현장 방문`, source: '뉴스매체', sentiment: 'neutral' as const, candidate: name, time: `${Math.floor(Math.random() * 20) + 2}시간 전` },
  ]).sort(() => Math.random() - 0.5).slice(0, 6);

  return {
    newsBar, sentimentTrend, searchTrend, radar, surveys,
    aiInsight, alerts, recentNews, oursName, oursPosRate,
  };
}
