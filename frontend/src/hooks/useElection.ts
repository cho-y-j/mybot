'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

export interface Candidate {
  id: string;
  name: string;
  party: string | null;
  party_alignment: string | null;
  is_our_candidate: boolean;
  enabled: boolean;
  search_keywords: string[];
  homonym_filters: string[];
}

export interface Election {
  id: string;
  name: string;
  election_type: string;
  region_sido: string | null;
  region_sigungu: string | null;
  election_date: string;
  is_active: boolean;
  d_day: number;
  candidates_count: number;
  keywords_count: number;
  our_candidate_id: string | null;
}

/**
 * 현재 활성 선거 + 후보자 + 분석 데이터를 통합 관리.
 * 어떤 고객이든 자기 선거 데이터로 동적 적용.
 */
export function useElection() {
  const [election, setElection] = useState<Election | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [collectionStatus, setCollectionStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const elections = await api.getElections();
      if (!elections.length) {
        setElection(null);
        return;
      }

      const el = elections[0]; // 활성 선거 중 첫 번째
      setElection(el);

      const [cands, ov, collStatus] = await Promise.all([
        api.getCandidates(el.id),
        api.getAnalysisOverview(el.id).catch(() => null),
        api.getCollectionStatus(el.id).catch(() => null),
      ]);
      setCandidates(cands);
      setOverview(ov);
      setCollectionStatus(collStatus);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 우리 후보
  const ourCandidate = candidates.find(c => c.is_our_candidate) || null;
  // 경쟁 후보
  const competitors = candidates.filter(c => !c.is_our_candidate && c.enabled);
  // 모든 후보 이름
  const candidateNames = candidates.filter(c => c.enabled).map(c => c.name);

  return {
    election, candidates, candidateNames,
    ourCandidate, competitors,
    overview, collectionStatus,
    loading, error, reload: load,
  };
}

/**
 * 후보 색상 — 우리 후보는 파란색, 나머지 순서대로.
 */
export const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export function getCandidateColor(index: number, isOurs: boolean): string {
  if (isOurs) return '#3b82f6'; // 우리 후보는 항상 파란색
  const nonOurColors = ['#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
  return nonOurColors[index % nonOurColors.length];
}

export function getCandidateColorMap(candidates: Candidate[]): Record<string, string> {
  const map: Record<string, string> = {};
  let compIdx = 0;
  candidates.forEach(c => {
    if (c.is_our_candidate) {
      map[c.name] = '#3b82f6';
    } else {
      map[c.name] = ['#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'][compIdx % 5];
      compIdx++;
    }
  });
  return map;
}
