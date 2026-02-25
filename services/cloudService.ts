import { GlobalSettings, ReferenceCase, CaseData, User } from '../types';

// ── 通用请求封装 ──────────────────────────────────────────────────────────
const sbFetch = async (
  settings: GlobalSettings,
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const base = settings.supabaseUrl.replace(/\/$/, '');
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': settings.supabaseKey,
      'Authorization': `Bearer ${settings.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      ...(options.headers || {}),
    },
  });
};

const isConfigured = (s: GlobalSettings) => !!(s.supabaseUrl && s.supabaseKey);

// Supabase PostgREST 内部会自动处理 references 保留字，直接用原名即可
const REF_TABLE = 'references';

// ══════════════════════════════════════════════════════════════════════
// 成功案例库
// ══════════════════════════════════════════════════════════════════════
export const CloudService = {

  async getAllReferences(settings: GlobalSettings): Promise<{ data: ReferenceCase[] | null; error: any }> {
    if (!isConfigured(settings)) return { data: null, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, `${REF_TABLE}?select=*&order=created_at.desc`);
      if (!r.ok) {
        if (r.status === 404) return { data: [], error: null };
        return { data: null, error: `Supabase ${r.status}: ${await r.text()}` };
      }
      return { data: await r.json(), error: null };
    } catch (e: any) { return { data: null, error: e.message }; }
  },

  async upsertReference(settings: GlobalSettings, ref: ReferenceCase): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, REF_TABLE, { method: 'POST', body: JSON.stringify(ref) });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  async deleteReference(settings: GlobalSettings, id: string): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, `${REF_TABLE}?id=eq.${id}`, { method: 'DELETE' });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  // ══════════════════════════════════════════════════════════════════
  // 案件历史
  // ══════════════════════════════════════════════════════════════════

  async getAllCases(settings: GlobalSettings): Promise<{ data: CaseData[] | null; error: any }> {
    if (!isConfigured(settings)) return { data: null, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, 'cases?select=*&order=createdAt.desc');
      if (!r.ok) {
        if (r.status === 404) return { data: [], error: null };
        return { data: null, error: `Supabase ${r.status}: ${await r.text()}` };
      }
      return { data: await r.json(), error: null };
    } catch (e: any) { return { data: null, error: e.message }; }
  },

  async upsertCase(settings: GlobalSettings, c: CaseData): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, 'cases', { method: 'POST', body: JSON.stringify(c) });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  async deleteCase(settings: GlobalSettings, id: string): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, `cases?id=eq.${id}`, { method: 'DELETE' });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  // ══════════════════════════════════════════════════════════════════
  // 用户账号
  // ══════════════════════════════════════════════════════════════════

  async getAllUsers(settings: GlobalSettings): Promise<{ data: User[] | null; error: any }> {
    if (!isConfigured(settings)) return { data: null, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, 'users?select=*');
      if (!r.ok) {
        if (r.status === 404) return { data: [], error: null };
        return { data: null, error: `Supabase ${r.status}: ${await r.text()}` };
      }
      return { data: await r.json(), error: null };
    } catch (e: any) { return { data: null, error: e.message }; }
  },

  async upsertUser(settings: GlobalSettings, u: User): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, 'users', { method: 'POST', body: JSON.stringify(u) });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  async deleteUser(settings: GlobalSettings, id: string): Promise<{ success: boolean; error: any }> {
    if (!isConfigured(settings)) return { success: false, error: 'Missing config' };
    try {
      const r = await sbFetch(settings, `users?id=eq.${id}`, { method: 'DELETE' });
      return r.ok ? { success: true, error: null } : { success: false, error: await r.text() };
    } catch (e: any) { return { success: false, error: e.message }; }
  },

  // ══════════════════════════════════════════════════════════════════
  // 一键全量推送（首次迁移用）
  // ══════════════════════════════════════════════════════════════════

  async pushAllLocalData(
    settings: GlobalSettings,
    refs: ReferenceCase[],
    cases: CaseData[],
    users: User[]
  ): Promise<{ success: boolean; message: string }> {
    if (!isConfigured(settings)) return { success: false, message: 'Supabase 未配置' };
    let ok = 0, fail = 0;
    for (const r of refs)  { const res = await this.upsertReference(settings, r); res.success ? ok++ : fail++; }
    for (const c of cases) { const res = await this.upsertCase(settings, c);      res.success ? ok++ : fail++; }
    for (const u of users) { const res = await this.upsertUser(settings, u);      res.success ? ok++ : fail++; }
    return { success: fail === 0, message: `推送完成：成功 ${ok} 条，失败 ${fail} 条` };
  },
};
