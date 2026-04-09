'use client';
// 도지사 — 시장과 동일 구조이지만 제목/문구만 도지사 톤
import MayorView from './MayorView';

export default function GovernorView(props: { data: any; electionId: string; onRefresh: () => void }) {
  return <MayorView {...props} />;
}
