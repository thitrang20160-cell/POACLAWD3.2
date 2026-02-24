import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LayoutDashboard, FileText, History, Settings, Sparkles, ShieldAlert, Save,
  Copy, CheckCircle, XCircle, AlertCircle, Download, BrainCircuit, UploadCloud,
  Lightbulb, Library, Plus, Trash2, Upload, Loader2, Wand2, RefreshCw,
  Search, UserCircle, LogOut, Lock, User, ShieldCheck, Users, Edit2, UserPlus,
  KeyRound, Gavel, Send, Server, Cloud, CloudLightning, Wifi, WifiOff,
  AlertTriangle, Crown, FileDown, Eye, EyeOff, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Clock, CheckSquare, XSquare, BarChart2, Filter
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

import {
  loadCases, saveCases, loadSettings, saveSettings, loadReferences, saveReferences,
  loginUser, registerUser, getCurrentSession, setCurrentSession,
  getAllUsers, deleteUser, updateUser, updateUserPassword, verifyPassword
} from './services/storageService';
import { generatePOA, generateCNExplanation, autoFixPOA } from './services/geminiService';
import { CloudService } from './services/cloudService';
import { parseFile } from './services/fileService';
import { submitPOAToWalmart } from './services/walmartService';
import {
  CaseData, GlobalSettings, RiskAnalysis, ViolationType,
  ReferenceCase, User as UserType, UserRole
} from './types';
import { RiskBadge } from './components/RiskBadge';

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS = { DASHBOARD: 'dashboard', GENERATOR: 'generator', HISTORY: 'history', LIBRARY: 'library', SETTINGS: 'settings' };

const STATUS_CONFIG: Record<CaseData['status'], { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: '待审核', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',   icon: <Clock size={12}/> },
  reviewed: { label: '已审核', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',      icon: <Eye size={12}/> },
  submitted:{ label: '已提交', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', icon: <Send size={12}/> },
  rejected: { label: '已驳回', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20',   icon: <XSquare size={12}/> },
  success:  { label: '申诉成功', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: <CheckSquare size={12}/> },
  fail:     { label: '申诉失败', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20',    icon: <XSquare size={12}/> },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const stripMarkdown = (t: string) => t
  .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
  .replace(/^#+\s/gm, '').replace(/`/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1');

const calculateSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
};

// FIXED: Pure function - no setState side effects
const computeRisk = (suspensionEmail: string, violationType: ViolationType): RiskAnalysis => {
  const text = (suspensionEmail || '').toLowerCase();
  let score = 78;
  const reasons: string[] = [];

  if (text.includes('counterfeit') || text.includes('inauthentic')) { score -= 25; reasons.push('⚠ 高危：涉及假货/正品性投诉 (-25)'); }
  if (text.includes('termination') || text.includes('final decision')) { score -= 35; reasons.push('🔴 极危：终止合作/最终决定 (-35)'); }
  if (text.includes('repeat') || text.includes('multiple violations')) { score -= 15; reasons.push('⚠ 重复违规记录 (-15)'); }
  if (violationType === 'IP') { score -= 10; reasons.push('⚠ 类型：知识产权侵权 (-10)'); }
  if (violationType === 'Counterfeit') { score -= 20; reasons.push('🔴 类型：假冒商品 (-20)'); }
  if (text.includes('30 day') || text.includes('14 day')) { score += 8; reasons.push('✅ 利好：有明确暂停期限 (+8)'); }
  if (text.includes('first') || text.includes('first time')) { score += 10; reasons.push('✅ 利好：首次违规 (+10)'); }

  score = Math.max(5, Math.min(96, score));
  const level = score > 65 ? 'Low' : score > 35 ? 'Medium' : 'High';

  // FIXED: Tone instruction for AI
  const toneInstruction =
    level === 'High'
      ? 'TONE: Extremely contrite and humble. Accept FULL responsibility. Do NOT minimize the severity. Show maximum urgency in corrective actions.'
      : level === 'Medium'
      ? 'TONE: Professional and sincerely apologetic. Balance accountability with demonstrating your track record and commitment.'
      : 'TONE: Professional, confident, and solution-focused. Express genuine regret while highlighting your strong compliance history.';

  return { score, level, reasons, toneInstruction };
};

const exportPOAAsText = (content: string, storeName: string) => {
  const clean = stripMarkdown(content);
  const blob = new Blob([clean], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `POA_${storeName || 'appeal'}_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  // Auth
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Navigation
  const [activeTab, setActiveTab] = useState(TABS.DASHBOARD);

  // Data
  const [cases, setCases] = useState<CaseData[]>([]);
  const [references, setReferences] = useState<ReferenceCase[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    selectedProvider: 'gemini', apiKey: '', deepseekKey: '',
    supabaseUrl: '', supabaseKey: '', walmartClientId: '', walmartClientSecret: '',
    enableSimulationMode: true, strategyGeneral: '', strategyLogistics: '', strategyIP: ''
  });

  // Admin
  const [userList, setUserList] = useState<UserType[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '', role: 'client' as UserRole, companyName: '' });
  const [editUserForm, setEditUserForm] = useState({ role: 'client' as UserRole, companyName: '' });

  // Password change
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [showPwd, setShowPwd] = useState({ old: false, new: false });

  // Review modal
  const [reviewCase, setReviewCase] = useState<CaseData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // History filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<CaseData['status'] | 'all'>('all');

  // Generator
  const [formData, setFormData] = useState<Partial<CaseData>>({
    storeName: '', companyName: '', caseId: '', productCategory: '',
    supplyChain: 'Private Label', violationType: 'Performance',
    suspensionEmail: '', sellerExplanation: '', actionsTaken: '',
    affectedCount: '', supplierInfo: '', isODRSuspension: false
  });
  const [selectedRefId, setSelectedRefId] = useState('');
  const [isAutoMatch, setIsAutoMatch] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [generatedPOA, setGeneratedPOA] = useState('');
  const [generatedCN, setGeneratedCN] = useState('');
  const [currentRisk, setCurrentRisk] = useState<RiskAnalysis | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Library
  const [isAddingRef, setIsAddingRef] = useState(false);
  const [newRef, setNewRef] = useState<Partial<ReferenceCase>>({ title: '', type: 'Performance', content: '' });
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);

  const importJsonRef = useRef<HTMLInputElement>(null);
  const batchDocRef = useRef<HTMLInputElement>(null);

  // ── Init ──
  useEffect(() => {
    const session = getCurrentSession();
    if (session) setCurrentUser(session);
    setIsAuthLoading(false);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const s = loadSettings();
    setSettings(s);
    const localRefs = loadReferences();
    setReferences(localRefs);
    if (s.supabaseUrl && s.supabaseKey) handleCloudSync(s);
    const allCases = loadCases();
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
    setCases(isAdmin ? allCases : allCases.filter(c => c.userId === currentUser.id));
    if (isAdmin) setUserList(getAllUsers());
    if (currentUser.companyName && !formData.companyName)
      setFormData(p => ({ ...p, companyName: currentUser.companyName }));
  }, [currentUser]);

  // Auto-match reference
  useEffect(() => {
    if (!isAutoMatch || !formData.suspensionEmail || !formData.violationType) return;
    const typeMatches = references.filter(r => r.type === formData.violationType);
    if (typeMatches.length === 0) { setSelectedRefId(''); return; }
    let bestId = '', maxScore = -1;
    typeMatches.forEach(ref => {
      const s = calculateSimilarity(formData.suspensionEmail!, ref.content);
      if (s > maxScore) { maxScore = s; bestId = ref.id; }
    });
    if (bestId) setSelectedRefId(bestId);
  }, [isAutoMatch, formData.suspensionEmail, formData.violationType]);

  // ── Cloud Sync ──
  const handleCloudSync = async (cfg: GlobalSettings) => {
    if (!cfg.supabaseUrl) return;
    setIsCloudSyncing(true);
    try {
      const { data, error } = await CloudService.getAllReferences(cfg);
      if (data && data.length > 0) { setReferences(data); saveReferences(data); }
      else if (error) console.error('Cloud Sync Error:', error);
    } finally { setIsCloudSyncing(false); }
  };

  // ── Auth ──
  const handleLogout = () => {
    setCurrentSession(null); setCurrentUser(null); setCases([]); setReferences([]);
    setActiveTab(TABS.DASHBOARD);
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!verifyPassword(currentUser.username, pwdForm.oldPassword, currentUser.passwordHash))
      return alert('旧密码错误');
    if (pwdForm.newPassword.length < 4) return alert('新密码至少需要4位');
    if (pwdForm.newPassword !== pwdForm.confirm) return alert('两次输入的新密码不一致');
    const updated = updateUserPassword(currentUser.id, pwdForm.newPassword);
    if (updated) { setCurrentUser(updated); setCurrentSession(updated); }
    setIsChangePwdOpen(false);
    setPwdForm({ oldPassword: '', newPassword: '', confirm: '' });
    alert('密码修改成功！');
  };

  // ── User Management ──
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.username || !newUserForm.password) return;
    try {
      registerUser(newUserForm.username, newUserForm.password, newUserForm.role, newUserForm.companyName);
      setUserList(getAllUsers());
      setIsAddingUser(false);
      setNewUserForm({ username: '', password: '', role: 'client', companyName: '' });
      alert('账号创建成功！');
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteUser = (id: string) => {
    if (id === currentUser?.id) return alert('无法删除自己');
    const target = userList.find(u => u.id === id);
    if (!target) return;
    if (currentUser?.role === 'admin' && target.role !== 'client')
      return alert('权限不足：管理员只能删除客户账号');
    if (!window.confirm(`确定删除用户 [${target.username}] 吗？`)) return;
    try { deleteUser(id); setUserList(getAllUsers()); }
    catch (e: any) { alert('删除失败: ' + e.message); }
  };

  const handleSaveEditUser = (userId: string) => {
    const target = userList.find(u => u.id === userId);
    if (!target) return;
    if (currentUser?.role === 'admin' && editUserForm.role !== 'client')
      return alert('权限不足：普通管理员无法提升用户角色');
    updateUser({ ...target, role: editUserForm.role, companyName: editUserForm.companyName });
    setUserList(getAllUsers());
    setEditingUserId(null);
  };

  const handleResetPassword = (user: UserType) => {
    if (currentUser?.role === 'admin' && user.role !== 'client')
      return alert('权限不足：只能重置客户密码');
    const newPass = prompt(`请输入用户 [${user.username}] 的新密码 (最少4位):`);
    if (!newPass) return;
    if (newPass.length < 4) return alert('密码至少需要4位');
    updateUserPassword(user.id, newPass);
    alert('密码已重置');
  };

  // ── Stats ──
  const stats = useMemo(() => {
    const total = cases.length;
    const success = cases.filter(c => c.status === 'success').length;
    const fail = cases.filter(c => c.status === 'fail').length;
    const pending = cases.filter(c => c.status === 'pending').length;
    const submitted = cases.filter(c => c.status === 'submitted').length;
    const reviewed = cases.filter(c => c.status === 'reviewed').length;
    const decided = success + fail;
    const successRate = decided > 0 ? Math.round((success / decided) * 100) : 0;
    return { total, success, fail, pending, submitted, reviewed, successRate };
  }, [cases]);

  const pieData = useMemo(() => [
    { name: '申诉成功', value: stats.success, color: '#10b981' },
    { name: '申诉失败', value: stats.fail, color: '#f43f5e' },
    { name: '已提交', value: stats.submitted, color: '#6366f1' },
    { name: '待审核', value: stats.pending, color: '#f59e0b' },
    { name: '已审核', value: stats.reviewed, color: '#3b82f6' },
  ].filter(d => d.value > 0), [stats]);

  // ── Generator ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try { setFileContent(await parseFile(file)); }
    catch (err) { alert('文件解析失败: ' + err); setFileName(''); }
  };

  const handleGenerate = async () => {
    const activeKey = settings.selectedProvider === 'deepseek' ? settings.deepseekKey : settings.apiKey;
    if (!activeKey) return alert(`未配置 ${settings.selectedProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'} API Key\n请在"设置"页面配置。`);

    // FIXED: Pure function call, then explicit setState
    const risk = computeRisk(formData.suspensionEmail || '', formData.violationType as ViolationType || 'Performance');
    setCurrentRisk(risk);

    const similarCase = references.find(r => r.id === selectedRefId);
    setIsGenerating(true);
    try {
      const poa = await generatePOA(activeKey, formData, settings, risk, fileContent, similarCase);
      setGeneratedPOA(poa);
      const cn = await generateCNExplanation(poa, formData.suspensionEmail || '', settings);
      setGeneratedCN(cn);
    } catch (e: any) { alert('生成失败: ' + e.message); }
    finally { setIsGenerating(false); }
  };

  const handleAutoFix = async () => {
    if (!generatedPOA || !generatedCN) return;
    if (!settings.apiKey && !settings.deepseekKey) return alert('请先配置 API Key');
    setIsFixing(true);
    try {
      const fixed = await autoFixPOA(generatedPOA, generatedCN, settings);
      setGeneratedPOA(fixed);
      alert('POA 已根据质检报告自动修正！');
    } catch (e: any) { alert('修正失败: ' + e.message); }
    finally { setIsFixing(false); }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(stripMarkdown(generatedPOA));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const saveCurrentCase = () => {
    if (!generatedPOA || !currentUser) return;
    const newCase: CaseData = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
      userId: currentUser.id,
      clientName: currentUser.username,
      createdAt: new Date().toISOString(),
      ...(formData as any),
      poaContent: generatedPOA,
      cnExplanation: generatedCN,
      status: 'pending',
      fileEvidenceSummary: fileName ? `Used: ${fileName}` : undefined,
    };
    const allCases = loadCases();
    saveCases([newCase, ...allCases]);
    setCases([newCase, ...cases]);
    alert('案件已保存至历史库！');
  };

  const updateCaseStatus = (id: string, status: CaseData['status']) => {
    const allCases = loadCases();
    const updated = allCases.map(c => c.id === id ? { ...c, status } : c);
    saveCases(updated);
    setCases(cases.map(c => c.id === id ? { ...c, status } : c));
  };

  const handleSubmitToWalmart = async () => {
    if (!reviewCase) return;
    setIsSubmitting(true);
    try {
      const result = await submitPOAToWalmart(reviewCase, settings);
      if (result.success) {
        const updated: CaseData = { ...reviewCase, status: 'submitted', submissionTime: new Date().toISOString(), walmartCaseNumber: result.caseNumber };
        const allCases = loadCases().map(c => c.id === reviewCase.id ? updated : c);
        saveCases(allCases);
        const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
        setCases(allCases.filter(c => isAdmin || c.userId === currentUser?.id));
        alert(`提交成功！\nCase ID: ${result.caseNumber}`);
        setReviewCase(null);
      } else { alert(`提交失败: ${result.message}`); }
    } catch (e: any) { alert('系统错误: ' + e.message); }
    finally { setIsSubmitting(false); }
  };

  const saveReviewEdits = () => {
    if (!reviewCase) return;
    const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
    const allCases = loadCases().map(c => c.id === reviewCase.id ? reviewCase : c);
    saveCases(allCases);
    setCases(allCases.filter(c => isAdmin || c.userId === currentUser?.id));
    alert('修改已保存！');
  };

  // ── Library ──
  const handleBatchDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBatchProgress({ current: 0, total: files.length });
    const newRefs: ReferenceCase[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await parseFile(file);
        const lName = file.name.toLowerCase();
        let type: ViolationType = 'Performance';
        if (lName.includes('ip') || lName.includes('copyright')) type = 'IP';
        else if (lName.includes('counterfeit') || lName.includes('fake')) type = 'Counterfeit';
        const refObj: ReferenceCase = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          title: file.name.replace(/\.[^/.]+$/, ''),
          type, content: text, tags: ['批量导入'],
          successDate: new Date().toISOString().slice(0, 10)
        };
        newRefs.push(refObj);
        if (settings.supabaseUrl) await CloudService.upsertReference(settings, refObj);
      } catch (err) { console.warn(`解析失败: ${file.name}`, err); }
      setBatchProgress({ current: i + 1, total: files.length });
      await new Promise(r => setTimeout(r, 10));
    }
    if (newRefs.length > 0) {
      const updated = [...references, ...newRefs];
      setReferences(updated); saveReferences(updated);
      alert(`成功导入 ${newRefs.length} 个文件！`);
    } else { alert('没有文件被成功解析'); }
    setBatchProgress(null);
    if (batchDocRef.current) batchDocRef.current.value = '';
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(json)) return alert('无效 JSON：需要数组格式');
        if (json.length > 0 && (!json[0].id || !json[0].content)) return alert('格式错误：缺少 id 或 content 字段');
        if (!window.confirm(`检测到 ${json.length} 条数据，确认导入？`)) return;
        const existingIds = new Set(references.map(r => r.id));
        const newUnique = json.filter((r: ReferenceCase) => !existingIds.has(r.id));
        const merged = [...references, ...newUnique];
        setReferences(merged); saveReferences(merged);
        if (settings.supabaseUrl) for (const r of newUnique) await CloudService.upsertReference(settings, r);
        alert(`导入完成！新增 ${newUnique.length} 条`);
      } catch (err) { alert('导入错误: ' + err); }
      finally { setIsImporting(false); if (importJsonRef.current) importJsonRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  const saveReference = async () => {
    if (!newRef.title || !newRef.content) return alert('标题和内容不能为空');
    const item: ReferenceCase = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      title: newRef.title!, type: newRef.type as ViolationType,
      content: newRef.content!, tags: [],
      successDate: new Date().toISOString().slice(0, 10)
    };
    const updated = [...references, item];
    setReferences(updated); saveReferences(updated);
    if (settings.supabaseUrl) await CloudService.upsertReference(settings, item);
    setIsAddingRef(false);
    setNewRef({ title: '', type: 'Performance', content: '' });
  };

  const deleteReference = async (id: string) => {
    if (!window.confirm('确定删除此案例吗？')) return;
    const updated = references.filter(r => r.id !== id);
    setReferences(updated); saveReferences(updated);
    if (settings.supabaseUrl) await CloudService.deleteReference(settings, id);
  };

  const exportReferencesJSON = () => {
    const blob = new Blob([JSON.stringify(references, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reference_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── History filter ──
  const filteredCases = useMemo(() => {
    return cases.filter(c => {
      const matchSearch = !historySearch || [c.storeName, c.caseId, c.companyName, c.clientName].some(
        f => f?.toLowerCase().includes(historySearch.toLowerCase())
      );
      const matchStatus = historyFilter === 'all' || c.status === historyFilter;
      return matchSearch && matchStatus;
    });
  }, [cases, historySearch, historyFilter]);

  // ── Guards ──
  if (!currentUser && !isAuthLoading) {
    return <LoginScreen onLogin={(user) => { setCurrentUser(user); setCurrentSession(user); }} />;
  }
  if (isAuthLoading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
    </div>
  );

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  return (
    <div className="min-h-screen flex text-sm relative">
      {/* ── Global Overlay ── */}
      {(isImporting || batchProgress || isCloudSyncing) && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          {isCloudSyncing
            ? <CloudLightning className="w-12 h-12 text-emerald-400 animate-pulse mb-4" />
            : <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />}
          <div className="text-lg font-bold text-slate-200">
            {isCloudSyncing ? '正在同步云端数据库...'
              : batchProgress ? `正在解析文档 (${batchProgress.current}/${batchProgress.total})`
              : '正在处理...'}
          </div>
          {batchProgress && (
            <div className="mt-4 w-64 bg-slate-800 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* ── Review Modal ── */}
      {reviewCase && (
        <div className="fixed inset-0 bg-slate-950/92 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500/20 p-2 rounded-lg text-indigo-400"><Gavel size={20} /></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-200">案件审核</h3>
                  <div className="text-xs text-slate-500 flex gap-3">
                    <span>店铺: {reviewCase.storeName}</span>
                    <span>|</span>
                    <span>Case ID: {reviewCase.caseId || 'N/A'}</span>
                    <span>|</span>
                    <span>{new Date(reviewCase.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setReviewCase(null)} className="text-slate-500 hover:text-white transition-colors"><XCircle size={24} /></button>
            </div>
            <div className="flex-1 overflow-hidden flex">
              <div className="w-1/3 border-r border-slate-800 p-5 overflow-y-auto space-y-4">
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">违规邮件</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs text-slate-400 h-40 overflow-y-auto whitespace-pre-wrap font-mono">{reviewCase.suspensionEmail}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">案件状态</div>
                  <div className="flex flex-wrap gap-2">
                    {(['pending','reviewed','submitted','success','fail'] as CaseData['status'][]).map(s => (
                      <button key={s} onClick={() => setReviewCase({ ...reviewCase, status: s })}
                        className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${reviewCase.status === s ? STATUS_CONFIG[s].color : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-600'}`}>
                        {STATUS_CONFIG[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                {reviewCase.cnExplanation && (
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">质检报告</div>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs text-slate-400 max-h-48 overflow-y-auto whitespace-pre-wrap">{reviewCase.cnExplanation}</div>
                  </div>
                )}
              </div>
              <div className="w-2/3 flex flex-col bg-slate-950">
                <div className="flex-1 p-4 overflow-y-auto">
                  <textarea
                    className="w-full h-full min-h-[500px] bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-300 font-mono text-xs leading-relaxed outline-none resize-none focus:border-blue-500/50 transition-colors"
                    value={reviewCase.poaContent}
                    onChange={e => setReviewCase({ ...reviewCase, poaContent: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 bg-slate-900 rounded-b-2xl flex justify-between items-center">
              <button onClick={saveReviewEdits} className="px-4 py-2 border border-slate-700 rounded-lg text-slate-400 text-xs font-bold flex items-center gap-1.5 hover:border-slate-600 transition-colors">
                <Save size={14} /> 保存修改
              </button>
              <div className="flex gap-3">
                <button onClick={() => exportPOAAsText(reviewCase.poaContent, reviewCase.storeName)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 px-3 py-2 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors">
                  <FileDown size={14} /> 导出 TXT
                </button>
                <button onClick={handleSubmitToWalmart}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  提交 Walmart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ── */}
      {isChangePwdOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-96 shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><KeyRound size={20} /> 修改密码</h3>
              <button onClick={() => setIsChangePwdOpen(false)} className="text-slate-500 hover:text-white"><XCircle size={20} /></button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="relative">
                <input type={showPwd.old ? 'text' : 'password'} placeholder="当前密码" required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 pr-10 focus:border-blue-500/50 outline-none transition-colors"
                  value={pwdForm.oldPassword} onChange={e => setPwdForm(p => ({ ...p, oldPassword: e.target.value }))} />
                <button type="button" onClick={() => setShowPwd(p => ({ ...p, old: !p.old }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  {showPwd.old ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
              <div className="relative">
                <input type={showPwd.new ? 'text' : 'password'} placeholder="新密码 (至少4位)" required minLength={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 pr-10 focus:border-blue-500/50 outline-none transition-colors"
                  value={pwdForm.newPassword} onChange={e => setPwdForm(p => ({ ...p, newPassword: e.target.value }))} />
                <button type="button" onClick={() => setShowPwd(p => ({ ...p, new: !p.new }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  {showPwd.new ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
              <input type="password" placeholder="确认新密码" required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 focus:border-blue-500/50 outline-none transition-colors"
                value={pwdForm.confirm} onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))} />
              {pwdForm.newPassword && pwdForm.confirm && pwdForm.newPassword !== pwdForm.confirm && (
                <p className="text-[11px] text-rose-400">两次密码不一致</p>
              )}
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg text-sm transition-colors">
                确认修改
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className="w-60 bg-slate-900/95 backdrop-blur-xl border-r border-slate-800 flex flex-col fixed h-full z-10">
        <div className="p-5 border-b border-slate-800">
          <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">泽远跨境 POA Pro</h1>
          <div className="mt-1 text-[10px] text-slate-500 flex justify-between items-center">
            <span>内部专用版 V6</span>
            <span className={`uppercase font-bold text-[10px] px-1.5 py-0.5 rounded ${
              currentUser?.role === 'super_admin' ? 'text-fuchsia-400 bg-fuchsia-500/10' :
              currentUser?.role === 'admin' ? 'text-indigo-400 bg-indigo-500/10' :
              'text-slate-400 bg-slate-800'}`}>
              {currentUser?.role?.replace('_', ' ')}
            </span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {[
            { id: TABS.DASHBOARD,  label: '仪表盘',      icon: LayoutDashboard, admin: false },
            { id: TABS.GENERATOR,  label: 'POA 智能生成', icon: FileText,        admin: false },
            { id: TABS.HISTORY,    label: '案件历史',     icon: History,         admin: false },
            { id: TABS.LIBRARY,    label: '成功案例库',   icon: Library,         admin: true  },
            { id: TABS.SETTINGS,   label: '设置与管理',   icon: Settings,        admin: true  },
          ].filter(item => !item.admin || isAdmin).map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${activeTab === item.id
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
              <item.icon size={17} /> <span className="font-medium text-sm">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 space-y-1">
          <div className="text-[11px] text-slate-500 px-3 pb-1 flex items-center gap-1.5">
            <User size={12}/> {currentUser?.username}
            {currentUser?.companyName && <span className="text-slate-600">· {currentUser.companyName}</span>}
          </div>
          <button onClick={() => setIsChangePwdOpen(true)}
            className="w-full flex items-center gap-2 text-xs text-slate-500 px-3 py-2 hover:bg-slate-800/50 rounded-lg transition-colors">
            <KeyRound size={13} /> 修改密码
          </button>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 text-xs text-rose-500 px-3 py-2 hover:bg-rose-500/10 rounded-lg transition-colors">
            <LogOut size={13} /> 退出登录
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 ml-60 p-6 overflow-y-auto min-h-screen bg-slate-950">

        {/* ════ DASHBOARD ════ */}
        {activeTab === TABS.DASHBOARD && (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-200">仪表盘</h2>
              <span className="text-xs text-slate-500">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: '总案件', value: stats.total, icon: <FileText size={20}/>, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                { label: '申诉成功率', value: `${stats.successRate}%`, icon: <TrendingUp size={20}/>, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                { label: '待审核', value: stats.pending, icon: <Clock size={20}/>, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                { label: '已提交', value: stats.submitted, icon: <Send size={20}/>, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
              ].map((s, i) => (
                <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                  <div className={`${s.bg} ${s.color} w-10 h-10 rounded-xl flex items-center justify-center mb-3`}>{s.icon}</div>
                  <div className="text-slate-500 text-xs mb-1">{s.label}</div>
                  <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Pie Chart */}
              <div className="col-span-1 bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-slate-300 mb-4">案件分布</h3>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                        {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#94a3b8' }} />
                      <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-slate-600 text-sm">暂无案件数据</div>
                )}
              </div>

              {/* Recent Cases */}
              <div className="col-span-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-slate-300">最近案件</h3>
                  <button onClick={() => setActiveTab(TABS.HISTORY)} className="text-[11px] text-blue-400 hover:underline">查看全部 →</button>
                </div>
                {cases.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-600">
                    <FileText size={32} className="mb-2 opacity-40"/>
                    <span className="text-sm">暂无案件，去生成第一份 POA 吧</span>
                    <button onClick={() => setActiveTab(TABS.GENERATOR)} className="mt-3 text-xs text-blue-400 hover:underline">前往生成 →</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cases.slice(0, 5).map(c => (
                      <div key={c.id} className="flex items-center gap-3 p-3 bg-slate-950/50 rounded-xl border border-slate-800/50 hover:border-slate-700 transition-colors group cursor-pointer"
                        onClick={() => setReviewCase(c)}>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_CONFIG[c.status].color}`}>
                          {STATUS_CONFIG[c.status].icon} {STATUS_CONFIG[c.status].label}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-300 font-medium text-xs truncate">{c.storeName || '未命名'}</div>
                          <div className="text-slate-600 text-[10px]">{c.violationType} · {c.companyName}</div>
                        </div>
                        <div className="text-[10px] text-slate-600 whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Cloud Status */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex items-center gap-4">
              <div className={`p-3 rounded-xl ${settings.supabaseUrl ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                {settings.supabaseUrl ? <CloudLightning size={22} /> : <Cloud size={22} />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-200">
                  {settings.supabaseUrl ? '已连接 Supabase 云端' : '离线模式 (LocalStorage)'}
                </div>
                <p className="text-xs text-slate-500">
                  {settings.supabaseUrl ? '案例库将自动同步至云端数据库。' : '未配置云端，数据仅存储在当前浏览器中。配置 Supabase 可跨设备共享。'}
                </p>
              </div>
              {settings.supabaseUrl && (
                <button onClick={() => handleCloudSync(settings)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                  <RefreshCw size={13} className={isCloudSyncing ? 'animate-spin' : ''} /> 立即同步
                </button>
              )}
            </div>
          </div>
        )}

        {/* ════ GENERATOR ════ */}
        {activeTab === TABS.GENERATOR && (
          <div className="max-w-7xl mx-auto grid grid-cols-12 gap-5 h-[calc(100vh-4rem)]">
            {/* Left Panel */}
            <div className="col-span-5 flex flex-col gap-4 overflow-y-auto pr-1 pb-8">

              {/* Section 1: Diagnosis */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <h3 className="text-slate-200 font-bold flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</div>
                  案情诊断
                </h3>
                <div className="flex justify-between items-center text-[10px] bg-slate-800/80 text-slate-400 p-2.5 rounded-lg">
                  <span>AI 引擎: <span className="text-emerald-400 font-bold uppercase">{settings.selectedProvider}</span></span>
                  {isAdmin && <button onClick={() => setActiveTab(TABS.SETTINGS)} className="text-blue-400 hover:underline">切换引擎</button>}
                </div>

                <div>
                  <label className="text-slate-500 text-[11px] mb-1.5 block">Walmart 违规通知邮件 *</label>
                  <textarea
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-28 text-xs leading-relaxed outline-none resize-none focus:border-blue-500/40 transition-colors"
                    placeholder="粘贴 Walmart 发来的暂停/投诉邮件原文..."
                    value={formData.suspensionEmail}
                    onChange={e => setFormData(p => ({ ...p, suspensionEmail: e.target.value }))}
                    onBlur={() => {
                      if (formData.suspensionEmail) setCurrentRisk(computeRisk(formData.suspensionEmail, formData.violationType as ViolationType || 'Performance'));
                    }}
                  />
                </div>

                {currentRisk && <RiskBadge analysis={currentRisk} />}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">违规类型</label>
                    <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      value={formData.violationType}
                      onChange={e => setFormData(p => ({ ...p, violationType: e.target.value as ViolationType, isODRSuspension: e.target.value !== 'Performance' ? false : p.isODRSuspension }))}>
                      <option value="Performance">Performance (绩效)</option>
                      <option value="IP">IP (知识产权)</option>
                      <option value="Counterfeit">Counterfeit (假冒)</option>
                      <option value="Related">Related (关联)</option>
                      <option value="Other">Other (其他)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">供应链模式</label>
                    <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      value={formData.supplyChain}
                      onChange={e => setFormData(p => ({ ...p, supplyChain: e.target.value as any }))}>
                      <option value="Private Label">Private Label</option>
                      <option value="Authorized Distributor">Authorized Distributor</option>
                      <option value="Wholesale">Wholesale</option>
                      <option value="Dropshipping">Dropshipping</option>
                    </select>
                  </div>
                </div>

                {/* ODR Toggle */}
                {formData.violationType === 'Performance' && (
                  <div className={`p-3 rounded-xl border transition-all ${formData.isODRSuspension ? 'bg-amber-500/8 border-amber-500/30' : 'bg-slate-950 border-slate-800'}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => setFormData(p => ({ ...p, isODRSuspension: !p.isODRSuspension }))}
                        className={`mt-0.5 w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${formData.isODRSuspension ? 'bg-amber-500' : 'bg-slate-700'}`}>
                        <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${formData.isODRSuspension ? 'left-5' : 'left-1'}`} />
                      </button>
                      <div>
                        <div className={`text-xs font-bold ${formData.isODRSuspension ? 'text-amber-400' : 'text-slate-400'}`}>ODR 自发货权限申诉模式</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">启用后 AI 严格控制每段 700-950 字符，符合 Walmart 自发货申诉限制。</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Context */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-slate-200 font-bold flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">2</div>
                  案件背景
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">公司名称</label>
                    <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="Legal Entity Name" value={formData.companyName}
                      onChange={e => setFormData(p => ({ ...p, companyName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">店铺名称</label>
                    <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="Walmart Store Name" value={formData.storeName}
                      onChange={e => setFormData(p => ({ ...p, storeName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">Case/Ticket ID</label>
                    <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="Walmart Case #" value={formData.caseId}
                      onChange={e => setFormData(p => ({ ...p, caseId: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-slate-500 text-[11px] mb-1.5 block">受影响数量</label>
                    <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="如: 14 SKUs / 5 Orders" value={formData.affectedCount}
                      onChange={e => setFormData(p => ({ ...p, affectedCount: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="text-slate-500 text-[11px] mb-1.5 block">您认为的根本原因（中文简述）</label>
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-20 text-xs outline-none resize-none focus:border-blue-500/40 transition-colors"
                    placeholder="请简述：是什么导致了这次违规？例如：物流系统故障导致超时发货..."
                    value={formData.sellerExplanation}
                    onChange={e => setFormData(p => ({ ...p, sellerExplanation: e.target.value }))} />
                </div>
                <div>
                  <label className="text-slate-500 text-[11px] mb-1.5 block">已采取的应急措施（中文简述，可选）</label>
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 h-16 text-xs outline-none resize-none focus:border-blue-500/40 transition-colors"
                    placeholder="例如：已退款所有受影响订单，已删除相关 Listing..."
                    value={formData.actionsTaken}
                    onChange={e => setFormData(p => ({ ...p, actionsTaken: e.target.value }))} />
                </div>
              </div>

              {/* Section 3: Evidence */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-slate-200 font-bold flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">3</div>
                  证据文件注入
                </h3>
                <label className="relative flex items-center gap-3 border-2 border-dashed border-slate-700 rounded-xl p-4 cursor-pointer hover:border-slate-600 hover:bg-slate-800/30 transition-all group">
                  <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".xlsx,.xls,.csv,.txt,.docx" />
                  <UploadCloud size={20} className="text-slate-500 group-hover:text-slate-400 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-slate-400 font-medium">{fileName || '拖入或点击上传证据文件'}</div>
                    <div className="text-[10px] text-slate-600">支持 Excel / CSV / TXT / DOCX</div>
                  </div>
                  {fileName && <CheckCircle size={16} className="text-emerald-400 ml-auto flex-shrink-0" />}
                </label>
              </div>

              {/* Section 4: Reference */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-slate-200 font-bold flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-purple-600 text-white flex items-center justify-center text-xs font-bold">4</div>
                    参考成功案例
                  </h3>
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                    <input type="checkbox" className="accent-purple-500" checked={isAutoMatch}
                      onChange={e => setIsAutoMatch(e.target.checked)} />
                    智能匹配
                  </label>
                </div>
                <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                  value={selectedRefId} onChange={e => setSelectedRefId(e.target.value)}>
                  <option value="">— 不使用参考案例 —</option>
                  {references.filter(r => r.type === formData.violationType).map(r => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                  {references.filter(r => r.type !== formData.violationType).length > 0 && (
                    <optgroup label="— 其他类型 —">
                      {references.filter(r => r.type !== formData.violationType).map(r => (
                        <option key={r.id} value={r.id}>[{r.type}] {r.title}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {selectedRefId && (
                  <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle size={11} /> AI 将参考此成功案例的论证结构（前3000字）
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button onClick={handleGenerate} disabled={isGenerating}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex justify-center items-center gap-3 transition-all shadow-lg shadow-blue-900/30 text-base">
                {isGenerating ? <><Loader2 className="animate-spin" size={20}/> 正在生成...</> : <><Sparkles size={20}/> 生成 POA</>}
              </button>
            </div>

            {/* Right Panel */}
            <div className="col-span-7 flex flex-col gap-4 pb-8">
              {/* POA Output */}
              <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-950 border-b border-slate-800 p-3 flex justify-between items-center flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">POA 生成结果</span>
                    {formData.isODRSuspension && (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">ODR 限字模式</span>
                    )}
                    {generatedPOA && (
                      <span className="text-[10px] text-slate-600">{generatedPOA.length} 字符</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {generatedPOA && (
                      <>
                        <button onClick={() => exportPOAAsText(generatedPOA, formData.storeName || '')}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">
                          <FileDown size={14}/> TXT
                        </button>
                        <button onClick={handleCopy}
                          className={`flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-lg transition-colors ${copySuccess ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
                          {copySuccess ? <><CheckCircle size={14}/> 已复制</> : <><Copy size={14}/> 复制</>}
                        </button>
                        <button onClick={saveCurrentCase}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">
                          <Save size={14}/> 保存
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 p-5 overflow-auto">
                  {generatedPOA ? (
                    <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{generatedPOA}</pre>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-700">
                      <Sparkles size={40} className="mb-3 opacity-30"/>
                      <span className="text-sm">填写左侧信息，点击"生成 POA"</span>
                    </div>
                  )}
                </div>
              </div>

              {/* CN Quality Report */}
              <div className="h-52 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col flex-shrink-0">
                <div className="bg-slate-950 border-b border-slate-800 p-2.5 px-4 flex justify-between items-center flex-shrink-0">
                  <span className="text-xs font-bold text-slate-400">质检报告（中文）</span>
                  {generatedPOA && generatedCN && (
                    <button onClick={handleAutoFix} disabled={isFixing}
                      className="flex items-center gap-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors font-bold">
                      {isFixing ? <RefreshCw size={12} className="animate-spin"/> : <Wand2 size={12}/>} 一键精修
                    </button>
                  )}
                </div>
                <div className="flex-1 p-4 text-xs text-slate-400 overflow-auto whitespace-pre-wrap leading-relaxed">
                  {generatedCN || <span className="text-slate-700">生成 POA 后，质检报告将自动显示...</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════ HISTORY ════ */}
        {activeTab === TABS.HISTORY && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-200 flex items-center gap-2"><History size={22} className="text-blue-400"/> 案件历史库</h2>
              <span className="text-xs text-slate-500">共 {filteredCases.length} / {cases.length} 条</span>
            </div>

            {/* Filters */}
            <div className="flex gap-3 items-center flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-500/40 transition-colors"
                  placeholder="搜索店铺名、公司、Case ID..."
                  value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {(['all', 'pending', 'reviewed', 'submitted', 'success', 'fail'] as const).map(s => (
                  <button key={s} onClick={() => setHistoryFilter(s)}
                    className={`px-3 py-2 rounded-lg text-[11px] font-bold border transition-all ${historyFilter === s
                      ? (s === 'all' ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : STATUS_CONFIG[s]?.color || '')
                      : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-700'}`}>
                    {s === 'all' ? '全部' : STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>

            {filteredCases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-700">
                <History size={48} className="mb-4 opacity-20"/>
                <p className="text-base">{cases.length === 0 ? '还没有任何案件，先生成一份 POA 吧' : '没有符合筛选条件的案件'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCases.map(c => (
                  <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_CONFIG[c.status].color}`}>
                            {STATUS_CONFIG[c.status].icon} {STATUS_CONFIG[c.status].label}
                          </span>
                          <span className="text-xs font-bold text-slate-200">{c.storeName || '未命名店铺'}</span>
                          {c.companyName && <span className="text-xs text-slate-500">· {c.companyName}</span>}
                          <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{c.violationType}</span>
                          {c.isODRSuspension && <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">ODR</span>}
                        </div>
                        <div className="text-[11px] text-slate-600 flex gap-3 flex-wrap">
                          {c.caseId && <span>Case ID: {c.caseId}</span>}
                          {isAdmin && c.clientName && <span>操作人: {c.clientName}</span>}
                          <span>{new Date(c.createdAt).toLocaleString('zh-CN')}</span>
                          {c.walmartCaseNumber && <span className="text-indigo-400">Walmart: {c.walmartCaseNumber}</span>}
                        </div>
                        {c.poaContent && (
                          <div className="mt-2 text-[10px] text-slate-600 font-mono line-clamp-2 leading-relaxed">
                            {c.poaContent.substring(0, 150)}...
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => setReviewCase(c)}
                          className="flex items-center gap-1.5 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-1.5 rounded-lg font-bold transition-colors">
                          <Eye size={12}/> 查看/编辑
                        </button>
                        {isAdmin && (
                          <div className="flex gap-1.5">
                            {c.status !== 'success' && (
                              <button onClick={() => updateCaseStatus(c.id, 'success')}
                                className="flex items-center gap-1 text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-lg transition-colors">
                                <CheckCircle size={11}/> 标记成功
                              </button>
                            )}
                            {c.status !== 'fail' && (
                              <button onClick={() => updateCaseStatus(c.id, 'fail')}
                                className="flex items-center gap-1 text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-2 py-1 rounded-lg transition-colors">
                                <XCircle size={11}/> 标记失败
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ LIBRARY ════ */}
        {activeTab === TABS.LIBRARY && isAdmin && (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-200 flex items-center gap-2"><Library size={22} className="text-blue-400"/> 成功案例库</h2>
              <div className="flex gap-2">
                <input type="file" multiple className="hidden" ref={batchDocRef} onChange={handleBatchDocUpload}
                  accept=".txt,.docx,.xlsx,.csv" />
                <input type="file" className="hidden" ref={importJsonRef} onChange={handleImportJSON} accept=".json" />
                <button onClick={exportReferencesJSON}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                  <FileDown size={14}/> 导出 JSON
                </button>
                <button onClick={() => importJsonRef.current?.click()}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                  <Upload size={14}/> 导入 JSON
                </button>
                <button onClick={() => batchDocRef.current?.click()}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                  <UploadCloud size={14}/> 批量上传
                </button>
                <button onClick={() => setIsAddingRef(true)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                  <Plus size={14}/> 新增
                </button>
              </div>
            </div>

            {isAddingRef && (
              <div className="bg-slate-900/80 border border-blue-500/30 p-5 rounded-2xl space-y-3 shadow-xl">
                <div className="flex justify-between items-center">
                  <h3 className="text-white font-bold">录入新成功案例</h3>
                  <button onClick={() => setIsAddingRef(false)} className="text-slate-500 hover:text-white"><XCircle size={18}/></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                    placeholder="案例标题（如：Performance申诉成功-物流延迟）"
                    value={newRef.title} onChange={e => setNewRef(p => ({ ...p, title: e.target.value }))} />
                  <select className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs outline-none"
                    value={newRef.type} onChange={e => setNewRef(p => ({ ...p, type: e.target.value as any }))}>
                    <option value="Performance">Performance</option>
                    <option value="IP">IP</option>
                    <option value="Counterfeit">Counterfeit</option>
                    <option value="Related">Related</option>
                  </select>
                </div>
                <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 h-48 text-slate-300 text-xs font-mono leading-relaxed outline-none resize-none focus:border-blue-500/40 transition-colors"
                  placeholder="粘贴成功申诉的 POA 全文..."
                  value={newRef.content} onChange={e => setNewRef(p => ({ ...p, content: e.target.value }))} />
                <div className="flex justify-end gap-3">
                  <button onClick={() => setIsAddingRef(false)} className="text-slate-500 px-4 py-2 hover:text-slate-300">取消</button>
                  <button onClick={saveReference} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-xs transition-colors">保存入库</button>
                </div>
              </div>
            )}

            <div className="text-xs text-slate-500 flex gap-2 items-center">
              <Library size={13}/> 共 {references.length} 个案例
              {references.filter(r => r.type === 'Performance').length > 0 && <span className="bg-slate-800 px-2 py-0.5 rounded">Performance: {references.filter(r => r.type === 'Performance').length}</span>}
              {references.filter(r => r.type === 'IP').length > 0 && <span className="bg-slate-800 px-2 py-0.5 rounded">IP: {references.filter(r => r.type === 'IP').length}</span>}
              {references.filter(r => r.type === 'Counterfeit').length > 0 && <span className="bg-slate-800 px-2 py-0.5 rounded">Counterfeit: {references.filter(r => r.type === 'Counterfeit').length}</span>}
            </div>

            {references.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-700">
                <Library size={48} className="mb-4 opacity-20"/>
                <p className="text-base">案例库为空，上传或手动添加成功申诉案例</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {references.map(ref => (
                  <div key={ref.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 group relative hover:border-slate-700 transition-all">
                    <button onClick={() => deleteReference(ref.id)}
                      className="absolute top-3 right-3 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={15}/>
                    </button>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                        ref.type === 'Performance' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        ref.type === 'IP' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                        ref.type === 'Counterfeit' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                        'bg-slate-700 text-slate-400 border-slate-600'
                      }`}>{ref.type}</span>
                      {ref.successDate && <span className="text-[10px] text-slate-600">{ref.successDate}</span>}
                    </div>
                    <h3 className="text-slate-200 font-bold text-sm mb-2 pr-4 line-clamp-2">{ref.title}</h3>
                    <p className="text-slate-600 text-[10px] font-mono line-clamp-3 leading-relaxed">{ref.content.substring(0, 120)}...</p>
                    <div className="mt-3 text-[10px] text-slate-700">{ref.content.length} 字符</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ SETTINGS ════ */}
        {activeTab === TABS.SETTINGS && isAdmin && (
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-slate-200">设置与管理</h2>

            {/* Cloud DB - Super Admin only */}
            {currentUser?.role === 'super_admin' && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><Cloud size={20} className="text-emerald-500"/> 云端数据库 (Supabase)</h3>
                <div className={`flex items-center gap-3 p-3 rounded-xl border ${settings.supabaseUrl ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-slate-950 border-slate-800'}`}>
                  {settings.supabaseUrl ? <Wifi size={16} className="text-emerald-400"/> : <WifiOff size={16} className="text-slate-500"/>}
                  <span className={`text-sm font-bold ${settings.supabaseUrl ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {settings.supabaseUrl ? '已连接云端' : '离线模式'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { label: 'Project URL', key: 'supabaseUrl', placeholder: 'https://xyz.supabase.co', type: 'text' },
                    { label: 'Anon API Key', key: 'supabaseKey', placeholder: 'eyJhbGci...', type: 'password' },
                  ].map(({ label, key, placeholder, type }) => (
                    <div key={key}>
                      <label className="text-[11px] font-bold text-slate-500 uppercase mb-1.5 block">{label}</label>
                      <input type={type} placeholder={placeholder}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 outline-none focus:border-emerald-500/40 transition-colors text-xs"
                        value={(settings as any)[key]}
                        onChange={e => { const s = { ...settings, [key]: e.target.value }; setSettings(s); saveSettings(s); }} />
                    </div>
                  ))}
                </div>
                {settings.supabaseUrl && (
                  <button onClick={() => handleCloudSync(settings)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-colors">
                    <RefreshCw size={13} className={isCloudSyncing ? 'animate-spin' : ''}/> 测试连接并同步
                  </button>
                )}
              </div>
            )}

            {/* AI Engine */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><Server size={20}/> AI 引擎配置</h3>
              <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700 flex gap-6">
                {(['gemini', 'deepseek'] as const).map(provider => (
                  <label key={provider} className="flex items-center gap-3 cursor-pointer group">
                    <input type="radio" name="provider" checked={settings.selectedProvider === provider}
                      onChange={() => { const s = { ...settings, selectedProvider: provider }; setSettings(s); saveSettings(s); }}
                      className="accent-blue-500 w-4 h-4" />
                    <div>
                      <div className={`font-bold text-sm ${settings.selectedProvider === provider ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>
                        {provider === 'gemini' ? 'Google Gemini' : 'DeepSeek V3'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {provider === 'gemini' ? '速度快，免费额度高，默认推荐' : '逻辑强，中文理解极佳'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Google Gemini API Key', key: 'apiKey', provider: 'gemini' },
                  { label: 'DeepSeek API Key', key: 'deepseekKey', provider: 'deepseek' },
                ].map(({ label, key, provider }) => (
                  <div key={key} className={`space-y-2 p-3 rounded-xl border transition-all ${settings.selectedProvider === provider ? 'border-blue-500/40 bg-blue-500/5' : 'border-transparent'}`}>
                    <label className="text-[11px] font-bold text-slate-400 flex justify-between">
                      {label}
                      {settings.selectedProvider === provider && <span className="text-blue-400">● 当前激活</span>}
                    </label>
                    <input type="password" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      value={(settings as any)[key]}
                      onChange={e => { const s = { ...settings, [key]: e.target.value }; setSettings(s); saveSettings(s); }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><BrainCircuit size={20}/> 申诉策略配置</h3>
              {[
                { label: 'Performance / ODR 策略', key: 'strategyLogistics' },
                { label: 'IP / 版权侵权 策略', key: 'strategyIP' },
                { label: '通用 / 其他 策略', key: 'strategyGeneral' },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="text-xs font-bold text-slate-400 mb-1.5 block">{label}</label>
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 text-xs h-20 outline-none resize-none focus:border-blue-500/40 transition-colors"
                    placeholder={`输入 ${label} 的核心论证思路...`}
                    value={(settings as any)[key]}
                    onChange={e => { const s = { ...settings, [key]: e.target.value }; setSettings(s); saveSettings(s); }} />
                </div>
              ))}
            </div>

            {/* Walmart API */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><Send size={20}/> Walmart API 提交配置</h3>
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${settings.enableSimulationMode ? 'bg-amber-500/8 border-amber-500/20' : 'bg-slate-950 border-slate-800'}`}>
                <button onClick={() => { const s = { ...settings, enableSimulationMode: !settings.enableSimulationMode }; setSettings(s); saveSettings(s); }}
                  className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${settings.enableSimulationMode ? 'bg-amber-500' : 'bg-slate-700'}`}>
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${settings.enableSimulationMode ? 'left-5' : 'left-1'}`}/>
                </button>
                <div>
                  <div className={`text-xs font-bold ${settings.enableSimulationMode ? 'text-amber-400' : 'text-slate-400'}`}>
                    {settings.enableSimulationMode ? '模拟提交模式 (安全)' : '真实提交模式'}
                  </div>
                  <div className="text-[10px] text-slate-600">关闭后将通过 Walmart API 真实提交，需配置凭据</div>
                </div>
              </div>
              {!settings.enableSimulationMode && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Client ID', key: 'walmartClientId', placeholder: 'Client ID' },
                    { label: 'Client Secret', key: 'walmartClientSecret', placeholder: 'Client Secret' },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key}>
                      <label className="text-[11px] font-bold text-slate-500 uppercase mb-1.5 block">{label}</label>
                      <input type="password" placeholder={placeholder}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none"
                        value={(settings as any)[key]}
                        onChange={e => { const s = { ...settings, [key]: e.target.value }; setSettings(s); saveSettings(s); }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User Management */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2"><Users size={20}/> 账号管理</h3>
                <button onClick={() => setIsAddingUser(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors">
                  <UserPlus size={14}/> 新增账号
                </button>
              </div>

              {isAddingUser && (
                <form onSubmit={handleCreateUser} className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="用户名" value={newUserForm.username}
                      onChange={e => setNewUserForm(p => ({ ...p, username: e.target.value }))} />
                    <input required className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none focus:border-blue-500/40 transition-colors"
                      placeholder="初始密码 (≥4位)" value={newUserForm.password}
                      onChange={e => setNewUserForm(p => ({ ...p, password: e.target.value }))} />
                    <select className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none"
                      value={newUserForm.role} onChange={e => setNewUserForm(p => ({ ...p, role: e.target.value as UserRole }))}>
                      <option value="client">客户 (Client)</option>
                      {currentUser?.role === 'super_admin' && <option value="admin">管理员 (Admin)</option>}
                      {currentUser?.role === 'super_admin' && <option value="super_admin">超级管理员</option>}
                    </select>
                    <input className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs outline-none"
                      placeholder="所属公司 (可选)" value={newUserForm.companyName}
                      onChange={e => setNewUserForm(p => ({ ...p, companyName: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setIsAddingUser(false)} className="text-slate-500 px-4 py-2 hover:text-slate-300">取消</button>
                    <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold text-xs transition-colors">创建</button>
                  </div>
                </form>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-500 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="p-3">账号</th><th className="p-3">角色</th>
                      <th className="p-3">公司</th><th className="p-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {userList.map(user => (
                      <tr key={user.id} className="hover:bg-slate-800/30 group">
                        <td className="p-3 text-slate-300 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-500"><User size={12}/></div>
                            {user.username}
                            {user.id === currentUser?.id && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1 rounded">YOU</span>}
                          </div>
                        </td>
                        <td className="p-3">
                          {editingUserId === user.id ? (
                            <select className="bg-slate-950 border border-slate-700 rounded p-1 text-slate-200 text-xs"
                              value={editUserForm.role} onChange={e => setEditUserForm(p => ({ ...p, role: e.target.value as UserRole }))}>
                              <option value="client">客户</option>
                              {currentUser?.role === 'super_admin' && <option value="admin">管理员</option>}
                              {currentUser?.role === 'super_admin' && <option value="super_admin">超级管理员</option>}
                            </select>
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold flex w-fit items-center gap-1 border ${
                              user.role === 'super_admin' ? 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20' :
                              user.role === 'admin' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                              'bg-slate-800 text-slate-400 border-slate-700'}`}>
                              {user.role === 'super_admin' && <Crown size={9}/>}
                              {user.role.replace('_', ' ')}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-500 text-xs">
                          {editingUserId === user.id ? (
                            <input className="bg-slate-950 border border-slate-700 rounded p-1 text-slate-200 w-full text-xs"
                              value={editUserForm.companyName}
                              onChange={e => setEditUserForm(p => ({ ...p, companyName: e.target.value }))} />
                          ) : (user.companyName || '—')}
                        </td>
                        <td className="p-3 text-right">
                          {editingUserId === user.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleSaveEditUser(user.id)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle size={16}/></button>
                              <button onClick={() => setEditingUserId(null)} className="text-slate-500 hover:text-slate-300"><XCircle size={16}/></button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleResetPassword(user)} title="重置密码" className="text-blue-400 hover:text-blue-300"><KeyRound size={15}/></button>
                              {(currentUser?.role === 'super_admin' || (currentUser?.role === 'admin' && user.role === 'client')) && (
                                <button onClick={() => { setEditingUserId(user.id); setEditUserForm({ role: user.role, companyName: user.companyName || '' }); }} title="编辑" className="text-amber-400 hover:text-amber-300"><Edit2 size={15}/></button>
                              )}
                              {user.id !== currentUser?.id && (currentUser?.role === 'super_admin' || (currentUser?.role === 'admin' && user.role === 'client')) && (
                                <button onClick={() => handleDeleteUser(user.id)} title="删除" className="text-rose-400 hover:text-rose-300"><Trash2 size={15}/></button>
                              )}
                            </div>
                          )}
                        </td>
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

// ─── Login Screen ──────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }: { onLogin: (user: UserType) => void }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = isRegister
        ? registerUser(username.trim(), password, 'client', '')
        : loginUser(username.trim(), password);
      onLogin(user);
    } catch (err: any) { alert(err.message); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/30 via-transparent to-indigo-950/20 pointer-events-none"/>
      <div className="w-full max-w-sm p-8 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-xl relative">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">泽远跨境</h1>
          <p className="text-slate-500 text-xs mt-1">POA 智能申诉系统 V6</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase mb-1.5 block">账号</label>
            <input required className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 outline-none focus:border-blue-500/50 transition-colors"
              placeholder="输入用户名" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase mb-1.5 block">密码</label>
            <div className="relative">
              <input required type={showPwd ? 'text' : 'password'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 pr-10 outline-none focus:border-blue-500/50 transition-colors"
                placeholder="输入密码" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPwd(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPwd ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>
          {isRegister && (
            <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              首次注册的账号将自动成为<strong>超级管理员</strong>（如系统还没有任何账号）
            </div>
          )}
          <button type="submit" disabled={isLoading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all flex justify-center items-center gap-2">
            {isLoading ? <Loader2 size={18} className="animate-spin"/> : null}
            {isRegister ? '注册账号' : '登录'}
          </button>
        </form>
        <div className="mt-5 text-center">
          <button onClick={() => setIsRegister(p => !p)} className="text-slate-600 hover:text-slate-400 text-xs transition-colors">
            {isRegister ? '已有账号？返回登录' : '创建新账号'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
