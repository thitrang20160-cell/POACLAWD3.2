/**
 * authService.ts
 * 云端认证 — 登录/注册操作全部以 Supabase 为权威数据源
 *
 * Supabase 配置读取优先级：
 *   1. 构建时的环境变量 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *      → 在 Netlify Dashboard 设置后重新部署，所有浏览器都能用，员工零配置
 *   2. localStorage 中管理员保存的 settings（回退兼容）
 */

import { User, UserRole } from '../types';
import { loadSettings, loadUsers, updateUser, registerUser as localRegister, verifyPassword } from './storageService';

// ─────────────────────────────────────────────────────────────────────
// 获取 Supabase 配置（不依赖登录状态）
// ─────────────────────────────────────────────────────────────────────
export const getCloudConfig = (): { url: string; key: string } | null => {
  // 1. Vite 环境变量（Netlify 构建后烧入，全员可用）
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) return { url: envUrl.replace(/\/$/, ''), key: envKey };

  // 2. 本地 settings（仅管理员自己的浏览器有）
  const s = loadSettings();
  if (s.supabaseUrl && s.supabaseKey) return { url: s.supabaseUrl.replace(/\/$/, ''), key: s.supabaseKey };

  return null;
};

// ─────────────────────────────────────────────────────────────────────
// 通用 Supabase REST 请求
// ─────────────────────────────────────────────────────────────────────
const sbReq = (cfg: { url: string; key: string }, path: string, options: RequestInit = {}) =>
  fetch(`${cfg.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
      ...(options.headers ?? {}),
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 从云端查找指定用户名
// ─────────────────────────────────────────────────────────────────────
const fetchCloudUser = async (cfg: { url: string; key: string }, username: string): Promise<User | null> => {
  try {
    const r = await sbReq(cfg, `users?username=eq.${encodeURIComponent(username)}&select=*`);
    if (!r.ok) return null;
    const data: User[] = await r.json();
    return data[0] ?? null;
  } catch { return null; }
};

// ─────────────────────────────────────────────────────────────────────
// 推送单个用户到云端
// ─────────────────────────────────────────────────────────────────────
export const pushUserToCloud = async (cfg: { url: string; key: string }, user: User): Promise<void> => {
  try { await sbReq(cfg, 'users', { method: 'POST', body: JSON.stringify(user) }); }
  catch (e) { console.warn('pushUserToCloud:', e); }
};

// ─────────────────────────────────────────────────────────────────────
// 云端登录
// 流程：① 从云端取用户 → ② 本地验密 → ③ 缓存到 localStorage
// ─────────────────────────────────────────────────────────────────────
export const loginUserCloud = async (username: string, password: string): Promise<User> => {
  const name = username.trim();
  const cfg  = getCloudConfig();

  if (cfg) {
    const cloudUser = await fetchCloudUser(cfg, name);

    if (cloudUser) {
      if (!verifyPassword(cloudUser.username, password, cloudUser.passwordHash)) {
        throw new Error('账号或密码错误');
      }
      updateUser(cloudUser);   // 写入本地缓存
      return cloudUser;
    }

    // 云端无此用户 → 看是否为系统第一位（初始化场景）
    const localAll = loadUsers();
    if (localAll.length === 0) {
      // 建超管并同步到云端
      const u = localRegister(name, password, 'super_admin', '系统管理员');
      await pushUserToCloud(cfg, u);
      return u;
    }

    // 云端没有但本地有（未迁移的旧账号）→ 尝试本地验证后顺手推云端
    const localUser = localAll.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (localUser && verifyPassword(localUser.username, password, localUser.passwordHash)) {
      await pushUserToCloud(cfg, localUser);
      return localUser;
    }

    throw new Error('账号不存在，请联系管理员创建账号');
  }

  // ── 无云端配置：纯本地兼容模式 ───────────────────────────────────
  const localAll = loadUsers();
  if (localAll.length === 0) {
    return localRegister(name, password, 'super_admin', '系统管理员');
  }
  const u = localAll.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (!u || !verifyPassword(u.username, password, u.passwordHash)) throw new Error('账号或密码错误');
  return u;
};

// ─────────────────────────────────────────────────────────────────────
// 云端注册（管理员创建账号 → 自动同步云端）
// ─────────────────────────────────────────────────────────────────────
export const registerUserCloud = async (
  username: string, password: string, role: UserRole, companyName: string
): Promise<User> => {
  const cfg = getCloudConfig();

  // 先检查云端有没有同名
  if (cfg) {
    const existing = await fetchCloudUser(cfg, username.trim());
    if (existing) throw new Error('用户名已存在');
  }

  const u = localRegister(username.trim(), password, role, companyName);
  if (cfg) await pushUserToCloud(cfg, u);
  return u;
};

// ─────────────────────────────────────────────────────────────────────
// 更新用户信息 + 同步云端
// ─────────────────────────────────────────────────────────────────────
export const updateUserCloud = async (user: User): Promise<void> => {
  updateUser(user);
  const cfg = getCloudConfig();
  if (cfg) await pushUserToCloud(cfg, user);
};

// ─────────────────────────────────────────────────────────────────────
// 删除用户 + 云端同步
// ─────────────────────────────────────────────────────────────────────
export const deleteUserCloud = async (id: string): Promise<void> => {
  const { deleteUser } = await import('./storageService');
  deleteUser(id);
  const cfg = getCloudConfig();
  if (!cfg) return;
  try { await sbReq(cfg, `users?id=eq.${id}`, { method: 'DELETE' }); }
  catch (e) { console.warn('deleteUserCloud:', e); }
};

// ─────────────────────────────────────────────────────────────────────
// 修改密码 + 同步云端
// ─────────────────────────────────────────────────────────────────────
export const updatePasswordCloud = async (userId: string, newPwd: string): Promise<User | null> => {
  const { updateUserPassword } = await import('./storageService');
  const updated = updateUserPassword(userId, newPwd);
  if (updated) {
    const cfg = getCloudConfig();
    if (cfg) await pushUserToCloud(cfg, updated);
  }
  return updated;
};
