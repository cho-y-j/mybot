/**
 * ElectionPulse - API Client
 * JWT 인증 + 자동 토큰 갱신
 */

const API_BASE = '/api';

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('access_token');
      this.refreshToken = localStorage.getItem('refresh_token');
    }
  }

  setTokens(tokens: TokenPair) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // 401 → 토큰 갱신 시도
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retry = await fetch(`${API_BASE}${path}`, { ...options, headers });
        if (!retry.ok) throw await this.parseError(retry);
        return retry.json();
      } else {
        this.clearTokens();
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    if (!res.ok) throw await this.parseError(res);

    if (res.status === 204) return {} as T;
    return res.json();
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.setTokens(data);
      return true;
    } catch {
      return false;
    }
  }

  private async parseError(res: Response) {
    try {
      const data = await res.json();
      return new Error(data.detail || `HTTP ${res.status}`);
    } catch {
      return new Error(`HTTP ${res.status}`);
    }
  }

  // ─── Auth ───────────────────────────────────────────────────
  register(data: { email: string; password: string; name: string; phone?: string }) {
    return this.request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
  }

  verifyEmail(email: string, code: string) {
    return this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  }

  login(email: string, password: string, totp_code?: string) {
    return this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp_code }),
    });
  }

  logout() {
    return this.request('/auth/logout', { method: 'POST' }).finally(() => this.clearTokens());
  }

  getProfile() {
    return this.request<any>('/auth/me');
  }

  // ─── Tenant ─────────────────────────────────────────────────
  createTenant(data: { name: string; slug: string; plan?: string }) {
    return this.request<any>('/tenants', { method: 'POST', body: JSON.stringify(data) });
  }

  getMyTenant() {
    return this.request<any>('/tenants/me');
  }

  // ─── Elections ──────────────────────────────────────────────
  getElections() {
    return this.request<any[]>('/elections');
  }

  createElection(data: any) {
    return this.request<any>('/elections', { method: 'POST', body: JSON.stringify(data) });
  }

  // ─── Candidates ─────────────────────────────────────────────
  getCandidates(electionId: string) {
    return this.request<any[]>(`/elections/${electionId}/candidates`);
  }

  addCandidate(electionId: string, data: any) {
    return this.request<any>(`/elections/${electionId}/candidates`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateCandidate(electionId: string, candidateId: string, data: any) {
    return this.request<any>(`/elections/${electionId}/candidates/${candidateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteCandidate(electionId: string, candidateId: string) {
    return this.request(`/elections/${electionId}/candidates/${candidateId}`, { method: 'DELETE' });
  }

  // ─── Keywords ───────────────────────────────────────────────
  getKeywords(electionId: string) {
    return this.request<any[]>(`/elections/${electionId}/keywords`);
  }

  addKeyword(electionId: string, data: any) {
    return this.request<any>(`/elections/${electionId}/keywords`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ─── Analysis ───────────────────────────────────────────────
  getAnalysisOverview(electionId: string, days: number = 7) {
    return this.request<any>(`/analysis/${electionId}/overview?days=${days}`);
  }

  getSentimentTrend(electionId: string, days: number = 14) {
    return this.request<any>(`/analysis/${electionId}/sentiment-trend?days=${days}`);
  }

  getSearchTrends(electionId: string, days: number = 7) {
    return this.request<any>(`/analysis/${electionId}/search-trends?days=${days}`);
  }

  // ─── Reports ────────────────────────────────────────────────
  getReports(electionId: string) {
    return this.request<any[]>(`/reports/${electionId}`);
  }

  getReport(electionId: string, reportId: string) {
    return this.request<any>(`/reports/${electionId}/${reportId}`);
  }

  generateReport(electionId: string, type: string = 'daily') {
    return this.request<any>(`/reports/${electionId}/generate?report_type=${type}`, { method: 'POST' });
  }

  // ─── Telegram ───────────────────────────────────────────────
  connectTelegram(botToken: string, chatId: string) {
    return this.request<any>('/telegram/connect', {
      method: 'POST',
      body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
    });
  }

  getTelegramStatus() {
    return this.request<any>('/telegram/status');
  }

  testTelegram() {
    return this.request<any>('/telegram/test', { method: 'POST' });
  }

  sendBriefing(type: string = 'daily') {
    return this.request<any>(`/telegram/send-briefing?briefing_type=${type}`, { method: 'POST' });
  }

  // ─── Collection ─────────────────────────────────────────────
  getCollectionStatus(electionId: string) {
    return this.request<any>(`/collectors/${electionId}/status`);
  }

  collectNow(electionId: string, type: string = 'news') {
    return this.request<any>(`/collectors/${electionId}/collect-now?collect_type=${type}`, { method: 'POST' });
  }

  getKeywordTrends(electionId: string, days: number = 30) {
    return this.request<any>(`/collectors/${electionId}/keyword-trends?days=${days}`);
  }

  collectTrendsNow(electionId: string) {
    return this.request<any>(`/collectors/${electionId}/collect-trends`, { method: 'POST' });
  }

  getCollectedNews(electionId: string, limit: number = 50, candidateId?: string, sentiment?: string) {
    let url = `/collectors/${electionId}/news?limit=${limit}`;
    if (candidateId) url += `&candidate_id=${candidateId}`;
    if (sentiment) url += `&sentiment=${sentiment}`;
    return this.request<any[]>(url);
  }

  // ─── Schedules ──────────────────────────────────────────────
  getSchedules(electionId: string) {
    return this.request<any[]>(`/elections/${electionId}/schedules`);
  }

  createSchedule(electionId: string, data: any) {
    return this.request<any>(`/elections/${electionId}/schedules`, {
      method: 'POST', body: JSON.stringify(data),
    });
  }

  updateSchedule(electionId: string, scheduleId: string, data: any) {
    return this.request<any>(`/elections/${electionId}/schedules/${scheduleId}?${new URLSearchParams(data)}`, {
      method: 'PUT',
    });
  }

  deleteSchedule(electionId: string, scheduleId: string) {
    return this.request(`/elections/${electionId}/schedules/${scheduleId}`, { method: 'DELETE' });
  }

  createDefaultSchedules(electionId: string) {
    return this.request<any>(`/elections/${electionId}/schedules/create-defaults`, { method: 'POST' });
  }

  // ─── AI Chat (긴 타임아웃) ──────────────────────────────────
  async sendChat(message: string, electionId?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2분 타임아웃
    try {
      const res = await fetch(`${API_BASE}/chat/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, election_id: electionId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Competitor / Content / AI Report ─────────────────────────
  getCompetitorGaps(electionId: string, days: number = 7) {
    return this.request<any>(`/analysis/${electionId}/competitor-gaps?days=${days}`);
  }

  getContentStrategy(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/content-strategy`);
  }

  generateAIReport(electionId: string, sendTelegram: boolean = false) {
    return this.request<any>(`/analysis/${electionId}/generate-ai-report?send_telegram=${sendTelegram}`, { method: 'POST' });
  }

  // ─── Surveys ────────────────────────────────────────────────
  getSurveys(electionId: string) { return this.request<any>(`/surveys/${electionId}/surveys`); }
  getSurveyDetail(electionId: string, surveyId: string) { return this.request<any>(`/surveys/${electionId}/surveys/${surveyId}`); }
  createSurvey(electionId: string, data: any) {
    return this.request<any>(`/surveys/${electionId}/surveys`, { method: 'POST', body: JSON.stringify(data) });
  }
  deleteSurvey(electionId: string, surveyId: string) {
    return this.request(`/surveys/${electionId}/surveys/${surveyId}`, { method: 'DELETE' });
  }

  // ─── Content Tools ──────────────────────────────────────────
  getHashtags(electionId: string) { return this.request<any>(`/content/hashtags/${electionId}`); }
  getBlogTags(electionId: string) { return this.request<any>(`/content/blog-tags/${electionId}`); }
  getContentSuggestions(electionId: string) { return this.request<any>(`/content/suggestions/${electionId}`); }
  checkCompliance(electionId: string, text: string, contentType: string = 'general') {
    return this.request<any>(`/content/check-compliance/${electionId}`, {
      method: 'POST', body: JSON.stringify({ text, content_type: contentType }),
    });
  }

  // ─── Onboarding ─────────────────────────────────────────────
  getRegions() { return this.request<any[]>('/onboarding/regions'); }
  getElectionTypes() { return this.request<any[]>('/onboarding/election-types'); }
  getParties() { return this.request<any[]>('/onboarding/parties'); }

  previewSetup(data: any) {
    return this.request<any>('/onboarding/preview', { method: 'POST', body: JSON.stringify(data) });
  }

  applySetup(data: any) {
    return this.request<any>('/onboarding/apply', { method: 'POST', body: JSON.stringify(data) });
  }

  // ─── Billing ────────────────────────────────────────────────
  getPlans() {
    return this.request<any[]>('/billing/plans');
  }

  getCurrentSubscription() {
    return this.request<any>('/billing/current');
  }
}

export const api = new ApiClient();
