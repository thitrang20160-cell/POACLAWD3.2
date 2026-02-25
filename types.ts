export type ViolationType = 'IP' | 'Counterfeit' | 'Performance' | 'Related' | 'Other';
export type SupplyChainType = 'Private Label' | 'Authorized Distributor' | 'Wholesale' | 'Dropshipping';
export type CaseStatus = 'pending' | 'reviewed' | 'submitted' | 'success' | 'fail';
export type UserRole = 'super_admin' | 'admin' | 'client';
export type AIProvider = 'gemini' | 'deepseek';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  companyName?: string;
  createdAt?: string;
}

// ── 新增: 店铺档案（员工记忆）──────────────────────────────────────
export interface StoreProfile {
  id: string;
  storeName: string;
  companyName: string;
  supplyChain: SupplyChainType;
  productCategory?: string;
  supplierInfo?: string;
  createdAt: string;
}

// ── 新增: 管理员批注 ─────────────────────────────────────────────────
export interface CaseNote {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  requiresAction: boolean; // 标记是否需要员工跟进
  resolved: boolean;
}

// ── 新增: POA 大纲（两阶段生成）──────────────────────────────────────
export interface POAOutlineSection {
  id: string;
  title: string;
  keyPoints: string[];
  adminNote?: string;   // 管理员对本节的特别指示
}

export interface POAOutline {
  overallStrategy: string;
  riskSummary: string;
  sections: POAOutlineSection[];
  adminDirective?: string;  // 管理员全局特别要求（最高优先级）
}

export interface CaseData {
  id: string;
  userId: string;
  createdAt: string;
  clientName?: string;
  companyName: string;
  caseId: string;
  storeName: string;
  productCategory: string;
  supplyChain: SupplyChainType;
  violationType: ViolationType;
  suspensionEmail: string;
  sellerExplanation: string;
  actionsTaken: string;
  affectedCount?: string;
  supplierInfo?: string;
  poaContent: string;
  cnExplanation: string;
  status: CaseStatus;
  notes?: string;
  fileEvidenceSummary?: string;
  submissionTime?: string;
  walmartCaseNumber?: string;
  isODRSuspension?: boolean;
  // ── 新增字段 ──
  adminNotes?: CaseNote[];       // 管理员批注列表
  failureAnalysis?: string;      // AI 失败原因分析
  outlineSnapshot?: string;      // 已确认的大纲（JSON string）
}

export interface ReferenceCase {
  id: string;
  title: string;
  type: ViolationType;
  content: string;
  tags: string[];
  successDate?: string;
  autoSaved?: boolean; // 是否由系统自动入库
  sourceViolationType?: string;
  sourceCaseId?: string;
}

export interface RiskAnalysis {
  score: number;
  level: 'Low' | 'Medium' | 'High';
  reasons: string[];
  toneInstruction: string;
}

export interface GlobalSettings {
  selectedProvider: AIProvider;
  apiKey: string;
  deepseekKey: string;
  supabaseUrl: string;
  supabaseKey: string;
  enableSimulationMode: boolean;
  strategyGeneral: string;
  strategyLogistics: string;
  strategyIP: string;
}
