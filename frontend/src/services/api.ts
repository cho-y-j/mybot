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
    if ((tokens as any).user) {
      localStorage.setItem('user', JSON.stringify((tokens as any).user));
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
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

  changePassword(currentPassword: string, newPassword: string) {
    return this.request<any>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
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

  deleteReport(electionId: string, reportId: string) {
    return this.request<any>(`/reports/${electionId}/${reportId}`, { method: 'DELETE' });
  }

  generateReport(electionId: string, type: string = 'daily', topic?: string) {
    const params = new URLSearchParams({ report_type: type });
    if (topic) params.set('topic', topic);
    return this.request<any>(`/reports/${electionId}/generate?${params}`, { method: 'POST' });
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

  searchKeyword(electionId: string, keyword: string) {
    return this.request<any>(`/collectors/${electionId}/search-keyword?keyword=${encodeURIComponent(keyword)}`);
  }

  getKeywordVolumes(electionId: string, extraKeywords?: string) {
    const params = extraKeywords ? `?extra_keywords=${encodeURIComponent(extraKeywords)}` : '';
    return this.request<any>(`/collectors/${electionId}/keyword-volumes${params}`);
  }

  getKeywordCategories(electionType: string = 'superintendent') {
    return this.request<any>(`/content/keyword-categories?election_type=${encodeURIComponent(electionType)}`);
  }

  getRegionalKeywordTrends(electionId: string, days: number = 30) {
    return this.request<any>(`/collectors/${electionId}/keyword-trends-regional?days=${days}`);
  }

  getBlogTags(electionId: string) {
    return this.request<any>(`/content/blog-tags/${electionId}`);
  }

  getIssueCandidateMatrix(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/issue-candidate-matrix`);
  }

  getSwingVoterAnalysis(electionId: string, days: number = 30) {
    return this.request<any>(`/analysis/${electionId}/swing-voters?days=${days}`);
  }

  getAdAnalysis(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/ads`);
  }

  collectAds(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/collect-ads`, { method: 'POST' });
  }

  getCommunityData(electionId: string, days: number = 30) {
    return this.request<any>(`/analysis/${electionId}/community-data?days=${days}`);
  }

  getCommunityPosts(electionId: string, days: number = 30, candidate: string = '', sentiment: string = '') {
    const params = new URLSearchParams({ days: String(days), limit: '200' });
    if (candidate) params.set('candidate', candidate);
    if (sentiment) params.set('sentiment', sentiment);
    return this.request<any[]>(`/analysis/${electionId}/community-posts?${params}`);
  }

  refreshBriefing(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/refresh-briefing`, { method: 'POST' });
  }

  analyzeMediaWithAI(electionId: string, limit: number = 15) {
    return this.request<any>(`/analysis/${electionId}/analyze-media?limit=${limit}`, { method: 'POST' });
  }

  getAIThreats(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/ai-threats`);
  }

  getMediaOverview(electionId: string, days: number = 7) {
    return this.request<any>(`/analysis/${electionId}/media-overview?days=${days}`);
  }

  getElectionLawToc() {
    return this.request<any>('/content/election-law');
  }

  searchElectionLaw(query: string) {
    return this.request<any>(`/content/election-law/search?q=${encodeURIComponent(query)}`);
  }

  getElectionLawSection(sectionId: string) {
    return this.request<any>(`/content/election-law/${sectionId}`);
  }

  generateContent(electionId: string, contentType: string, topic: string, style: string = 'formal', context: string = '', purpose: string = 'promote', target: string = 'all') {
    const params = new URLSearchParams({ content_type: contentType, topic, style, context, purpose, target });
    return this.request<any>(`/content/generate-content/${electionId}?${params}`, { method: 'POST' });
  }

  getContentSituations(electionId: string) {
    return this.request<any>(`/content/content-situations/${electionId}`);
  }

  generateDebateScript(electionId: string, topics: string[] = [], opponent?: string, style: string = 'balanced', format: string = 'broadcast', speech_minutes: number = 3) {
    return this.request<any>(`/content/debate-script/${electionId}`, {
      method: 'POST',
      body: JSON.stringify({ topics, opponent, style, format, speech_minutes }),
    });
  }

  // ─── Content History (생성된 콘텐츠/토론 저장소) ───
  getContentHistory(electionId: string, opts?: { contentTypes?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (opts?.contentTypes) params.set('content_types', opts.contentTypes);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<any>(`/content/history/${electionId}${qs}`);
  }

  getContentHistoryDetail(reportId: string) {
    return this.request<any>(`/content/history-detail/${reportId}`);
  }

  getBootstrapStatus(electionId: string) {
    return this.request<any>(`/onboarding/elections/${electionId}/bootstrap-status`);
  }

  generateMultiTone(electionId: string, topic: string, context: string = '', platforms: string[] = ['instagram', 'blog'], tones: string[] = ['formal', 'friendly']) {
    return this.request<any>(`/content/generate-multi-tone/${electionId}`, {
      method: 'POST',
      body: JSON.stringify({ topic, context, platforms, tones }),
    });
  }

  getCollectedNews(electionId: string, limit: number = 50, candidateId?: string, sentiment?: string) {
    let url = `/collectors/${electionId}/news?limit=${limit}`;
    if (candidateId) url += `&candidate_id=${candidateId}`;
    if (sentiment) url += `&sentiment=${sentiment}`;
    return this.request<any[]>(url);
  }

  // ─── Strategic 4-Quadrant ───────────────────────────────────
  getStrategicQuadrant(electionId: string, media: 'all'|'news'|'community'|'youtube' = 'all', itemsPerQuadrant: number = 5) {
    return this.request<any>(`/strategy/${electionId}/quadrant?media=${media}&items_per_quadrant=${itemsPerQuadrant}`);
  }

  triggerStrategicAnalysis(electionId: string, limitPerType: number = 30) {
    return this.request<any>(`/strategy/${electionId}/analyze?limit_per_type=${limitPerType}`, { method: 'POST' });
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
    return this.request<any>(`/elections/${electionId}/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteSchedule(electionId: string, scheduleId: string) {
    return this.request(`/elections/${electionId}/schedules/${scheduleId}`, { method: 'DELETE' });
  }

  createDefaultSchedules(electionId: string) {
    return this.request<any>(`/elections/${electionId}/schedules/create-defaults`, { method: 'POST' });
  }

  // ─── AI Chat (긴 타임아웃) ──────────────────────────────────
  async sendChat(message: string, electionId?: string, modelTier?: string, sessionId?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(`${API_BASE}/chat/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, election_id: electionId, model_tier: modelTier, session_id: sessionId }),
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
  getCompetitorGaps(electionId: string, days: number = 7, refresh: boolean = false) {
    return this.request<any>(`/analysis/${electionId}/competitor-gaps?days=${days}&refresh=${refresh}`);
  }

  getContentStrategy(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/content-strategy`);
  }

  generateAIReport(electionId: string, sendTelegram: boolean = false) {
    return this.request<any>(`/analysis/${electionId}/generate-ai-report?send_telegram=${sendTelegram}`, { method: 'POST' });
  }

  getRealtimeTrends() {
    return this.request<any>('/analysis/realtime-trends');
  }

  getHistoryDeepAnalysis(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/history-deep-analysis`);
  }

  generateHistoryAIStrategy(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/history-ai-strategy`, { method: 'POST' });
  }

  getDongResults(electionId: string, sigungu?: string, year?: number) {
    const qs = new URLSearchParams();
    if (sigungu) qs.set('sigungu', sigungu);
    if (year) qs.set('year', String(year));
    const q = qs.toString();
    return this.request<any>(`/analysis/${electionId}/dong-results${q ? '?' + q : ''}`);
  }

  getSurveyDeepAnalysis(electionId: string) {
    return this.request<any>(`/analysis/${electionId}/survey-deep-analysis`);
  }

  getSurveyCrosstabs(electionId: string, surveyId: string) {
    return this.request<any>(`/surveys/${electionId}/surveys/${surveyId}`);
  }

  getYouTubeData(electionId: string, days: number = 30) {
    return this.request<any>(`/analysis/${electionId}/youtube-data?days=${days}`);
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

  // 챗 세션
  getChatSessions(electionId?: string) {
    const q = electionId ? `?election_id=${electionId}` : '';
    return this.request<any[]>(`/chat/sessions${q}`);
  }

  getChatSessionMessages(sessionId: string) {
    return this.request<any[]>(`/chat/sessions/${sessionId}/messages`);
  }

  deleteChatSession(sessionId: string) {
    return this.request<any>(`/chat/sessions/${sessionId}`, { method: 'DELETE' });
  }

  deleteChatMessage(messageId: string) {
    return this.request<any>(`/chat/message/${messageId}`, { method: 'DELETE' });
  }

  // 수집 데이터 삭제
  deleteNewsItem(itemId: string) {
    return this.request<any>(`/analysis/news/${itemId}`, { method: 'DELETE' });
  }

  deleteCommunityItem(itemId: string) {
    return this.request<any>(`/analysis/community/${itemId}`, { method: 'DELETE' });
  }

  deleteYoutubeItem(itemId: string) {
    return this.request<any>(`/analysis/youtube/${itemId}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
