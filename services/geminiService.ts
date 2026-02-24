import { GoogleGenAI } from "@google/genai";
import { CaseData, GlobalSettings, ReferenceCase, RiskAnalysis } from "../types";

// --- DeepSeek ---
const callDeepSeek = async (apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> => {
  if (!apiKey) throw new Error("DeepSeek API Key 未配置");
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      stream: false, temperature: 0.7, max_tokens: 8192
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`DeepSeek Error: ${err.error?.message || response.statusText}`);
  }
  const data = await response.json();
  return data.choices[0]?.message?.content || "DeepSeek returned empty content.";
};

// --- Gemini (FIXED model name) ---
const callGemini = async (apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> => {
  if (!apiKey) throw new Error("Google Gemini API Key 未配置");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',  // FIXED: was 'gemini-3-flash-preview' (non-existent)
    config: { maxOutputTokens: 8192, temperature: 0.7 },
    contents: [{ role: 'user', parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }]
  });
  return response.text || "Generation failed.";
};

const callAI = async (provider: string, apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> => {
  if (provider === 'deepseek') return callDeepSeek(apiKey, systemPrompt, userPrompt);
  return callGemini(apiKey, systemPrompt, userPrompt);
};

// --- Main POA Generator ---
export const generatePOA = async (
  apiKey: string,
  data: Partial<CaseData>,
  settings: GlobalSettings,
  riskAnalysis: RiskAnalysis,   // FIXED: pass full RiskAnalysis, not just reasons
  fileEvidence: string,
  similarCase?: ReferenceCase
): Promise<string> => {
  const provider = settings.selectedProvider || 'gemini';
  const effectiveKey = provider === 'deepseek' ? settings.deepseekKey : settings.apiKey;
  if (!effectiveKey) throw new Error(`请先配置 ${provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} API Key`);

  const isODR = data.isODRSuspension === true;

  // --- Build strategy ---
  let logicStrategy = "";
  if (similarCase) {
    // FIXED: was substring(0, 300), now 3000 — gives AI enough context to learn the argument structure
    logicStrategy = `
**REFERENCE LOGIC CLONING**:
You have a verified successful appeal case. Adapt its core argument structure to this case.
Change all specific details (names, dates, order IDs) to match the current case.
Reference Logic (first 3000 chars):
${similarCase.content.substring(0, 3000)}
    `;
  } else {
    if (data.violationType === 'Performance') logicStrategy = settings.strategyLogistics;
    else if (data.violationType === 'IP') logicStrategy = settings.strategyIP;
    else logicStrategy = settings.strategyGeneral;
  }

  // FIXED: Risk-adaptive tone instruction
  const toneInstruction = riskAnalysis.toneInstruction;

  let systemPrompt = "";

  if (isODR) {
    systemPrompt = `
You are a **Senior Walmart Appeal Specialist**.
The user is appealing an **ODR / Delivery Performance Suspension** (Self-Fulfilled).

**CRITICAL CONSTRAINT: CHARACTER LIMIT**
- Each section MUST be between 700 and 950 characters.
- DO NOT exceed 1000 characters per section.
- Be concise, direct, and data-driven.

**TONE DIRECTIVE**: ${toneInstruction}

**CORE LOGIC (3-Point Failure Framework)**:
1. Operational failure (carrier/logistics issue)
2. Technical failure (system/software issue)
3. Management failure (oversight/process gap)
Each section MUST cite specific Order IDs or Tracking Numbers from the evidence.
Auto-generate realistic names (e.g., Mr. Wang), specific dates, and tool names (e.g., ShipStation).

**OUTPUT FORMAT** (STRICTLY follow these tags):
[SECTION 1: ROOT CAUSE ANALYSIS]
(700-950 chars. 3 failure layers. Cite Order IDs.)

[SECTION 2: IMMEDIATE CORRECTIVE ACTIONS]
(700-950 chars. Refunds, carrier changes, buyer outreach. Bullet points if space permits.)

[SECTION 3: LONG-TERM PREVENTATIVE PLAN]
(700-950 chars. Named person, specific tool, specific date. Show this is systemic, not reactive.)

${logicStrategy ? `**STRATEGY**: ${logicStrategy}` : ''}
    `;
  } else {
    systemPrompt = `
You are a **Senior Litigation Attorney & Data Analyst** for Walmart Marketplace Sellers.
Write a professional, structured Plan of Action (POA) that maximizes reinstatement probability.

**TONE DIRECTIVE**: ${toneInstruction}

**MANDATORY 7-SECTION STRUCTURE**:

1. **Opening Statement**
   - Acknowledge suspension, state store name and company, express full responsibility.

2. **Root Cause Analysis**
   - MANDATORY: Analyze failure from EXACTLY 3 distinct layers: Operational, Technical, Management.
   - Bind evidence: cite specific Order IDs from the evidence pool.

3. **Immediate Actions Taken** (Past Tense)
   - MINIMUM 5 DISTINCT numbered actions.
   - Cover: refunds, listing removal, staff meetings, inventory review, technical audits.
   - Explain WHY each action was taken. Do not be brief.

4. **Long-Term Preventative Plan** (Future-Oriented)
   - MINIMUM 5 DISTINCT numbered measures.
   - Cover: ERP/WMS software, supplier vetting, staff training schedules, QC protocols, packaging.
   - Focus on systemic and process changes.

5. **Implementation Details** (PROVES the plan is real)
   - For EVERY point in Section 4, provide concrete execution detail.
   - Auto-generate: "Compliance Manager **Mr. [Name]** appointed on [Date]"
   - Auto-generate: "Subscribed to **[Tool: ShipStation/Sellbrite/Helium10]** on [Date]"
   - Auto-generate: "Engaged **[Law Firm / Agency Name]** for IP audit"

6. **Conclusion**
   - Reiterate commitment to Walmart policy. Respectfully request reinstatement.

7. **Signature**
   - [Company Name], [Store Name], ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}

**FORMAT RULES**:
- No markdown code blocks. Use clean section headers like **I. Opening Statement**.
- Write full paragraphs. Expand every point. Show thoroughness.

${logicStrategy ? `**STRATEGY GUIDE**: ${logicStrategy}` : ''}
    `;
  }

  const userPrompt = `
**CASE METADATA**:
- Store: ${data.storeName || '[Store Name]'}
- Company: ${data.companyName || '[Company Name]'}
- Walmart Case/Reference ID: ${data.caseId || 'N/A'}
- Violation Type: ${data.violationType}
- Supply Chain: ${data.supplyChain}
- Appeal Mode: ${isODR ? "ODR / Self-Fulfilled Delivery Performance" : "Standard Account Suspension (7-Section)"}
- Affected SKUs/Orders: ${data.affectedCount || 'Not specified'}
- Supplier Info: ${data.supplierInfo || 'Not specified'}

**SELLER'S EXPLANATION**:
${data.sellerExplanation || 'Please deduce from violation type and context.'}

**ACTIONS ALREADY TAKEN**:
${data.actionsTaken || 'Please propose standard industry best-practice fixes.'}

**RISK CONTEXT** (for tone calibration):
Risk Level: ${riskAnalysis.level} (Score: ${riskAnalysis.score}/100)
Risk Signals: ${riskAnalysis.reasons.join('; ')}

**EVIDENCE POOL (RAW DATA)**:
${fileEvidence || 'No file provided. Use realistic placeholder Order IDs like [Order #7739284651823].'}

**WALMART SUSPENSION NOTICE**:
"""
${data.suspensionEmail || '[No suspension email provided]'}
"""

**INSTRUCTION**:
Draft the complete POA now.
${isODR
  ? "Strictly follow 3-section ODR format. Each section MUST be 700-950 characters."
  : "Follow 7-section structure. Sections 3 & 4 MUST have ≥5 numbered points each. Section 5 MUST have specific names, tools, and dates."
}
  `;

  try {
    return await callAI(provider, effectiveKey, systemPrompt, userPrompt);
  } catch (error: any) {
    throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} 错误: ${error.message}`);
  }
};

// --- CN Quality Report (FIXED: takes settings as param, not reads localStorage) ---
export const generateCNExplanation = async (
  poa: string,
  suspensionEmail: string,
  settings: GlobalSettings
): Promise<string> => {
  const provider = settings.selectedProvider || 'gemini';
  const effectiveKey = provider === 'deepseek' ? settings.deepseekKey : settings.apiKey;
  if (!effectiveKey) return "未配置 API Key，无法生成质检报告。";

  const systemPrompt = "你是一名资深沃尔玛风控质检专家。请用中文作出清晰的质检报告，并在报告末尾附上一段英文的[ISSUES_FOR_AUTOFIX]，列出所有需要修正的问题，供自动修复模块使用。";

  const userPrompt = `
请对以下 POA 进行严格的中文质检，分为以下维度：

**1. 完整性核查**：是否涵盖所有必要章节？

**2. 细节核查**（最重要）：
   - ✅ 是否有具体负责人姓名（如 Mr. Wang）？
   - ✅ 是否有具体整改日期？
   - ✅ 是否有具体物流商/工具名称（如 FedEx、ShipStation）？
   - ✅ 是否引用了具体订单号？
   - ❌ 如果以上任意一项缺失，请明确标记为「待补充」

**3. 逻辑核查**：是否清晰体现运营/技术/管理三层根本原因？

**4. 风险提示**：对 AI 自动生成的虚构细节（姓名/公司/日期），提醒客户核实或替换为真实信息。

**5. 综合评分**：满分10分，结合上述维度给出评分和简评。

---
[待检 POA 内容]:
${poa.substring(0, 12000)}

---
请在报告最后用英文附上：
[ISSUES_FOR_AUTOFIX]
(List all specific issues that need to be fixed in the POA, as clear English bullet points. If the POA looks good, write "No critical issues found.")
  `;

  try {
    return await callAI(provider, effectiveKey, systemPrompt, userPrompt);
  } catch {
    return "质检报告生成失败 (API Error)";
  }
};

// --- Auto Fix POA (FIXED: extracts English issues list for better AI comprehension) ---
export const autoFixPOA = async (
  currentPOA: string,
  feedback: string,
  settings: GlobalSettings
): Promise<string> => {
  const provider = settings.selectedProvider || 'gemini';
  const effectiveKey = provider === 'deepseek' ? settings.deepseekKey : settings.apiKey;
  if (!effectiveKey) throw new Error("API Key 未配置");

  // FIXED: Extract the English issues section for clean AI input
  const issuesMatch = feedback.match(/\[ISSUES_FOR_AUTOFIX\]([\s\S]*?)(?:$)/i);
  const englishIssues = issuesMatch ? issuesMatch[1].trim() : feedback;

  const systemPrompt = `
You are a **Senior Walmart Appeal Specialist** refining a POA draft.
Your task: FIX the POA based on the provided issues list.

**AUTO-GENERATION RULES** (Apply immediately, do NOT ask the user):
- Missing person name → Invent: "Compliance Manager Mr. Chen Wei"
- Missing date → Use: "${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}"
- Missing tool → Use: "ShipStation for shipping / Helium10 for listing management"
- Missing order IDs → Use placeholder: "[Order #7739284651823]"
- Missing law firm → Use: "Hansen & Associates IP Law Firm"

**FORMAT RULES**:
- If input POA uses [SECTION X] tags (ODR style) → MAINTAIN that format and character limits.
- Otherwise → Maintain standard 7-section letter format.
- Return ONLY the complete corrected POA. No preamble, no comments.
  `;

  const userPrompt = `
[DRAFT POA TO FIX]:
${currentPOA}

[ISSUES TO ADDRESS]:
${englishIssues}
  `;

  try {
    return await callAI(provider, effectiveKey, systemPrompt, userPrompt);
  } catch (error: any) {
    throw new Error(`Auto-Fix Failed: ${error.message}`);
  }
};
