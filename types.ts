export type ViolationType = 'IP' | 'Counterfeit' | 'Performance' | 'Related' | 'Other';
export type SupplyChainType = 'Private Label' | 'Authorized Distributor' | 'Wholesale' | 'Dropshipping';
export type CaseStatus = 'pending' | 'reviewed' | 'submitted' | 'rejected' | 'success' | 'fail';
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
}

export interface ReferenceCase {
  id: string;
  title: string;
  type: ViolationType;
  content: string;
  tags: string[];
  successDate?: string;
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
  walmartClientId: string;
  walmartClientSecret: string;
  enableSimulationMode: boolean;
  strategyGeneral: string;
  strategyLogistics: string;
  strategyIP: string;
}
