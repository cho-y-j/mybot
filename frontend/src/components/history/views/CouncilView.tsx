'use client';
// 시·도의원 / 구·시·군의원 — 시장 view 재사용
import MayorView from './MayorView';

export default function CouncilView(props: { data: any; electionId: string; onRefresh: () => void }) {
  return <MayorView {...props} />;
}
