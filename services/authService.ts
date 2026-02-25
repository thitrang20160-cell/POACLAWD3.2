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
// 查询云端用户总数（判断是否为全新系统）
const fetchCloudUserCount = async (cfg: { url: string; key: string }): Promise<number> => {
  try {
    const r = await sbReq(cfg, 'users?select=id', {
      headers: { Prefer: 'count=exact' },
    });
    const countHeader = r.headers.get('content-range'); // e.g. "0-9/42"
    if (countHeader) {
      const total = parseInt(countHeader.split('/')[1] ?? '0', 10);
      if (!isNaN(total)) return total;
    }
    // 回退：直接数结果
    if (r.ok) { const data = await r.json(); return data.length; }
    return -1; // 出错时返回 -1，表示未知
  } catch { return -1; }
};

export const loginUserCloud = async (username: string, password: string): Promise<User> => {
  const name = username.trim();
  const cfg  = getCloudConfig();

  if (cfg) {
    // ① 先查这个用户名是否存在于云端
    const cloudUser = await fetchCloudUser(cfg, name);

    if (cloudUser) {
      // 找到了 → 验密码
      if (!verifyPassword(cloudUser.username, password, cloudUser.passwordHash)) {
        throw new Error('账号或密码错误');
      }
      updateUser(cloudUser);
      return cloudUser;
    }

    // ② 云端没有这个用户 → 检查云端是否完全为空（全新系统初始化）
    const cloudTotal = await fetchCloudUserCount(cfg);
    if (cloudTotal === 0) {
      // 系统第一个用户，任意账号密码均成为超级管理员
      const u = localRegister(name, password, 'super_admin', '系统管理员');
      await pushUserToCloud(cfg, u);
      return u;
    }

    // ③ 云端有其他用户但没有这个用户名 → 尝试用本地缓存登录（旧数据迁移）
    const localAll = loadUsers();
    const localUser = localAll.find(u => u.username.toLowerCase() === name.toLowerCase());
    if (localUser && verifyPassword(localUser.username, password, localUser.passwordHash)) {
      await pushUserToCloud(cfg, localUser);  // 顺手迁移到云端
      return localUser;
    }

    // ④ 确实不存在
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
