import { CaseData, GlobalSettings, ReferenceCase, User, UserRole } from '../types';

const CASE_KEY = 'wmt_poa_cases_v6';
const SETTINGS_KEY = 'wmt_poa_settings_v6';
const REFERENCE_KEY = 'wmt_poa_references_v2';
const USERS_KEY = 'wmt_poa_users_v2';
const SESSION_KEY = 'wmt_poa_session_v2';

// --- Simple password hashing (client-side safe) ---
const hashPassword = (username: string, password: string): string => {
  const salt = 'zeyuan_poa_2025';
  const raw = `${salt}:${username.toLowerCase()}:${password}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(String(Math.abs(hash)) + raw.length.toString(16));
};

export const verifyPassword = (username: string, password: string, storedHash: string): boolean => {
  return hashPassword(username, password) === storedHash;
};

// --- Users ---
export const loadUsers = (): User[] => {
  try {
    const d = localStorage.getItem(USERS_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
};

const saveUsers = (users: User[]) => {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const registerUser = (
  username: string, password: string, role: UserRole = 'client', companyName?: string
): User => {
  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('用户名已存在');
  }
  if (password.length < 4) throw new Error('密码至少需要4位');
  const newUser: User = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    username: username.trim(),
    passwordHash: hashPassword(username.trim(), password),
    role,
    companyName,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  saveUsers(users);
  return newUser;
};

export const loginUser = (username: string, password: string): User => {
  const users = loadUsers();

  // First-run: if no users at all, create a super_admin from this login
  if (users.length === 0) {
    const rootAdmin: User = {
      id: 'root_' + Date.now(),
      username: username.trim(),
      passwordHash: hashPassword(username.trim(), password),
      role: 'super_admin',
      companyName: '系统管理员',
      createdAt: new Date().toISOString(),
    };
    saveUsers([rootAdmin]);
    return rootAdmin;
  }

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) throw new Error('账号或密码错误');
  if (!verifyPassword(user.username, password, user.passwordHash)) throw new Error('账号或密码错误');
  return user;
};

export const getCurrentSession = (): User | null => {
  try {
    const d = localStorage.getItem(SESSION_KEY);
    return d ? JSON.parse(d) : null;
  } catch { return null; }
};

export const setCurrentSession = (user: User | null) => {
  if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else localStorage.removeItem(SESSION_KEY);
};

export const getAllUsers = (): User[] => loadUsers();

export const deleteUser = (userId: string) => {
  saveUsers(loadUsers().filter(u => u.id !== userId));
};

export const updateUser = (updated: User) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === updated.id);
  if (idx !== -1) { users[idx] = updated; saveUsers(users); }
};

export const updateUserPassword = (userId: string, newPassword: string) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx !== -1) {
    users[idx].passwordHash = hashPassword(users[idx].username, newPassword);
    saveUsers(users);
    return { ...users[idx] };
  }
  return null;
};

// --- Cases ---
export const loadCases = (): CaseData[] => {
  try {
    const d = localStorage.getItem(CASE_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
};

export const saveCases = (cases: CaseData[]) => {
  try { localStorage.setItem(CASE_KEY, JSON.stringify(cases)); }
  catch (e) { console.error('Failed to save cases', e); }
};

// --- Settings ---
const DEFAULT_SETTINGS: GlobalSettings = {
  selectedProvider: 'gemini',
  apiKey: '',
  deepseekKey: '',
  supabaseUrl: '',
  supabaseKey: '',
  walmartClientId: '',
  walmartClientSecret: '',
  enableSimulationMode: true,
  strategyGeneral: '态度诚恳，数据导向。强调"以客户为中心"的整改决心。',
  strategyLogistics: '逻辑重点：排查 ERP 数据抓取延迟 → 立即更换承运商（如 FedEx/UPS） → 开启周末配送模式。',
  strategyIP: '逻辑重点：立即删除侵权 Listing → 审查全店类似产品 → 引入第三方知识产权律所进行员工培训。',
};

export const loadSettings = (): GlobalSettings => {
  try {
    const d = localStorage.getItem(SETTINGS_KEY);
    if (d) return { ...DEFAULT_SETTINGS, ...JSON.parse(d) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
};

export const saveSettings = (s: GlobalSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
};

// --- References ---
export const loadReferences = (): ReferenceCase[] => {
  try {
    const d = localStorage.getItem(REFERENCE_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
};

export const saveReferences = (refs: ReferenceCase[]) => {
  try { localStorage.setItem(REFERENCE_KEY, JSON.stringify(refs)); }
  catch {
    alert('本地存储空间可能已满，请导出备份并清理旧数据。');
  }
};
