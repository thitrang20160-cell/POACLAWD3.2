import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutDashboard, FileText, History, Settings, Sparkles, Save, Copy,
  CheckCircle, XCircle, BrainCircuit, UploadCloud, Library, Plus, Trash2,
  Upload, Loader2, Wand2, RefreshCw, Search, LogOut, User, Users, Edit2,
  UserPlus, KeyRound, Gavel, Send, Cloud, CloudLightning, Wifi, WifiOff,
  Crown, FileDown, Eye, EyeOff, TrendingUp, Clock, CheckSquare,
  XSquare, MessageSquare, BookMarked, Zap, Store, Server,
  ThumbsUp, ThumbsDown, ScanSearch
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

import {
  loadCases, saveCases, loadSettings, saveSettings, loadReferences, saveReferences,
  getCurrentSession, setCurrentSession,
  getAllUsers, updateUser, verifyPassword,
  loadStoreProfiles, addStoreProfile, deleteStoreProfile,
} from './services/storageService';
import {
  loginUserCloud, registerUserCloud, updateUserCloud, deleteUserCloud, updatePasswordCloud,
} from './services/authService';
import {
  generatePOAOutline, expandOutlineToPOA, generateCNExplanation,
  autoFixPOA, analyzeFailedCase, iterateStrategies, findTopReferences,
} from './services/geminiService';
import { CloudService } from './services/cloudService';
import { parseFile } from './services/fileService';
import { submitPOAToWalmart } from './services/walmartService';
import {
  CaseData, GlobalSettings, RiskAnalysis, ViolationType, POAOutline,
  ReferenceCase, User as UserType, UserRole, StoreProfile, CaseNote,
} from './types';
import { RiskBadge } from './components/RiskBadge';

// ── Constants ───────────────────────────────────────────────────────────
const TABS = { DASHBOARD: 'dashboard', GENERATOR: 'generator', HISTORY: 'history', LIBRARY: 'library', SETTINGS: 'settings' };

const STATUS_CFG: Record<CaseData['status'], { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: '待审核',   color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    icon: <Clock size={11}/> },
  reviewed: { label: '已审核',   color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       icon: <Eye size={11}/> },
  submitted:{ label: '已提交',   color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', icon: <Send size={11}/> },
  success:  { label: '申诉成功', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: <CheckSquare size={11}/> },
  fail:     { label: '申诉失败', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20',       icon: <XSquare size={11}/> },
};

// ── Helpers ─────────────────────────────────────────────────────────────
const strip = (t: string) => t
  .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
  .replace(/^#+\s/gm, '').replace(/`/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1');

const sim = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const sA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const sB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const inter = new Set([...sA].filter(x => sB.has(x)));
  return inter.size / new Set([...sA, ...sB]).size;
};

const computeRisk = (email: string, type: ViolationType): RiskAnalysis => {
  const t = (email || '').toLowerCase(); let s = 78; const r: string[] = [];
  if (t.includes('counterfeit') || t.includes('inauthentic')) { s -= 25; r.push('⚠ 高危：假货/正品性投诉 (-25)'); }
  if (t.includes('termination') || t.includes('final decision')) { s -= 35; r.push('🔴 极危：终止合作/最终决定 (-35)'); }
  if (t.includes('repeat') || t.includes('multiple violations')) { s -= 15; r.push('⚠ 重复违规 (-15)'); }
  if (type === 'IP') { s -= 10; r.push('⚠ 知识产权侵权 (-10)'); }
  if (type === 'Counterfeit') { s -= 20; r.push('🔴 假冒商品 (-20)'); }
  if (t.includes('30 day') || t.includes('14 day')) { s += 8; r.push('✅ 有明确暂停期限 (+8)'); }
  if (t.includes('first') || t.includes('first time')) { s += 10; r.push('✅ 首次违规 (+10)'); }
  s = Math.max(5, Math.min(96, s));
  const level = s > 65 ? 'Low' : s > 35 ? 'Medium' : 'High';
  const tone = level === 'High'
    ? 'TONE: Extremely contrite. Accept FULL responsibility. Maximum urgency.'
    : level === 'Medium'
    ? 'TONE: Professional and sincerely apologetic. Balance accountability with track record.'
    : 'TONE: Professional, confident, solution-focused. Genuine regret + strong compliance history.';
  return { score: s, level, reasons: r, toneInstruction: tone };
};

const dlTxt = (content: string, name: string) => {
  const blob = new Blob([strip(content)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: `POA_${name}_${new Date().toISOString().slice(0,10)}.txt` }).click();
  URL.revokeObjectURL(url);
};

const genId = () => Date.now().toString() + Math.random().toString(36).slice(2, 6);

// ── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [user, setUser] = useState<UserType | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Navigation
  const [tab, setTab] = useState(TABS.DASHBOARD);

  // Data
  const [cases, setCases] = useState<CaseData[]>([]);
  const [refs, setRefs] = useState<ReferenceCase[]>([]);
  const [storeProfiles, setStoreProfiles] = useState<StoreProfile[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    selectedProvider: 'gemini', apiKey: '', deepseekKey: '', supabaseUrl: '', supabaseKey: '',
    enableSimulationMode: true, strategyGeneral: '', strategyLogistics: '', strategyIP: ''
  });

  // Admin
  const [userList, setUserList] = useState<UserType[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '', role: 'client' as UserRole, companyName: '' });
  const [editUserForm, setEditUserForm] = useState({ role: 'client' as UserRole, companyName: '' });

  // Password
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new: '', confirm: '' });
  const [showPwd, setShowPwd] = useState({ old: false, new: false });

  // Review modal
  const [reviewCase, setReviewCase] = useState<CaseData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [noteRequiresAction, setNoteRequiresAction] = useState(false);

  // History
  const [hSearch, setHSearch] = useState('');
  const [hFilter, setHFilter] = useState<CaseData['status'] | 'all'>('all');
  const [analysingCaseId, setAnalysingCaseId] = useState<string | null>(null);

  // Generator form
  const [form, setForm] = useState<Partial<CaseData>>({
    storeName: '', companyName: '', caseId: '', productCategory: '',
    supplyChain: 'Private Label', violationType: 'Performance',
    suspensionEmail: '', sellerExplanation: '', actionsTaken: '',
    affectedCount: '', supplierInfo: '', isODRSuspension: false
  });
  const [selRefId, setSelRefId] = useState('');
  const [autoMatch, setAutoMatch] = useState(false);
  const [fileCnt, setFileCnt] = useState('');
  const [fileName, setFileName] = useState('');
  const [risk, setRisk] = useState<RiskAnalysis | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  // Two-phase generation
  const [genPhase, setGenPhase] = useState<'idle' | 'outline' | 'full'>('idle');
  const [editOutline, setEditOutline] = useState<POAOutline | null>(null);
  const [isGenOutline, setIsGenOutline] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [poa, setPoa] = useState('');
  const [cn, setCn] = useState('');

  // Auto-save after success modal
  const [autoSaveCand, setAutoSaveCand] = useState<CaseData | null>(null);
  const [autoSaveTitle, setAutoSaveTitle] = useState('');

  // Strategy iteration
  const [isIterating, setIsIterating] = useState(false);
  const [stratDraft, setStratDraft] = useState<{ performance: string; ip: string; general: string } | null>(null);

  // Library
  const [isAddingRef, setIsAddingRef] = useState(false);
  const [newRef, setNewRef] = useState<Partial<ReferenceCase>>({ title: '', type: 'Performance', content: '' });
  const [batchProg, setBatchProg] = useState<{ c: number; t: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const importRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = getCurrentSession(); if (s) setUser(s); setAuthLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    const s = loadSettings(); setSettings(s);
    setRefs(loadReferences());
    setStoreProfiles(loadStoreProfiles());
    if (s.supabaseUrl && s.supabaseKey) handleCloudSync(s);
    const all = loadCases();
    const adm = user.role === 'admin' || user.role === 'super_admin';
    setCases(adm ? all : all.filter(c => c.userId === user.id));
    if (adm) setUserList(getAllUsers());
    if (user.companyName) setForm(p => ({ ...p, companyName: user.companyName }));
  }, [user]);

  // Auto-match reference
  useEffect(() => {
    if (!autoMatch || !form.suspensionEmail || !form.violationType) return;
    const ms = refs.filter(r => r.type === form.violationType);
    if (!ms.length) { setSelRefId(''); return; }
    let best = '', max = -1;
    ms.forEach(r => { const sc = sim(form.suspensionEmail!, r.content); if (sc > max) { max = sc; best = r.id; } });
    if (best) setSelRefId(best);
  }, [autoMatch, form.suspensionEmail, form.violationType]);

  // ── Cloud ──────────────────────────────────────────────────────────────
  const handleCloudSync = async (cfg: GlobalSettings) => {
    if (!cfg.supabaseUrl) return;
    setIsSyncing(true);
    try {
      // 同步案例库
      const { data: refData, error: refErr } = await CloudService.getAllReferences(cfg);
      if (refData?.length) { setRefs(refData); saveReferences(refData); }
      else if (refErr) console.error('Sync refs:', refErr);

      // 同步案件历史
      const { data: caseData, error: caseErr } = await CloudService.getAllCases(cfg);
      if (caseData) {
        saveCases(caseData);
        const adm = user?.role === 'admin' || user?.role === 'super_admin';
        setCases(adm ? caseData : caseData.filter(c => c.userId === user?.id));
      } else if (caseErr) console.error('Sync cases:', caseErr);

      // 同步用户列表（仅管理员）
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        const { data: userData, error: userErr } = await CloudService.getAllUsers(cfg);
        if (userData?.length) {
          // 合并云端用户到本地（云端优先，但保留本地独有账号）
          userData.forEach(u => updateUser(u));
          setUserList(getAllUsers());
        } else if (userErr) console.error('Sync users:', userErr);
      }
    } finally { setIsSyncing(false); }
  };

  // ── 首次迁移：把本地数据全量推送到云端 ─────────────────────────────
  const handlePushToCloud = async () => {
    if (!settings.supabaseUrl) return alert('请先配置 Supabase');
    if (!window.confirm('将把本地所有案件、案例库、账号全量推送到云端，确认？')) return;
    setIsSyncing(true);
    try {
      const result = await CloudService.pushAllLocalData(
        settings,
        loadReferences(),
        loadCases(),
        getAllUsers()
      );
      alert(result.message);
    } finally { setIsSyncing(false); }
  };

  // ── Auth ──────────────────────────────────────────────────────────────
  const logout = () => { setCurrentSession(null); setUser(null); setCases([]); setRefs([]); setTab(TABS.DASHBOARD); };

  const handleChangePwd = async (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return;
    if (!verifyPassword(user.username, pwdForm.old, user.passwordHash)) return alert('旧密码错误');
    if (pwdForm.new.length < 4) return alert('新密码至少4位');
    if (pwdForm.new !== pwdForm.confirm) return alert('两次密码不一致');
    const u = await updatePasswordCloud(user.id, pwdForm.new);
    if (u) { setUser(u); setCurrentSession(u); }
    setPwdOpen(false); setPwdForm({ old: '', new: '', confirm: '' }); alert('密码修改成功！');
  };

  // ── User Management ───────────────────────────────────────────────────
  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await registerUserCloud(newUserForm.username, newUserForm.password, newUserForm.role, newUserForm.companyName);
      setUserList(getAllUsers()); setIsAddingUser(false);
      setNewUserForm({ username: '', password: '', role: 'client', companyName: '' });
      alert('账号创建成功！');
    } catch (err: any) { alert(err.message); }
  };

  const delUser = async (id: string) => {
    if (id === user?.id) return alert('无法删除自己');
    const t = userList.find(u => u.id === id); if (!t) return;
    if (user?.role === 'admin' && t.role !== 'client') return alert('权限不足');
    if (!window.confirm(`确定删除 [${t.username}]？`)) return;
    await deleteUserCloud(id); setUserList(getAllUsers());
  };

  const saveEditUser = async (id: string) => {
    const t = userList.find(u => u.id === id); if (!t) return;
    if (user?.role === 'admin' && editUserForm.role !== 'client') return alert('权限不足');
    const updated = { ...t, role: editUserForm.role, companyName: editUserForm.companyName };
    await updateUserCloud(updated);
    setUserList(getAllUsers()); setEditingUserId(null);
  };

  const resetPwd = async (u: UserType) => {
    if (user?.role === 'admin' && u.role !== 'client') return alert('权限不足');
    const np = prompt(`新密码 (${u.username}):`); if (!np || np.length < 4) return alert('密码至少4位');
    await updatePasswordCloud(u.id, np);
    alert('已重置');
  };

  // ── Stats ──────────────────────────────────────────────────────────────
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const stats = useMemo(() => {
    const ok = cases.filter(c => c.status === 'success').length;
    const fail = cases.filter(c => c.status === 'fail').length;
    const decided = ok + fail;
    return {
      total: cases.length, success: ok, fail, decided,
      pending: cases.filter(c => c.status === 'pending').length,
      submitted: cases.filter(c => c.status === 'submitted').length,
      reviewed: cases.filter(c => c.status === 'reviewed').length,
      rate: decided > 0 ? Math.round((ok / decided) * 100) : 0,
    };
  }, [cases]);

  const pieData = useMemo(() => [
    { name: '申诉成功', value: stats.success,   color: '#10b981' },
    { name: '申诉失败', value: stats.fail,      color: '#f43f5e' },
    { name: '已提交',   value: stats.submitted, color: '#6366f1' },
    { name: '待审核',   value: stats.pending,   color: '#f59e0b' },
    { name: '已审核',   value: stats.reviewed,  color: '#3b82f6' },
  ].filter(d => d.value > 0), [stats]);

  // ── Store Profiles ─────────────────────────────────────────────────────
  const applyProfile = (p: StoreProfile) => {
    setForm(prev => ({ ...prev, storeName: p.storeName, companyName: p.companyName, supplyChain: p.supplyChain, productCategory: p.productCategory || prev.productCategory, supplierInfo: p.supplierInfo || prev.supplierInfo }));
  };

  const saveCurrentProfile = () => {
    if (!form.storeName || !form.companyName) return alert('请先填写店铺名和公司名');
    const p: StoreProfile = { id: genId(), storeName: form.storeName!, companyName: form.companyName!, supplyChain: (form.supplyChain as SupplyChainType) || 'Private Label', productCategory: form.productCategory, supplierInfo: form.supplierInfo, createdAt: new Date().toISOString() };
    addStoreProfile(p); setStoreProfiles(loadStoreProfiles()); alert(`店铺档案「${p.storeName}」已保存！`);
  };

  // ── Generator: Two-Phase ──────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name);
    try { setFileCnt(await parseFile(file)); } catch (err) { alert('解析失败: ' + err); setFileName(''); }
  };

  const handleGenOutline = async () => {
    if (!settings.apiKey && !settings.deepseekKey) return alert('请先配置 API Key');
    const r = computeRisk(form.suspensionEmail || '', (form.violationType || 'Performance') as ViolationType);
    setRisk(r); setIsGenOutline(true);
    try {
      const similarCase = refs.find(r => r.id === selRefId);
      // 自动从案例库检索最相关的Top3案例（优先用手选的，否则自动匹配）
      const topRefs = selRefId
        ? undefined  // 手动指定了就用手选的单案例
        : findTopReferences(refs, form.violationType || 'Performance', form.suspensionEmail || '', 3);
      const o = await generatePOAOutline(form, settings, r, fileCnt, similarCase, topRefs);
      setEditOutline(JSON.parse(JSON.stringify(o)));
      setGenPhase('outline');
    } catch (e: any) { alert('大纲生成失败: ' + e.message); }
    finally { setIsGenOutline(false); }
  };

  const handleExpandPOA = async () => {
    if (!editOutline) return;
    const r = risk || computeRisk(form.suspensionEmail || '', (form.violationType || 'Performance') as ViolationType);
    setIsExpanding(true);
    try {
      const similarCase = refs.find(r => r.id === selRefId);
      const topRefs = selRefId
        ? undefined
        : findTopReferences(refs, form.violationType || 'Performance', form.suspensionEmail || '', 3);
      const full = await expandOutlineToPOA(editOutline, form, settings, r, fileCnt, similarCase, topRefs);
      setPoa(full);
      const cnRpt = await generateCNExplanation(full, form.suspensionEmail || '', settings);
      setCn(cnRpt); setGenPhase('full');
    } catch (e: any) { alert('POA 展开失败: ' + e.message); }
    finally { setIsExpanding(false); }
  };

  const handleAutoFix = async () => {
    if (!poa || !cn) return;
    setIsFixing(true);
    try { const fixed = await autoFixPOA(poa, cn, settings); setPoa(fixed); alert('已根据质检报告精修！'); }
    catch (e: any) { alert('精修失败: ' + e.message); }
    finally { setIsFixing(false); }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(strip(poa)); setCopyOk(true); setTimeout(() => setCopyOk(false), 2000);
  };

  const handleResetGen = () => { setGenPhase('idle'); setEditOutline(null); setPoa(''); setCn(''); setRisk(null); };

  const saveCase = async () => {
    if (!poa || !user) return;
    const nc: CaseData = { id: genId(), userId: user.id, clientName: user.username, createdAt: new Date().toISOString(), ...(form as any), poaContent: poa, cnExplanation: cn, status: 'pending', fileEvidenceSummary: fileName ? `Used: ${fileName}` : undefined, outlineSnapshot: editOutline ? JSON.stringify(editOutline) : undefined };
    const all = [nc, ...loadCases()]; saveCases(all); setCases([nc, ...cases]);
    if (settings.supabaseUrl) await CloudService.upsertCase(settings, nc);
    alert('已保存至历史库！');
  };

  // ── Case Status & Auto-Save ───────────────────────────────────────────
  const updateStatus = (id: string, status: CaseData['status']) => {
    const all = loadCases().map(c => c.id === id ? { ...c, status } : c);
    saveCases(all); setCases(cases.map(c => c.id === id ? { ...c, status } : c));
    const updated = all.find(c => c.id === id);
    if (updated && settings.supabaseUrl) CloudService.upsertCase(settings, updated);
    if (status === 'success') {
      const c = cases.find(c => c.id === id);
      if (c?.poaContent) {
        setAutoSaveCand(c);
        setAutoSaveTitle(`[成功] ${c.violationType} - ${c.storeName} ${new Date().toISOString().slice(0,10)}`);
      }
    }
  };

  const handleAutoSaveToLib = async () => {
    if (!autoSaveCand || !autoSaveTitle) return;
    const item: ReferenceCase = { id: genId(), title: autoSaveTitle, type: autoSaveCand.violationType, content: autoSaveCand.poaContent, tags: ['自动入库', '申诉成功'], successDate: new Date().toISOString().slice(0,10), autoSaved: true, sourceCaseId: autoSaveCand.id };
    const updated = [item, ...refs]; setRefs(updated); saveReferences(updated);
    if (settings.supabaseUrl) await CloudService.upsertReference(settings, item);
    setAutoSaveCand(null); alert('已自动保存至成功案例库！');
  };

  // ── Review Modal ──────────────────────────────────────────────────────
  const saveReview = () => {
    if (!reviewCase) return;
    const all = loadCases().map(c => c.id === reviewCase.id ? reviewCase : c);
    saveCases(all); setCases(all.filter(c => isAdmin || c.userId === user?.id));
    if (settings.supabaseUrl) CloudService.upsertCase(settings, reviewCase);
    alert('已保存！');
  };

  const addNote = () => {
    if (!reviewCase || !newNoteText.trim() || !user) return;
    const note: CaseNote = { id: genId(), authorId: user.id, authorName: user.username, content: newNoteText.trim(), createdAt: new Date().toISOString(), requiresAction: noteRequiresAction, resolved: false };
    const updated = { ...reviewCase, adminNotes: [...(reviewCase.adminNotes || []), note] };
    setReviewCase(updated);
    const all = loadCases().map(c => c.id === updated.id ? updated : c);
    saveCases(all); setCases(all.filter(c => isAdmin || c.userId === user?.id));
    if (settings.supabaseUrl) CloudService.upsertCase(settings, updated);
    setNewNoteText(''); setNoteRequiresAction(false);
  };

  const toggleNoteResolved = (noteId: string) => {
    if (!reviewCase) return;
    const updated = { ...reviewCase, adminNotes: (reviewCase.adminNotes || []).map(n => n.id === noteId ? { ...n, resolved: !n.resolved } : n) };
    setReviewCase(updated);
    const all = loadCases().map(c => c.id === updated.id ? updated : c);
    saveCases(all); setCases(all.filter(c => isAdmin || c.userId === user?.id));
    if (settings.supabaseUrl) CloudService.upsertCase(settings, updated);
  };

  const handleSubmitWalmart = async () => {
    if (!reviewCase) return; setIsSubmitting(true);
    try {
      const r = await submitPOAToWalmart(reviewCase, settings);
      if (r.success) {
        const uc: CaseData = { ...reviewCase, status: 'submitted', submissionTime: new Date().toISOString(), walmartCaseNumber: r.caseNumber };
        const all = loadCases().map(c => c.id === reviewCase.id ? uc : c);
        saveCases(all); setCases(all.filter(c => isAdmin || c.userId === user?.id));
        if (settings.supabaseUrl) await CloudService.upsertCase(settings, uc);
        alert(`提交成功！Case: ${r.caseNumber}`); setReviewCase(null);
      } else alert('提交失败: ' + r.message);
    } catch (e: any) { alert('错误: ' + e.message); } finally { setIsSubmitting(false); }
  };

  // ── Failure Analysis ──────────────────────────────────────────────────
  const handleAnalyseFailure = async (caseId: string) => {
    const c = cases.find(x => x.id === caseId); if (!c) return;
    if (!window.confirm('调用 AI 分析此失败案件的原因？（消耗少量 API 额度）')) return;
    setAnalysingCaseId(caseId);
    try {
      const analysis = await analyzeFailedCase(c, settings);
      const updated = { ...c, failureAnalysis: analysis };
      const all = loadCases().map(x => x.id === caseId ? updated : x);
      saveCases(all); setCases(all.filter(x => isAdmin || x.userId === user?.id));
      if (settings.supabaseUrl) await CloudService.upsertCase(settings, updated);
      if (reviewCase?.id === caseId) setReviewCase(updated);
      alert('分析完成，已保存至案件详情。');
    } catch (e: any) { alert('分析失败: ' + e.message); } finally { setAnalysingCaseId(null); }
  };

  // ── Strategy Iteration ────────────────────────────────────────────────
  const handleIterateStrategy = async () => {
    const okCases = cases.filter(c => c.status === 'success' && c.poaContent);
    if (okCases.length < 2) return alert('至少需要 2 个已标记为「申诉成功」的案件才能进行策略迭代。');
    if (!window.confirm(`将基于 ${okCases.length} 个成功案件 + ${refs.length} 个案例库文件自动优化三套申诉策略，确认继续？`)) return;
    setIsIterating(true);
    try {
      const draft = await iterateStrategies(okCases, { performance: settings.strategyLogistics, ip: settings.strategyIP, general: settings.strategyGeneral }, settings, refs);
      setStratDraft(draft);
    } catch (e: any) { alert('策略迭代失败: ' + e.message); } finally { setIsIterating(false); }
  };

  const applyStratDraft = () => {
    if (!stratDraft) return;
    const ns = { ...settings, strategyLogistics: stratDraft.performance, strategyIP: stratDraft.ip, strategyGeneral: stratDraft.general };
    setSettings(ns); saveSettings(ns); setStratDraft(null); alert('策略已更新！');
  };

  // ── Library ───────────────────────────────────────────────────────────
  const batchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    setBatchProg({ c: 0, t: files.length }); const newR: ReferenceCase[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const text = await parseFile(files[i]); const ln = files[i].name.toLowerCase();
        let type: ViolationType = 'Performance';
        if (ln.includes('ip') || ln.includes('copyright')) type = 'IP';
        else if (ln.includes('counterfeit') || ln.includes('fake')) type = 'Counterfeit';
        const r: ReferenceCase = { id: genId(), title: files[i].name.replace(/\.[^/.]+$/, ''), type, content: text, tags: ['批量导入'], successDate: new Date().toISOString().slice(0,10) };
        newR.push(r); if (settings.supabaseUrl) await CloudService.upsertReference(settings, r);
      } catch {}
      setBatchProg({ c: i + 1, t: files.length }); await new Promise(r => setTimeout(r, 10));
    }
    if (newR.length) { const u = [...refs, ...newR]; setRefs(u); saveReferences(u); alert(`导入 ${newR.length} 个`); }
    setBatchProg(null); if (batchRef.current) batchRef.current.value = '';
  };

  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const j = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(j)) return alert('需要 JSON 数组格式');
        const existing = new Set(refs.map(r => r.id));
        const novel = j.filter((r: any) => !existing.has(r.id));
        const merged = [...refs, ...novel]; setRefs(merged); saveReferences(merged);
        if (settings.supabaseUrl) for (const r of novel) await CloudService.upsertReference(settings, r);
        alert(`新增 ${novel.length} 条`);
      } catch (err) { alert('导入错误: ' + err); }
      finally { setIsImporting(false); if (importRef.current) importRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  const saveRef = async () => {
    if (!newRef.title || !newRef.content) return alert('标题和内容不能为空');
    const item: ReferenceCase = { id: genId(), title: newRef.title!, type: newRef.type as ViolationType, content: newRef.content!, tags: [], successDate: new Date().toISOString().slice(0,10) };
    const u = [...refs, item]; setRefs(u); saveReferences(u);
    if (settings.supabaseUrl) await CloudService.upsertReference(settings, item);
    setIsAddingRef(false); setNewRef({ title: '', type: 'Performance', content: '' });
  };

  const delRef = async (id: string) => {
    if (!window.confirm('确定删除？')) return;
    const u = refs.filter(r => r.id !== id); setRefs(u); saveReferences(u);
    if (settings.supabaseUrl) await CloudService.deleteReference(settings, id);
  };

  const exportRefsJSON = () => {
    const blob = new Blob([JSON.stringify(refs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `refs_${new Date().toISOString().slice(0,10)}.json` }).click();
    URL.revokeObjectURL(url);
  };

  // ── Filtered history ───────────────────────────────────────────────────
  const filteredCases = useMemo(() => cases.filter(c => {
    const ms = !hSearch || [c.storeName, c.caseId, c.companyName, c.clientName].some(f => f?.toLowerCase().includes(hSearch.toLowerCase()));
    const mf = hFilter === 'all' || c.status === hFilter;
    return ms && mf;
  }), [cases, hSearch, hFilter]);

  // ── Guards ────────────────────────────────────────────────────────────
  if (!user && !authLoading) return <Login onLogin={u => { setUser(u); setCurrentSession(u); }} />;
  if (authLoading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="w-8 h-8 text-blue-400 animate-spin"/></div>;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex text-sm">

      {/* ── Global Overlay ── */}
      {(isImporting || batchProg || isSyncing) && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          {isSyncing ? <CloudLightning className="w-12 h-12 text-emerald-400 animate-pulse mb-4"/> : <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4"/>}
          <div className="text-lg font-bold text-slate-200">{isSyncing ? '同步云端...' : batchProg ? `解析文档 (${batchProg.c}/${batchProg.t})` : '处理中...'}</div>
          {batchProg && <div className="mt-4 w-64 bg-slate-800 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${(batchProg.c/batchProg.t)*100}%` }}/></div>}
        </div>
      )}

      {/* ── Auto-Save Success Modal ── */}
      {autoSaveCand && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-500/20 p-2 rounded-xl"><BookMarked size={20} className="text-emerald-400"/></div>
              <div>
                <h3 className="font-bold text-slate-200">🎉 申诉成功！存入案例库？</h3>
                <p className="text-xs text-slate-500 mt-0.5">此 POA 已标记成功，建议保存供后续参考</p>
              </div>
            </div>
            <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs mb-4 outline-none focus:border-emerald-500/40" placeholder="案例标题" value={autoSaveTitle} onChange={e => setAutoSaveTitle(e.target.value)}/>
            <div className="flex gap-3">
              <button onClick={() => setAutoSaveCand(null)} className="flex-1 border border-slate-700 text-slate-400 py-2 rounded-lg text-xs font-bold hover:border-slate-600 transition-colors">跳过</button>
              <button onClick={handleAutoSaveToLib} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5"><BookMarked size={13}/> 保存入库</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ── */}
      {pwdOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-96 shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><KeyRound size={18}/> 修改密码</h3>
              <button onClick={() => setPwdOpen(false)} className="text-slate-500 hover:text-white"><XCircle size={20}/></button>
            </div>
            <form onSubmit={handleChangePwd} className="space-y-3">
              {[{ k: 'old' as const, ph: '当前密码', s: showPwd.old, toggle: () => setShowPwd(p=>({...p,old:!p.old})) }, { k: 'new' as const, ph: '新密码 (≥4位)', s: showPwd.new, toggle: () => setShowPwd(p=>({...p,new:!p.new})) }].map(({k,ph,s,toggle}) => (
                <div key={k} className="relative">
                  <input type={s?'text':'password'} required placeholder={ph} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 pr-10 outline-none focus:border-blue-500/40 transition-colors" value={pwdForm[k]} onChange={e => setPwdForm(p=>({...p,[k]:e.target.value}))}/>
                  <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{s?<EyeOff size={15}/>:<Eye size={15}/>}</button>
                </div>
              ))}
              <input type="password" required placeholder="确认新密码" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 outline-none focus:border-blue-500/40 transition-colors" value={pwdForm.confirm} onChange={e => setPwdForm(p=>({...p,confirm:e.target.value}))}/>
              {pwdForm.new && pwdForm.confirm && pwdForm.new !== pwdForm.confirm && <p className="text-[11px] text-rose-400">两次密码不一致</p>}
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg text-sm transition-colors">确认修改</button>
            </form>
          </div>
        </div>
      )}

      {/* ── Review Modal ── */}
      {reviewCase && (
        <div className="fixed inset-0 bg-slate-950/92 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500/20 p-2 rounded-lg text-indigo-400"><Gavel size={18}/></div>
                <div>
                  <div className="font-bold text-slate-200">{reviewCase.storeName} <span className="text-slate-500 font-normal text-xs">· {reviewCase.companyName}</span></div>
                  <div className="text-[11px] text-slate-600">{reviewCase.violationType} · {reviewCase.caseId || '无 Case ID'} · {new Date(reviewCase.createdAt).toLocaleString('zh-CN')}</div>
                </div>
              </div>
              <button onClick={() => setReviewCase(null)} className="text-slate-500 hover:text-white"><XCircle size={22}/></button>
            </div>

            <div className="flex-1 overflow-hidden flex">
              {/* Left: context + notes */}
              <div className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/50 flex-shrink-0">
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Email */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">违规邮件</div>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 h-32 overflow-y-auto font-mono whitespace-pre-wrap">{reviewCase.suspensionEmail || '无'}</div>
                  </div>
                  {/* Status */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">状态</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['pending','reviewed','submitted','success','fail'] as CaseData['status'][]).map(s => (
                        <button key={s} onClick={() => { setReviewCase({...reviewCase, status: s}); if (s==='success'||s==='fail') updateStatus(reviewCase.id, s); }}
                          className={`px-2 py-1 rounded border text-[10px] font-bold transition-all ${reviewCase.status===s ? STATUS_CFG[s].color : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-600'}`}>
                          {STATUS_CFG[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* CN Report */}
                  {reviewCase.cnExplanation && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">质检报告</div>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 max-h-36 overflow-y-auto whitespace-pre-wrap">{reviewCase.cnExplanation}</div>
                    </div>
                  )}
                  {/* Failure Analysis */}
                  {reviewCase.failureAnalysis && (
                    <div>
                      <div className="text-[10px] font-bold text-rose-500 uppercase mb-1.5">🔍 失败原因分析</div>
                      <div className="bg-rose-950/20 border border-rose-500/20 rounded-lg p-2.5 text-[11px] text-slate-400 max-h-48 overflow-y-auto whitespace-pre-wrap">{reviewCase.failureAnalysis}</div>
                    </div>
                  )}
                  {reviewCase.status === 'fail' && !reviewCase.failureAnalysis && (
                    <button onClick={() => handleAnalyseFailure(reviewCase.id)} disabled={!!analysingCaseId} className="w-full flex items-center justify-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-2 rounded-lg text-xs font-bold transition-colors">
                      {analysingCaseId === reviewCase.id ? <Loader2 size={13} className="animate-spin"/> : <ScanSearch size={13}/>} AI 分析失败原因
                    </button>
                  )}
                </div>

                {/* Admin Notes Section */}
                <div className="border-t border-slate-800 flex-shrink-0">
                  <div className="px-4 pt-3 pb-1">
                    <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-2"><MessageSquare size={11}/> 内部批注 ({(reviewCase.adminNotes||[]).length})</div>
                    <div className="space-y-2 max-h-36 overflow-y-auto">
                      {(reviewCase.adminNotes || []).length === 0 && <div className="text-[11px] text-slate-700">暂无批注</div>}
                      {(reviewCase.adminNotes || []).map(n => (
                        <div key={n.id} className={`rounded-lg p-2 border text-[11px] ${n.resolved ? 'opacity-50' : n.requiresAction ? 'bg-amber-500/8 border-amber-500/20' : 'bg-slate-950 border-slate-800'}`}>
                          <div className="flex justify-between items-start mb-0.5">
                            <span className={`font-bold ${n.requiresAction && !n.resolved ? 'text-amber-400' : 'text-slate-400'}`}>{n.authorName}</span>
                            <div className="flex items-center gap-1">
                              {n.requiresAction && !n.resolved && <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded">需跟进</span>}
                              <button onClick={() => toggleNoteResolved(n.id)} className={`${n.resolved ? 'text-emerald-500' : 'text-slate-600 hover:text-emerald-500'}`} title={n.resolved?'标记未完成':'标记已完成'}><CheckCircle size={11}/></button>
                            </div>
                          </div>
                          <div className="text-slate-400 leading-snug">{n.content}</div>
                          <div className="text-slate-700 text-[9px] mt-0.5">{new Date(n.createdAt).toLocaleString('zh-CN')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="px-4 pb-3 pt-2 space-y-1.5">
                      <textarea rows={2} placeholder="添加批注..." className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 text-[11px] outline-none resize-none focus:border-blue-500/30" value={newNoteText} onChange={e => setNewNoteText(e.target.value)}/>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer"><input type="checkbox" className="accent-amber-500" checked={noteRequiresAction} onChange={e => setNoteRequiresAction(e.target.checked)}/> 需要跟进</label>
                        <button onClick={addNote} disabled={!newNoteText.trim()} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1 rounded-lg text-[11px] font-bold transition-colors">添加</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: POA editor */}
              <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                <textarea className="flex-1 w-full p-5 bg-transparent text-slate-300 font-mono text-xs leading-relaxed outline-none resize-none focus:bg-slate-900/30 transition-colors" value={reviewCase.poaContent} onChange={e => setReviewCase({...reviewCase, poaContent: e.target.value})}/>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-900 rounded-b-2xl flex justify-between items-center flex-shrink-0">
              <div className="flex gap-2">
                <button onClick={saveReview} className="px-3 py-2 border border-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center gap-1.5 hover:border-slate-600 transition-colors"><Save size={13}/> 保存</button>
                <button onClick={() => dlTxt(reviewCase.poaContent, reviewCase.storeName)} className="px-3 py-2 border border-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center gap-1.5 hover:border-slate-600 transition-colors"><FileDown size={13}/> TXT</button>
              </div>
              <button onClick={handleSubmitWalmart} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                {isSubmitting ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>} 提交 Walmart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className="w-60 bg-slate-900/95 backdrop-blur-xl border-r border-slate-800 flex flex-col fixed h-full z-10">
        <div className="p-5 border-b border-slate-800">
          <h1 className="text-base font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">泽远跨境 POA Pro</h1>
          <div className="mt-1 text-[10px] text-slate-500 flex justify-between items-center">
            <span>V7 智能版</span>
            <span className={`uppercase font-bold px-1.5 py-0.5 rounded text-[10px] ${user?.role==='super_admin'?'text-fuchsia-400 bg-fuchsia-500/10':user?.role==='admin'?'text-indigo-400 bg-indigo-500/10':'text-slate-400 bg-slate-800'}`}>{user?.role?.replace('_',' ')}</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: TABS.DASHBOARD, label: '仪表盘',      icon: LayoutDashboard, admin: false },
            { id: TABS.GENERATOR, label: 'POA 生成',    icon: FileText,        admin: false },
            { id: TABS.HISTORY,   label: '案件历史',    icon: History,         admin: false },
            { id: TABS.LIBRARY,   label: '成功案例库',  icon: Library,         admin: true  },
            { id: TABS.SETTINGS,  label: '设置与管理',  icon: Settings,        admin: true  },
          ].filter(i => !i.admin || isAdmin).map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${tab===item.id ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
              <item.icon size={16}/> <span className="font-medium text-sm">{item.label}</span>
              {item.id === TABS.HISTORY && cases.filter(c=>c.status==='pending'&&(isAdmin||c.userId===user?.id)).length>0 && (
                <span className="ml-auto bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{cases.filter(c=>c.status==='pending'&&(isAdmin||c.userId===user?.id)).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 space-y-0.5">
          <div className="text-[11px] text-slate-600 px-3 pb-1">{user?.username}{user?.companyName&&<span className="text-slate-700"> · {user.companyName}</span>}</div>
          <button onClick={() => setPwdOpen(true)} className="w-full flex items-center gap-2 text-xs text-slate-500 px-3 py-1.5 hover:bg-slate-800/50 rounded-lg transition-colors"><KeyRound size={12}/> 修改密码</button>
          <button onClick={logout} className="w-full flex items-center gap-2 text-xs text-rose-500 px-3 py-1.5 hover:bg-rose-500/10 rounded-lg transition-colors"><LogOut size={12}/> 退出</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 ml-60 p-6 overflow-y-auto min-h-screen bg-slate-950">

        {/* ════ DASHBOARD ════ */}
        {tab === TABS.DASHBOARD && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-200">仪表盘</h2>
              <span className="text-xs text-slate-600">{new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { l: '总案件', v: stats.total,    c: 'text-blue-400',    bg: 'bg-blue-500/10',    icon: <FileText size={18}/> },
                { l: '成功率', v: `${stats.rate}%`,c: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <TrendingUp size={18}/> },
                { l: '待审核', v: stats.pending,  c: 'text-amber-400',   bg: 'bg-amber-500/10',   icon: <Clock size={18}/> },
                { l: '案例库', v: refs.length,    c: 'text-purple-400',  bg: 'bg-purple-500/10',  icon: <Library size={18}/> },
              ].map((s,i) => (
                <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                  <div className={`${s.bg} ${s.c} w-9 h-9 rounded-xl flex items-center justify-center mb-3`}>{s.icon}</div>
                  <div className="text-slate-500 text-xs mb-1">{s.l}</div>
                  <div className={`text-3xl font-bold ${s.c}`}>{s.v}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-5">
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-slate-300 mb-3">案件分布</h3>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                      {pieData.map((e,i) => <Cell key={i} fill={e.color}/>)}
                    </Pie>
                    <RechartsTooltip contentStyle={{background:'#0f172a',border:'1px solid #1e293b',borderRadius:'8px',color:'#94a3b8'}}/>
                    <Legend iconSize={9} iconType="circle" wrapperStyle={{fontSize:'11px',color:'#64748b'}}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-44 flex items-center justify-center text-slate-700 text-sm">暂无数据</div>}
              </div>

              <div className="col-span-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-slate-300">最近案件</h3>
                  <button onClick={() => setTab(TABS.HISTORY)} className="text-[11px] text-blue-400 hover:underline">全部 →</button>
                </div>
                {cases.length === 0
                  ? <div className="flex flex-col items-center justify-center h-36 text-slate-700"><FileText size={28} className="mb-2 opacity-30"/><span className="text-sm">暂无案件</span><button onClick={()=>setTab(TABS.GENERATOR)} className="mt-2 text-xs text-blue-400 hover:underline">去生成第一份 POA →</button></div>
                  : <div className="space-y-2">{cases.slice(0,5).map(c => (
                    <div key={c.id} onClick={() => setReviewCase(c)} className="flex items-center gap-3 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/50 hover:border-slate-700 cursor-pointer transition-all">
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_CFG[c.status].color}`}>{STATUS_CFG[c.status].icon} {STATUS_CFG[c.status].label}</span>
                      <div className="flex-1 min-w-0"><div className="text-slate-300 text-xs font-medium truncate">{c.storeName||'未命名'}</div><div className="text-slate-600 text-[10px]">{c.violationType} · {c.companyName}</div></div>
                      {(c.adminNotes||[]).filter(n=>n.requiresAction&&!n.resolved).length>0 && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">待跟进</span>}
                      <div className="text-[10px] text-slate-600">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</div>
                    </div>
                  ))}</div>}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex items-center gap-4">
              <div className={`p-2.5 rounded-xl ${settings.supabaseUrl?'bg-emerald-500/20 text-emerald-400':'bg-slate-800 text-slate-500'}`}>{settings.supabaseUrl?<CloudLightning size={20}/>:<Cloud size={20}/>}</div>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-200">{settings.supabaseUrl?'已连接 Supabase 云端':'离线模式'}</div>
                <p className="text-xs text-slate-500">{settings.supabaseUrl?'案例库自动同步':'数据仅存储在当前浏览器，配置 Supabase 可跨设备共享'}</p>
              </div>
              {settings.supabaseUrl && <button onClick={()=>handleCloudSync(settings)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors"><RefreshCw size={12} className={isSyncing?'animate-spin':''}/> 同步</button>}
            </div>
          </div>
        )}

        {/* ════ GENERATOR ════ */}
        {tab === TABS.GENERATOR && (
          <div className="max-w-7xl mx-auto grid grid-cols-12 gap-5 h-[calc(100vh-4rem)]">

            {/* Left */}
            <div className="col-span-5 flex flex-col gap-4 overflow-y-auto pr-1 pb-8">

              {/* Store Profile Quick-fill */}
              {storeProfiles.length > 0 && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5"><Store size={13}/> 快速填入店铺档案</span>
                    <button onClick={saveCurrentProfile} className="text-[11px] text-blue-400 hover:underline flex items-center gap-1"><Save size={11}/> 保存当前</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {storeProfiles.map(p => (
                      <div key={p.id} className="group flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors" onClick={() => applyProfile(p)}>
                        <span className="text-xs text-slate-300 font-medium">{p.storeName}</span>
                        <button onClick={e => { e.stopPropagation(); deleteStoreProfile(p.id); setStoreProfiles(loadStoreProfiles()); }} className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 ml-1 transition-all"><XCircle size={12}/></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 1: Diagnosis */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <h3 className="text-slate-200 font-bold flex items-center gap-2"><div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</div> 案情诊断</h3>
                <div className="flex justify-between items-center text-[10px] bg-slate-800/60 text-slate-400 p-2.5 rounded-lg">
                  <span>AI 引擎: <span className="text-emerald-400 font-bold uppercase">{settings.selectedProvider}</span></span>
                  {isAdmin && <button onClick={() => setTab(TABS.SETTINGS)} className="text-blue-400 hover:underline">切换</button>}
                </div>
                <div>
                  <label className="text-slate-500 text-[11px] mb-1.5 block">Walmart 违规通知邮件 *</label>
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-24 text-xs leading-relaxed outline-none resize-none focus:border-blue-500/40 transition-colors" placeholder="粘贴 Walmart 违规/暂停邮件原文..." value={form.suspensionEmail} onChange={e => setForm(p=>({...p,suspensionEmail:e.target.value}))} onBlur={() => { if (form.suspensionEmail) setRisk(computeRisk(form.suspensionEmail, (form.violationType||'Performance') as ViolationType)); }}/>
                </div>
                {risk && <RiskBadge analysis={risk}/>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">违规类型</label>
                    <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={form.violationType} onChange={e => setForm(p=>({...p,violationType:e.target.value as ViolationType, isODRSuspension:e.target.value!=='Performance'?false:p.isODRSuspension}))}>
                      <option value="Performance">Performance</option><option value="IP">IP</option><option value="Counterfeit">Counterfeit</option><option value="Related">Related</option><option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">供应链</label>
                    <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={form.supplyChain} onChange={e => setForm(p=>({...p,supplyChain:e.target.value as any}))}>
                      <option value="Private Label">Private Label</option><option value="Authorized Distributor">Authorized Distributor</option><option value="Wholesale">Wholesale</option><option value="Dropshipping">Dropshipping</option>
                    </select>
                  </div>
                </div>
                {form.violationType==='Performance' && (
                  <div className={`p-3 rounded-xl border transition-all ${form.isODRSuspension?'bg-amber-500/8 border-amber-500/30':'bg-slate-950 border-slate-800'}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => setForm(p=>({...p,isODRSuspension:!p.isODRSuspension}))} className={`mt-0.5 w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${form.isODRSuspension?'bg-amber-500':'bg-slate-700'}`}><div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${form.isODRSuspension?'left-5':'left-1'}`}/></button>
                      <div><div className={`text-xs font-bold ${form.isODRSuspension?'text-amber-400':'text-slate-400'}`}>ODR 自发货申诉模式</div><div className="text-[10px] text-slate-500 mt-0.5">启用后每段严格 700-950 字符，符合 Walmart 限制</div></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Info */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-slate-200 font-bold flex items-center gap-2"><div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">2</div> 案件信息</h3>
                  {storeProfiles.length === 0 && form.storeName && form.companyName && (
                    <button onClick={saveCurrentProfile} className="text-[11px] text-blue-400 hover:underline flex items-center gap-1"><Save size={11}/> 保存为档案</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { k: 'companyName',    ph: '公司名称 (Legal Name)' },
                    { k: 'storeName',      ph: '店铺名称 (Store Name)' },
                    { k: 'caseId',         ph: 'Case/Ticket ID' },
                    { k: 'affectedCount',  ph: '受影响数量 (14 SKUs)' },
                    { k: 'productCategory',ph: '产品类目 (e.g. Electronics)' },
                    { k: 'supplierInfo',   ph: '供应商信息 (可选，供 AI 参考)' },
                  ].map(({k, ph}) => (
                    <input key={k} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors" placeholder={ph} value={(form as any)[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))}/>
                  ))}
                </div>
                <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-16 text-xs outline-none resize-none focus:border-blue-500/40 transition-colors" placeholder="根本原因简述（中文，供 AI 参考）..." value={form.sellerExplanation||''} onChange={e => setForm(p=>({...p,sellerExplanation:e.target.value}))}/>
                <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-14 text-xs outline-none resize-none focus:border-blue-500/40 transition-colors" placeholder="已采取的应急措施（可选）..." value={form.actionsTaken||''} onChange={e => setForm(p=>({...p,actionsTaken:e.target.value}))}/>
              </div>

              {/* Section 3: Evidence */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
                <h3 className="text-slate-200 font-bold flex items-center gap-2 text-sm"><div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">3</div> 证据注入</h3>
                <label className="relative flex items-center gap-3 border-2 border-dashed border-slate-700 rounded-xl p-3.5 cursor-pointer hover:border-slate-600 transition-all group">
                  <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" accept=".xlsx,.xls,.csv,.txt,.docx"/>
                  <UploadCloud size={18} className="text-slate-500 flex-shrink-0"/>
                  <div><div className="text-xs text-slate-400">{fileName||'拖入或点击上传 Excel/CSV/TXT/DOCX'}</div><div className="text-[10px] text-slate-600">AI 将自动提取订单号和追踪号</div></div>
                  {fileName && <CheckCircle size={15} className="text-emerald-400 ml-auto flex-shrink-0"/>}
                </label>
              </div>

              {/* Section 4: Reference */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-slate-200 font-bold flex items-center gap-2 text-sm"><div className="w-6 h-6 rounded-lg bg-purple-600 text-white flex items-center justify-center text-xs font-bold">4</div> 参考案例</h3>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer"><input type="checkbox" className="accent-purple-500" checked={autoMatch} onChange={e => setAutoMatch(e.target.checked)}/> 智能匹配</label>
                </div>
                <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={selRefId} onChange={e => setSelRefId(e.target.value)}>
                  <option value="">— 自动从案例库智能匹配 Top3 —</option>
                  {refs.filter(r=>r.type===form.violationType).map(r => <option key={r.id} value={r.id}>{r.autoSaved?'✓ ':''}{r.title}</option>)}
                  {refs.filter(r=>r.type!==form.violationType).length>0&&<optgroup label="— 其他类型 —">{refs.filter(r=>r.type!==form.violationType).map(r=><option key={r.id} value={r.id}>[{r.type}] {r.title}</option>)}</optgroup>}
                </select>
                {selRefId
                  ? <div className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle size={10}/> 手动指定：将参考此案例前 3000 字的论证结构</div>
                  : refs.length > 0
                    ? (() => {
                        const top = findTopReferences(refs, form.violationType || 'Performance', form.suspensionEmail || '', 3);
                        return top.length > 0
                          ? <div className="text-[10px] text-purple-400 space-y-0.5">
                              <div className="flex items-center gap-1"><CheckCircle size={10}/> 将自动匹配以下 {top.length} 个最相关案例注入生成：</div>
                              {top.map((r,i) => <div key={r.id} className="pl-3 text-slate-500">#{i+1} {r.title.substring(0,40)}</div>)}
                            </div>
                          : <div className="text-[10px] text-slate-600">案例库暂无此类型案例，将无参考</div>;
                      })()
                    : <div className="text-[10px] text-slate-600">案例库为空，请先在「成功案例库」页上传</div>
                }
              </div>

              {/* Generate Buttons */}
              <div className="space-y-2">
                {genPhase === 'idle' && (
                  <>
                    <button onClick={handleGenOutline} disabled={isGenOutline}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex justify-center items-center gap-3 transition-all shadow-lg text-base">
                      {isGenOutline ? <><Loader2 size={20} className="animate-spin"/> 生成大纲中...</> : <><BrainCircuit size={20}/> 第一步：生成大纲（推荐）</>}
                    </button>
                    <div className="text-center text-[11px] text-slate-600">大纲确认后可微调策略再展开，通过率更高</div>
                  </>
                )}
                {genPhase === 'outline' && (
                  <div className="space-y-2">
                    <button onClick={handleExpandPOA} disabled={isExpanding}
                      className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex justify-center items-center gap-3 transition-all shadow-lg text-base">
                      {isExpanding ? <><Loader2 size={20} className="animate-spin"/> 展开 POA 中...</> : <><Sparkles size={20}/> 第二步：确认大纲，生成完整 POA</>}
                    </button>
                    <button onClick={handleResetGen} className="w-full border border-slate-700 text-slate-400 py-2 rounded-xl text-xs hover:border-slate-600 transition-colors">↩ 重新开始</button>
                  </div>
                )}
                {genPhase === 'full' && (
                  <button onClick={handleResetGen} className="w-full border border-slate-700 text-slate-400 py-2 rounded-xl text-xs hover:border-slate-600 transition-colors">↩ 重新生成</button>
                )}
              </div>
            </div>

            {/* Right */}
            <div className="col-span-7 flex flex-col gap-4 pb-8">

              {/* Outline Editor */}
              {genPhase === 'outline' && editOutline && (
                <div className="flex-1 bg-slate-900/60 border border-blue-500/30 rounded-2xl overflow-hidden flex flex-col">
                  <div className="bg-slate-950 border-b border-slate-800 p-3 flex items-center gap-2 flex-shrink-0">
                    <div className="bg-blue-500/20 p-1.5 rounded-lg"><BrainCircuit size={15} className="text-blue-400"/></div>
                    <div>
                      <span className="text-xs font-bold text-slate-300">大纲预览 · 可直接编辑各节点</span>
                      <div className="text-[10px] text-slate-600 mt-0.5">策略: {editOutline.overallStrategy}</div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {editOutline.sections.map((sec, si) => (
                      <div key={sec.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">{si+1}</span>
                          <input className="flex-1 bg-transparent text-slate-200 text-sm font-bold outline-none focus:text-blue-300 transition-colors" value={sec.title} onChange={e => { const ns = {...editOutline, sections: editOutline.sections.map((s,i)=>i===si?{...s,title:e.target.value}:s)}; setEditOutline(ns); }}/>
                        </div>
                        <div className="space-y-1.5">
                          {sec.keyPoints.map((kp, ki) => (
                            <div key={ki} className="flex items-start gap-2">
                              <span className="text-slate-600 text-xs mt-2.5">•</span>
                              <textarea rows={2} className="flex-1 bg-slate-900/60 border border-slate-800/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none resize-none focus:border-blue-500/30 focus:text-slate-300 transition-colors leading-relaxed" value={kp} onChange={e => { const ns = {...editOutline, sections: editOutline.sections.map((s,i)=>i===si?{...s,keyPoints:s.keyPoints.map((k,j)=>j===ki?e.target.value:k)}:s)}; setEditOutline(ns); }}/>
                              <button onClick={() => { const ns = {...editOutline, sections: editOutline.sections.map((s,i)=>i===si?{...s,keyPoints:s.keyPoints.filter((_,j)=>j!==ki)}:s)}; setEditOutline(ns); }} className="text-slate-700 hover:text-rose-400 mt-2 transition-colors"><XCircle size={13}/></button>
                            </div>
                          ))}
                          <button onClick={() => { const ns = {...editOutline, sections: editOutline.sections.map((s,i)=>i===si?{...s,keyPoints:[...s.keyPoints,'']}:s)}; setEditOutline(ns); }} className="text-[10px] text-slate-600 hover:text-blue-400 flex items-center gap-1 transition-colors"><Plus size={11}/> 添加要点</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* POA Output */}
              {(genPhase === 'full' || genPhase === 'idle') && (
                <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                  <div className="bg-slate-950 border-b border-slate-800 p-3 flex justify-between items-center flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">POA 完整内容</span>
                      {form.isODRSuspension && <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">ODR 限字</span>}
                      {poa && <span className="text-[10px] text-slate-600">{poa.length} 字符</span>}
                    </div>
                    {poa && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => dlTxt(poa, form.storeName||'')} className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded hover:bg-slate-800 transition-colors flex items-center gap-1"><FileDown size={13}/> TXT</button>
                        <button onClick={handleCopy} className={`text-[11px] px-2 py-1.5 rounded transition-colors flex items-center gap-1 ${copyOk?'text-emerald-400 bg-emerald-500/10':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>{copyOk?<><CheckCircle size={13}/> 已复制</>:<><Copy size={13}/> 复制</>}</button>
                        <button onClick={saveCase} className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded hover:bg-slate-800 transition-colors flex items-center gap-1"><Save size={13}/> 保存</button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-5 overflow-auto">
                    {poa ? <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{poa}</pre>
                      : <div className="h-full flex flex-col items-center justify-center text-slate-700"><BrainCircuit size={36} className="mb-3 opacity-30"/><span className="text-sm">填写左侧信息，点击"第一步：生成大纲"</span></div>}
                  </div>
                </div>
              )}

              {/* Quality Report */}
              {(genPhase === 'full' || cn) && (
                <div className="h-48 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col flex-shrink-0">
                  <div className="bg-slate-950 border-b border-slate-800 p-2.5 px-4 flex justify-between items-center flex-shrink-0">
                    <span className="text-xs font-bold text-slate-400">质检报告</span>
                    {poa && cn && <button onClick={handleAutoFix} disabled={isFixing} className="flex items-center gap-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg font-bold transition-colors">{isFixing?<RefreshCw size={11} className="animate-spin"/>:<Wand2 size={11}/>} 一键精修</button>}
                  </div>
                  <div className="flex-1 p-4 text-xs text-slate-400 overflow-auto whitespace-pre-wrap leading-relaxed">{cn||<span className="text-slate-700">生成 POA 后将自动显示质检报告...</span>}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ HISTORY ════ */}
        {tab === TABS.HISTORY && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2"><History size={20} className="text-blue-400"/> 案件历史</h2>
              <span className="text-xs text-slate-500">{filteredCases.length} / {cases.length} 条</span>
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              <div className="relative flex-1 min-w-48">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-500/40 transition-colors" placeholder="搜索店铺名、Case ID、公司..." value={hSearch} onChange={e => setHSearch(e.target.value)}/>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(['all','pending','reviewed','submitted','success','fail'] as const).map(s => (
                  <button key={s} onClick={() => setHFilter(s)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${hFilter===s ? (s==='all'?'bg-blue-600/20 text-blue-400 border-blue-500/30':STATUS_CFG[s]?.color) : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-700'}`}>
                    {s==='all'?'全部':STATUS_CFG[s].label}
                  </button>
                ))}
              </div>
            </div>
            {filteredCases.length === 0
              ? <div className="flex flex-col items-center justify-center py-24 text-slate-700"><History size={40} className="mb-3 opacity-20"/><p>{cases.length===0?'暂无案件，先生成一份 POA':'无匹配案件'}</p></div>
              : <div className="space-y-3">{filteredCases.map(c => {
                const pending_notes = (c.adminNotes||[]).filter(n=>n.requiresAction&&!n.resolved);
                return (
                  <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_CFG[c.status].color}`}>{STATUS_CFG[c.status].icon} {STATUS_CFG[c.status].label}</span>
                          <span className="text-xs font-bold text-slate-200">{c.storeName||'未命名'}</span>
                          {c.companyName && <span className="text-xs text-slate-500">· {c.companyName}</span>}
                          <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{c.violationType}</span>
                          {c.isODRSuspension && <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">ODR</span>}
                          {c.autoSaved && <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded">自动入库</span>}
                          {pending_notes.length > 0 && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold flex items-center gap-1"><MessageSquare size={9}/> {pending_notes.length} 条待跟进批注</span>}
                        </div>
                        <div className="text-[11px] text-slate-600 flex gap-3 flex-wrap">
                          {c.caseId && <span>Case: {c.caseId}</span>}
                          {isAdmin && c.clientName && <span>操作人: {c.clientName}</span>}
                          <span>{new Date(c.createdAt).toLocaleString('zh-CN')}</span>
                          {c.walmartCaseNumber && <span className="text-indigo-400">Walmart: {c.walmartCaseNumber}</span>}
                        </div>
                        {c.failureAnalysis && <div className="mt-1 text-[10px] text-rose-400 flex items-center gap-1"><ScanSearch size={10}/> 已完成失败原因分析</div>}
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => setReviewCase(c)} className="flex items-center gap-1.5 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-1.5 rounded-lg font-bold transition-colors"><Eye size={12}/> 查看</button>
                        {isAdmin && (
                          <div className="flex flex-col gap-1">
                            {c.status !== 'success' && <button onClick={() => updateStatus(c.id, 'success')} className="flex items-center gap-1 text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-lg transition-colors"><ThumbsUp size={10}/> 成功</button>}
                            {c.status !== 'fail' && <button onClick={() => updateStatus(c.id, 'fail')} className="flex items-center gap-1 text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-2 py-1 rounded-lg transition-colors"><ThumbsDown size={10}/> 失败</button>}
                          </div>
                        )}
                        {c.status === 'fail' && !c.failureAnalysis && (
                          <button onClick={() => handleAnalyseFailure(c.id)} disabled={analysingCaseId === c.id} className="flex items-center gap-1 text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-2 py-1 rounded-lg transition-colors border border-rose-500/20">
                            {analysingCaseId===c.id ? <Loader2 size={10} className="animate-spin"/> : <ScanSearch size={10}/>} AI 分析
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}</div>}
          </div>
        )}

        {/* ════ LIBRARY ════ */}
        {tab === TABS.LIBRARY && isAdmin && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2"><Library size={20} className="text-blue-400"/> 成功案例库 <span className="text-sm font-normal text-slate-500">({refs.length})</span></h2>
              <div className="flex gap-2">
                <input type="file" multiple className="hidden" ref={batchRef} onChange={batchUpload} accept=".txt,.docx,.xlsx,.csv"/>
                <input type="file" className="hidden" ref={importRef} onChange={importJSON} accept=".json"/>
                <button onClick={exportRefsJSON} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-bold transition-colors"><FileDown size={13}/> 导出</button>
                <button onClick={() => importRef.current?.click()} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-bold transition-colors"><Upload size={13}/> 导入 JSON</button>
                <button onClick={() => batchRef.current?.click()} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors"><UploadCloud size={13}/> 批量上传</button>
                <button onClick={() => setIsAddingRef(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors"><Plus size={13}/> 新增</button>
              </div>
            </div>

            {isAddingRef && (
              <div className="bg-slate-900/80 border border-blue-500/30 p-5 rounded-2xl space-y-3">
                <div className="flex justify-between"><h3 className="text-white font-bold">录入成功案例</h3><button onClick={() => setIsAddingRef(false)} className="text-slate-500 hover:text-white"><XCircle size={16}/></button></div>
                <div className="grid grid-cols-2 gap-3">
                  <input className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" placeholder="标题" value={newRef.title} onChange={e => setNewRef(p=>({...p,title:e.target.value}))}/>
                  <select className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={newRef.type} onChange={e => setNewRef(p=>({...p,type:e.target.value as any}))}>
                    <option value="Performance">Performance</option><option value="IP">IP</option><option value="Counterfeit">Counterfeit</option><option value="Related">Related</option>
                  </select>
                </div>
                <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 h-48 text-slate-300 text-xs font-mono outline-none resize-none" placeholder="粘贴成功申诉全文..." value={newRef.content} onChange={e => setNewRef(p=>({...p,content:e.target.value}))}/>
                <div className="flex justify-end gap-2"><button onClick={() => setIsAddingRef(false)} className="text-slate-500 px-4 py-2">取消</button><button onClick={saveRef} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-xs transition-colors">保存</button></div>
              </div>
            )}

            <div className="text-xs text-slate-600 flex gap-2">
              {['Performance','IP','Counterfeit','Related'].map(t => { const n=refs.filter(r=>r.type===t).length; return n>0?<span key={t} className="bg-slate-800 px-2 py-0.5 rounded">{t}: {n}</span>:null; })}
              {refs.filter(r=>r.autoSaved).length>0 && <span className="bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">自动入库: {refs.filter(r=>r.autoSaved).length}</span>}
            </div>

            {refs.length === 0
              ? <div className="flex flex-col items-center justify-center py-20 text-slate-700"><Library size={40} className="mb-3 opacity-20"/><p>案例库为空，上传或手动添加成功案例</p></div>
              : <div className="grid grid-cols-3 gap-4">{refs.map(ref => (
                <div key={ref.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 group relative hover:border-slate-700 transition-all">
                  <button onClick={() => delRef(ref.id)} className="absolute top-3 right-3 text-slate-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={14}/></button>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${ref.type==='Performance'?'bg-blue-500/10 text-blue-400 border-blue-500/20':ref.type==='IP'?'bg-purple-500/10 text-purple-400 border-purple-500/20':ref.type==='Counterfeit'?'bg-rose-500/10 text-rose-400 border-rose-500/20':'bg-slate-700 text-slate-400 border-slate-600'}`}>{ref.type}</span>
                    {ref.autoSaved && <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded">自动入库</span>}
                    {ref.successDate && <span className="text-[10px] text-slate-600">{ref.successDate}</span>}
                  </div>
                  <h3 className="text-slate-200 font-bold text-sm mb-2 pr-5 line-clamp-2">{ref.title}</h3>
                  <p className="text-slate-600 text-[10px] font-mono line-clamp-3">{ref.content.substring(0,120)}...</p>
                  <div className="mt-2 text-[10px] text-slate-700">{ref.content.length} 字符</div>
                </div>
              ))}</div>}
          </div>
        )}

        {/* ════ SETTINGS ════ */}
        {tab === TABS.SETTINGS && isAdmin && (
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-xl font-bold text-slate-200">设置与管理</h2>

            {/* Cloud */}
            {user?.role === 'super_admin' && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-base font-bold text-slate-200 flex items-center gap-2"><Cloud size={18} className="text-emerald-500"/> 云端数据库 (Supabase)</h3>
                <div className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-bold ${settings.supabaseUrl?'bg-emerald-500/8 border-emerald-500/20 text-emerald-400':'bg-slate-950 border-slate-800 text-slate-500'}`}>
                  {settings.supabaseUrl?<Wifi size={14}/>:<WifiOff size={14}/>}
                  {settings.supabaseUrl ? '已连接 — 数据实时同步到云端' : '未连接 — 数据仅存本地浏览器'}
                </div>
                {[{l:'Project URL',k:'supabaseUrl',ph:'https://xxxxxxxx.supabase.co',t:'text'},{l:'Anon API Key',k:'supabaseKey',ph:'eyJhbGci...',t:'password'}].map(({l,k,ph,t})=>(
                  <div key={k}><label className="text-[11px] font-bold text-slate-500 uppercase mb-1.5 block">{l}</label><input type={t} placeholder={ph} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 outline-none focus:border-emerald-500/40 transition-colors text-xs" value={(settings as any)[k]} onChange={e=>{const s={...settings,[k]:e.target.value};setSettings(s);saveSettings(s);}}/></div>
                ))}
                {settings.supabaseUrl && (
                  <div className="flex gap-3 flex-wrap">
                    <button onClick={()=>handleCloudSync(settings)} disabled={isSyncing} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                      <RefreshCw size={12} className={isSyncing?'animate-spin':''}/> {isSyncing ? '同步中...' : '拉取最新数据'}
                    </button>
                    <button onClick={handlePushToCloud} disabled={isSyncing} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                      <UploadCloud size={12}/> 首次迁移：推送本地数据到云端
                    </button>
                  </div>
                )}
                {!settings.supabaseUrl && (
                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    配置后，所有员工的案件历史、成功案例库、账号将实时共享。<br/>
                    首次配置完成后点「首次迁移」把本地数据推上去，之后新数据自动同步。
                  </div>
                )}
              </div>
            )}

            {/* AI Engine */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-200 flex items-center gap-2"><Server size={18}/> AI 引擎</h3>
              <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700 flex gap-6">
                {(['gemini','deepseek'] as const).map(p => (
                  <label key={p} className="flex items-center gap-3 cursor-pointer group">
                    <input type="radio" name="provider" checked={settings.selectedProvider===p} onChange={() => {const s={...settings,selectedProvider:p};setSettings(s);saveSettings(s);}} className="accent-blue-500 w-4 h-4"/>
                    <div><div className={`font-bold text-sm ${settings.selectedProvider===p?'text-white':'text-slate-400'}`}>{p==='gemini'?'Google Gemini':'DeepSeek V3'}</div><div className="text-[10px] text-slate-500">{p==='gemini'?'速度快，免费额度高':'逻辑强，中文理解极佳'}</div></div>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[{l:'Gemini API Key',k:'apiKey',p:'gemini'},{l:'DeepSeek API Key',k:'deepseekKey',p:'deepseek'}].map(({l,k,p})=>(
                  <div key={k} className={`p-3 rounded-xl border transition-all ${settings.selectedProvider===p?'border-blue-500/40 bg-blue-500/5':'border-transparent'}`}>
                    <label className="text-[11px] font-bold text-slate-400 flex justify-between mb-1.5">{l}{settings.selectedProvider===p&&<span className="text-blue-400">● 激活</span>}</label>
                    <input type="password" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={(settings as any)[k]} onChange={e=>{const s={...settings,[k]:e.target.value};setSettings(s);saveSettings(s);}}/>
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy + Auto-Iterate */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-200 flex items-center gap-2"><BrainCircuit size={18}/> 申诉策略配置</h3>
                <button onClick={handleIterateStrategy} disabled={isIterating}
                  className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                  {isIterating ? <><Loader2 size={12} className="animate-spin"/> 分析中...</> : <><Zap size={12}/> AI 自动迭代策略 ({cases.filter(c=>c.status==='success').length} 个成功案例)</>}
                </button>
              </div>

              {/* Strategy Draft Preview */}
              {stratDraft && (
                <div className="bg-purple-950/30 border border-purple-500/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-purple-300 flex items-center gap-2"><Zap size={14}/> AI 建议的新策略</div>
                    <div className="flex gap-2">
                      <button onClick={() => setStratDraft(null)} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">放弃</button>
                      <button onClick={applyStratDraft} className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1"><CheckCircle size={11}/> 应用更新</button>
                    </div>
                  </div>
                  {[{l:'Performance/ODR',v:stratDraft.performance},{l:'IP/Counterfeit',v:stratDraft.ip},{l:'通用',v:stratDraft.general}].map(({l,v})=>(
                    <div key={l} className="bg-slate-950/60 rounded-lg p-3">
                      <div className="text-[10px] font-bold text-purple-400 mb-1">{l}</div>
                      <div className="text-xs text-slate-400 leading-relaxed">{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {[{l:'Performance / ODR',k:'strategyLogistics'},{l:'IP / Counterfeit',k:'strategyIP'},{l:'通用 / 其他',k:'strategyGeneral'}].map(({l,k})=>(
                <div key={k}><label className="text-xs font-bold text-slate-400 mb-1.5 block">{l}</label><textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 text-xs h-20 outline-none resize-none focus:border-blue-500/40 transition-colors" value={(settings as any)[k]} onChange={e=>{const s={...settings,[k]:e.target.value};setSettings(s);saveSettings(s);}}/></div>
              ))}
            </div>

            {/* Walmart Submission */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-200 flex items-center gap-2"><Send size={18}/> 提交设置</h3>
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${settings.enableSimulationMode?'bg-amber-500/8 border-amber-500/20':'bg-slate-950 border-slate-800'}`}>
                <button onClick={() => {const s={...settings,enableSimulationMode:!settings.enableSimulationMode};setSettings(s);saveSettings(s);}} className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${settings.enableSimulationMode?'bg-amber-500':'bg-slate-700'}`}><div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${settings.enableSimulationMode?'left-5':'left-1'}`}/></button>
                <div>
                  <div className={`text-xs font-bold ${settings.enableSimulationMode?'text-amber-400':'text-slate-400'}`}>{settings.enableSimulationMode?'模拟模式（测试用）':'真实提交模式'}</div>
                  <div className="text-[10px] text-slate-600">模拟模式下点击"提交 Walmart"只生成虚拟 Case ID，不会真实发送</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-600 bg-slate-950 border border-slate-800 rounded-xl p-3 leading-relaxed">
                💡 <span className="text-slate-500">Walmart Marketplace API 暂不支持浏览器直接调用（CORS 限制）。如需真实提交，请将 POA 内容复制后手动提交至 Walmart Seller Center，或联系开发者部署服务端代理。</span>
              </div>
            </div>

            {/* User Management */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-bold text-slate-200 flex items-center gap-2"><Users size={18}/> 账号管理</h3>
                <button onClick={() => setIsAddingUser(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"><UserPlus size={13}/> 新增</button>
              </div>
              {isAddingUser && (
                <form onSubmit={createUser} className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="用户名" className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={newUserForm.username} onChange={e=>setNewUserForm(p=>({...p,username:e.target.value}))}/>
                    <input required placeholder="密码 (≥4位)" className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={newUserForm.password} onChange={e=>setNewUserForm(p=>({...p,password:e.target.value}))}/>
                    <select className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={newUserForm.role} onChange={e=>setNewUserForm(p=>({...p,role:e.target.value as UserRole}))}>
                      <option value="client">客户</option>{user?.role==='super_admin'&&<><option value="admin">管理员</option><option value="super_admin">超级管理员</option></>}
                    </select>
                    <input placeholder="所属公司（可选）" className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none" value={newUserForm.companyName} onChange={e=>setNewUserForm(p=>({...p,companyName:e.target.value}))}/>
                  </div>
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsAddingUser(false)} className="text-slate-500 px-4 py-2 text-xs">取消</button><button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold text-xs transition-colors">创建</button></div>
                </form>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-500 font-bold uppercase text-[10px]">
                    <tr><th className="p-3">账号</th><th className="p-3">角色</th><th className="p-3">公司</th><th className="p-3 text-right">操作</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {userList.map(u => (
                      <tr key={u.id} className="hover:bg-slate-800/30 group">
                        <td className="p-3 text-slate-300 font-medium"><div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-500"><User size={11}/></div>{u.username}{u.id===user?.id&&<span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1 rounded">YOU</span>}</div></td>
                        <td className="p-3">{editingUserId===u.id?(<select className="bg-slate-950 border border-slate-700 rounded p-1 text-slate-200 text-xs" value={editUserForm.role} onChange={e=>setEditUserForm(p=>({...p,role:e.target.value as UserRole}))}><option value="client">客户</option>{user?.role==='super_admin'&&<><option value="admin">管理员</option><option value="super_admin">超级管理员</option></>}</select>):(<span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold flex w-fit items-center gap-1 border ${u.role==='super_admin'?'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20':u.role==='admin'?'bg-indigo-500/10 text-indigo-400 border-indigo-500/20':'bg-slate-800 text-slate-400 border-slate-700'}`}>{u.role==='super_admin'&&<Crown size={8}/>}{u.role.replace('_',' ')}</span>)}</td>
                        <td className="p-3 text-slate-500 text-xs">{editingUserId===u.id?(<input className="bg-slate-950 border border-slate-700 rounded p-1 text-slate-200 w-full text-xs" value={editUserForm.companyName} onChange={e=>setEditUserForm(p=>({...p,companyName:e.target.value}))}/>):(u.companyName||'—')}</td>
                        <td className="p-3 text-right">{editingUserId===u.id?(<div className="flex items-center justify-end gap-2"><button onClick={() => saveEditUser(u.id)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={15}/></button><button onClick={() => setEditingUserId(null)} className="text-slate-500 hover:text-slate-300"><XCircle size={15}/></button></div>):(<div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => resetPwd(u)} title="重置密码" className="text-blue-400 hover:text-blue-300"><KeyRound size={14}/></button>{(user?.role==='super_admin'||(user?.role==='admin'&&u.role==='client'))&&<button onClick={() => {setEditingUserId(u.id);setEditUserForm({role:u.role,companyName:u.companyName||''});}} title="编辑" className="text-amber-400 hover:text-amber-300"><Edit2 size={14}/></button>}{u.id!==user?.id&&(user?.role==='super_admin'||(user?.role==='admin'&&u.role==='client'))&&<button onClick={() => delUser(u.id)} title="删除" className="text-rose-400 hover:text-rose-300"><Trash2 size={14}/></button>}</div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Login Screen ─────────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (u: UserType) => void }) {
  const [un, setUn] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErrMsg('');
    try {
      const u = await loginUserCloud(un.trim(), pw);
      onLogin(u);
    } catch (err: any) {
      setErrMsg(err.message ?? '登录失败');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/30 via-transparent to-indigo-950/20 pointer-events-none"/>
      <div className="w-full max-w-sm p-8 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-xl relative">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">泽远跨境</h1>
          <p className="text-slate-500 text-xs mt-1">POA 智能申诉系统 V7</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            required
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
            placeholder="账号"
            value={un} onChange={e => setUn(e.target.value)}
          />
          <div className="relative">
            <input
              required
              type={show ? 'text' : 'password'}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 pr-10 outline-none focus:border-blue-500/50 transition-colors"
              placeholder="密码"
              value={pw} onChange={e => setPw(e.target.value)}
            />
            <button type="button" onClick={() => setShow(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
              {show ? <EyeOff size={15}/> : <Eye size={15}/>}
            </button>
          </div>
          {errMsg && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{errMsg}</div>
          )}
          <button
            type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all flex justify-center items-center gap-2"
          >
            {loading && <Loader2 size={17} className="animate-spin"/>}
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <p className="mt-5 text-center text-slate-700 text-[11px]">没有账号？请联系管理员开通</p>
      </div>
    </div>
  );
}
