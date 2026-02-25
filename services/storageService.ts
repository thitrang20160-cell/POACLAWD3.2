import { CaseData, GlobalSettings, ReferenceCase, User, UserRole, StoreProfile } from '../types';

const CASE_KEY      = 'wmt_poa_cases_v7';
const SETTINGS_KEY  = 'wmt_poa_settings_v7';
const REFERENCE_KEY = 'wmt_poa_references_v3';
const USERS_KEY     = 'wmt_poa_users_v2';
const SESSION_KEY   = 'wmt_poa_session_v2';
const PROFILES_KEY  = 'wmt_poa_store_profiles_v1'; // ── 新增

// ── 密码哈希 (客户端安全) ─────────────────────────────────────────────
const hashPassword = (username: string, password: string): string => {
  const raw = `zeyuan_2025:${username.toLowerCase()}:${password}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
  return btoa(Math.abs(h).toString() + raw.length.toString(16));
};

export const verifyPassword = (username: string, password: string, storedHash: string): boolean =>
  hashPassword(username, password) === storedHash;

// ── 用户 ──────────────────────────────────────────────────────────────
export const loadUsers = (): User[] => {
  try { const d = localStorage.getItem(USERS_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
};
const saveUsers = (u: User[]) => localStorage.setItem(USERS_KEY, JSON.stringify(u));

export const registerUser = (username: string, password: string, role: UserRole = 'client', companyName?: string): User => {
  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('用户名已存在');
  if (password.length < 4) throw new Error('密码至少4位');
  const u: User = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    username: username.trim(), passwordHash: hashPassword(username.trim(), password),
    role, companyName, createdAt: new Date().toISOString(),
  };
  users.push(u); saveUsers(users); return u;
};

export const loginUser = (username: string, password: string): User => {
  const users = loadUsers();
  if (users.length === 0) {
    const root: User = {
      id: 'root_' + Date.now(), username: username.trim(),
      passwordHash: hashPassword(username.trim(), password),
      role: 'super_admin', companyName: '系统管理员', createdAt: new Date().toISOString(),
    };
    saveUsers([root]); return root;
  }
  const u = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!u) throw new Error('账号或密码错误');
  if (!verifyPassword(u.username, password, u.passwordHash)) throw new Error('账号或密码错误');
  return u;
};

export const getCurrentSession = (): User | null => {
  try { const d = localStorage.getItem(SESSION_KEY); return d ? JSON.parse(d) : null; } catch { return null; }
};
export const setCurrentSession = (u: User | null) => {
  u ? localStorage.setItem(SESSION_KEY, JSON.stringify(u)) : localStorage.removeItem(SESSION_KEY);
};
export const getAllUsers = (): User[] => loadUsers();
export const deleteUser  = (id: string) => saveUsers(loadUsers().filter(u => u.id !== id));
export const updateUser  = (u: User) => {
  const users = loadUsers(); const i = users.findIndex(x => x.id === u.id);
  if (i !== -1) { users[i] = u; saveUsers(users); }
};
export const updateUserPassword = (userId: string, newPwd: string): User | null => {
  const users = loadUsers(); const i = users.findIndex(u => u.id === userId);
  if (i === -1) return null;
  users[i].passwordHash = hashPassword(users[i].username, newPwd);
  saveUsers(users); return { ...users[i] };
};

// ── 案件 ──────────────────────────────────────────────────────────────
export const loadCases  = (): CaseData[] => {
  try { const d = localStorage.getItem(CASE_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
};
export const saveCases  = (c: CaseData[]) => {
  try { localStorage.setItem(CASE_KEY, JSON.stringify(c)); } catch (e) { console.error('saveCases failed', e); }
};

// ── 设置 ──────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: GlobalSettings = {
  selectedProvider: 'gemini', apiKey: '', deepseekKey: '',
  supabaseUrl: '', supabaseKey: '',
  enableSimulationMode: true,
  strategyGeneral: '态度诚恳，数据导向。强调"以客户为中心"的整改决心。',
  strategyLogistics: '逻辑重点：排查 ERP 数据抓取延迟 → 立即更换承运商（FedEx/UPS）→ 开启周末配送模式。',
  strategyIP: '逻辑重点：立即删除侵权 Listing → 全店排查类似产品 → 引入第三方 IP 律所培训员工。',
};
export const loadSettings = (): GlobalSettings => {
  try { const d = localStorage.getItem(SETTINGS_KEY); if (d) return { ...DEFAULT_SETTINGS, ...JSON.parse(d) }; }
  catch {}; return { ...DEFAULT_SETTINGS };
};
export const saveSettings = (s: GlobalSettings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

// ── 案例库 ────────────────────────────────────────────────────────────
export const loadReferences = (): ReferenceCase[] => {
  try { const d = localStorage.getItem(REFERENCE_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
};
export const saveReferences = (r: ReferenceCase[]) => {
  try { localStorage.setItem(REFERENCE_KEY, JSON.stringify(r)); }
  catch { alert('本地存储空间不足，请导出备份并清理旧数据。'); }
};

// ── 店铺档案（新增）──────────────────────────────────────────────────
export const loadStoreProfiles = (): StoreProfile[] => {
  try { const d = localStorage.getItem(PROFILES_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
};
export const saveStoreProfiles = (p: StoreProfile[]) =>
  localStorage.setItem(PROFILES_KEY, JSON.stringify(p));
export const addStoreProfile = (p: StoreProfile) => {
  const profiles = loadStoreProfiles();
  // 同名店铺直接覆盖
  const idx = profiles.findIndex(x => x.storeName === p.storeName && x.companyName === p.companyName);
  if (idx !== -1) profiles[idx] = p; else profiles.unshift(p);
  saveStoreProfiles(profiles);
};
export const deleteStoreProfile = (id: string) =>
  saveStoreProfiles(loadStoreProfiles().filter(p => p.id !== id));
