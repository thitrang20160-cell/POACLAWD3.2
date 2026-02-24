import { GoogleGenAI } from "@google/genai";
import { CaseData, GlobalSettings, ReferenceCase, RiskAnalysis, POAOutline, POAOutlineSection } from "../types";

// ── AI 调用层 ──────────────────────────────────────────────────────────
const callDeepSeek = async (key: string, sys: string, user: string): Promise<string> => {
  if (!key) throw new Error("DeepSeek API Key 未配置");
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.7, max_tokens: 8192 })
  });
  if (!r.ok) { const e = await r.json(); throw new Error(`DeepSeek: ${e.error?.message || r.statusText}`); }
  return (await r.json()).choices[0]?.message?.content || '';
};

const callGemini = async (key: string, sys: string, user: string): Promise<string> => {
  if (!key) throw new Error("Gemini API Key 未配置");
  const ai = new GoogleGenAI({ apiKey: key });
  const r = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    config: { maxOutputTokens: 8192, temperature: 0.7 },
    contents: [{ role: 'user', parts: [{ text: sys + "\n\n" + user }] }]
  });
  return r.text || '';
};

const callAI = (settings: GlobalSettings, sys: string, user: string): Promise<string> => {
  const p = settings.selectedProvider || 'gemini';
  const k = p === 'deepseek' ? settings.deepseekKey : settings.apiKey;
  if (!k) throw new Error(`请先在设置页配置 ${p === 'deepseek' ? 'DeepSeek' : 'Gemini'} API Key`);
  return p === 'deepseek' ? callDeepSeek(k, sys, user) : callGemini(k, sys, user);
};

// ── 工具函数 ──────────────────────────────────────────────────────────
const buildBaseContext = (data: Partial<CaseData>, risk: RiskAnalysis, fileEvidence: string, similarCase?: ReferenceCase) => `
**CASE METADATA**:
- Store: ${data.storeName || '[Store Name]'} | Company: ${data.companyName || '[Company Name]'}
- Case ID: ${data.caseId || 'N/A'} | Violation: ${data.violationType} | Supply Chain: ${data.supplyChain}
- Affected: ${data.affectedCount || 'N/A'} | ODR Mode: ${data.isODRSuspension ? 'YES' : 'NO'}
- Seller Explanation: ${data.sellerExplanation || 'Not provided'}
- Actions Taken: ${data.actionsTaken || 'Not provided'}

**RISK**: ${risk.level} (Score ${risk.score}/100) — ${risk.reasons.join('; ')}
**TONE**: ${risk.toneInstruction}

**EVIDENCE**:
${fileEvidence || 'No file. Use placeholder order IDs like [Order #7739284651823].'}

**WALMART NOTICE**:
"""
${data.suspensionEmail || '[No notice provided]'}
"""

${similarCase ? `**REFERENCE CASE** (successful appeal — adapt its argument structure):
${similarCase.content.substring(0, 3000)}` : ''}
`;

// ═══════════════════════════════════════════════════════════════════════
// 1. 生成 POA 大纲（两阶段第一步）
// ═══════════════════════════════════════════════════════════════════════
export const generatePOAOutline = async (
  data: Partial<CaseData>,
  settings: GlobalSettings,
  risk: RiskAnalysis,
  fileEvidence: string,
  similarCase?: ReferenceCase
): Promise<POAOutline> => {
  const isODR = data.isODRSuspension === true;

  const sys = `You are a senior Walmart appeal strategist.
Your job is to create a strategic OUTLINE for a Plan of Action (POA), NOT the full document.
The outline helps the operator review and adjust the argumentation strategy before AI writes the full text.

Return ONLY valid JSON matching this exact schema (no markdown, no preamble):
{
  "overallStrategy": "One sentence describing the core appeal strategy",
  "riskSummary": "One sentence summarizing the risk level and key concerns",
  "sections": [
    {
      "id": "s1",
      "title": "Section title (e.g. Root Cause Analysis)",
      "keyPoints": ["Point 1", "Point 2", "Point 3"]
    }
  ]
}

${isODR
  ? 'For ODR: produce exactly 3 sections (Root Cause, Immediate Actions, Future Plan). Each section gets 3-5 key points.'
  : 'For standard: produce exactly 7 sections matching the 7-part POA structure. Each section gets 3-6 key points.'}

Make key points SPECIFIC and DATA-DRIVEN based on the case context provided. NOT generic.`;

  const user = buildBaseContext(data, risk, fileEvidence, similarCase);

  const raw = await callAI(settings, sys, user);
  // Strip possible markdown fences
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(clean) as POAOutline;
  } catch {
    // Fallback: construct a basic outline if JSON parsing fails
    const fallback: POAOutline = {
      overallStrategy: '请根据下方编辑区修改大纲策略',
      riskSummary: `风险等级: ${risk.level}，请仔细核对违规内容`,
      sections: isODR
        ? [
            { id: 's1', title: 'Root Cause Analysis', keyPoints: ['[请填写根本原因]'] },
            { id: 's2', title: 'Immediate Actions', keyPoints: ['[请填写即时措施]'] },
            { id: 's3', title: 'Future Prevention Plan', keyPoints: ['[请填写长期预防措施]'] },
          ]
        : [
            { id: 's1', title: 'Opening Statement', keyPoints: ['[请填写]'] },
            { id: 's2', title: 'Root Cause Analysis (3 Layers)', keyPoints: ['[请填写]'] },
            { id: 's3', title: 'Immediate Actions (≥5)', keyPoints: ['[请填写]'] },
            { id: 's4', title: 'Long-Term Prevention Plan (≥5)', keyPoints: ['[请填写]'] },
            { id: 's5', title: 'Implementation Details', keyPoints: ['[请填写]'] },
            { id: 's6', title: 'Conclusion', keyPoints: ['[请填写]'] },
            { id: 's7', title: 'Signature', keyPoints: ['[公司名称、店铺名称、日期]'] },
          ],
    };
    return fallback;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 2. 根据确认的大纲展开完整 POA（两阶段第二步）
// ═══════════════════════════════════════════════════════════════════════
export const expandOutlineToPOA = async (
  outline: POAOutline,
  data: Partial<CaseData>,
  settings: GlobalSettings,
  risk: RiskAnalysis,
  fileEvidence: string,
  similarCase?: ReferenceCase
): Promise<string> => {
  const isODR = data.isODRSuspension === true;

  const outlineText = outline.sections.map((s, i) =>
    `${i + 1}. ${s.title}\n${s.keyPoints.map(p => `   - ${p}`).join('\n')}`
  ).join('\n\n');

  const sys = `You are a Senior Walmart Appeal Attorney.
The operator has APPROVED the following strategic outline. Your job is to expand it into a complete, professional POA.

**APPROVED OUTLINE** (follow this EXACTLY — do not add or remove sections):
Overall Strategy: ${outline.overallStrategy}
${outlineText}

**EXPANSION RULES**:
${isODR
  ? `- ODR MODE: 3 sections, each 700-950 characters. Use [SECTION X: TITLE] tags.
- Cite specific Order IDs or Tracking Numbers from evidence.
- Auto-generate realistic names (Mr. Chen), dates, and tool names (ShipStation).`
  : `- STANDARD MODE: 7 sections with headers like **I. Opening Statement**.
- Section 3 (Immediate Actions): expand each key point into full paragraph with PAST TENSE. Minimum 5 distinct actions.
- Section 4 (Future Plan): expand each key point into full paragraph. Minimum 5 measures.
- Section 5 (Implementation Details): for EVERY Section 4 point, provide a specific name, date, and tool.
- Auto-generate: "Compliance Manager Mr. [Name]" / "Subscribed to ShipStation on [Date]" / "Engaged Hansen & Associates IP Law Firm".`}

**TONE**: ${risk.toneInstruction}
Return ONLY the complete POA text. No preamble, no meta-comments.`;

  const user = buildBaseContext(data, risk, fileEvidence, similarCase) +
    `\n\n**CONFIRMED OUTLINE TO EXPAND**:\n${outlineText}`;

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return (await callAI(settings, sys + `\n\nToday's date: ${today}`, user)).trim();
};

// ═══════════════════════════════════════════════════════════════════════
// 3. 一键生成完整 POA（兼容旧流程）
// ═══════════════════════════════════════════════════════════════════════
export const generatePOA = async (
  _apiKey: string,
  data: Partial<CaseData>,
  settings: GlobalSettings,
  risk: RiskAnalysis,
  fileEvidence: string,
  similarCase?: ReferenceCase
): Promise<string> => {
  // 内部直接调用两步流程，对外保持兼容
  const outline = await generatePOAOutline(data, settings, risk, fileEvidence, similarCase);
  return expandOutlineToPOA(outline, data, settings, risk, fileEvidence, similarCase);
};

// ═══════════════════════════════════════════════════════════════════════
// 4. 中文质检报告（修正：通过 settings 参数传入，不读 localStorage）
// ═══════════════════════════════════════════════════════════════════════
export const generateCNExplanation = async (
  poa: string,
  suspensionEmail: string,
  settings: GlobalSettings
): Promise<string> => {
  const sys = '你是资深沃尔玛风控质检专家。用中文出具质检报告，并在末尾附加英文[ISSUES_FOR_AUTOFIX]供自动修复使用。';
  const user = `请对以下 POA 进行严格质检：

**1. 完整性**：是否涵盖所有必要章节？

**2. 细节核查**（最重要）：
- ✅ 是否有具体负责人姓名（如 Mr. Wang）？
- ✅ 是否有具体整改日期？
- ✅ 是否有具体物流商/工具名（FedEx、ShipStation 等）？
- ✅ 是否引用具体订单号？
- ❌ 任意缺失 → 标记「待补充」

**3. 逻辑核查**：是否体现运营/技术/管理三层根本原因？

**4. 风险提示**：列出 AI 虚构细节（姓名/公司/日期），提醒核实。

**5. 综合评分**（满分10分）

---
[POA 内容]:
${poa.substring(0, 12000)}

---
最后用英文附上：
[ISSUES_FOR_AUTOFIX]
(Bullet points of specific issues. Write "No critical issues." if all good.)`;

  try { return await callAI(settings, sys, user); }
  catch { return '质检报告生成失败 (API Error)'; }
};

// ═══════════════════════════════════════════════════════════════════════
// 5. 一键精修 POA
// ═══════════════════════════════════════════════════════════════════════
export const autoFixPOA = async (poa: string, feedback: string, settings: GlobalSettings): Promise<string> => {
  const issuesMatch = feedback.match(/\[ISSUES_FOR_AUTOFIX\]([\s\S]*?)(?:$)/i);
  const issues = issuesMatch ? issuesMatch[1].trim() : feedback;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const sys = `You are a Senior Walmart Appeal Specialist refining a POA draft.
AUTO-GENERATION (apply immediately, DO NOT ask user):
- Missing name → "Compliance Manager Mr. Chen Wei"
- Missing date → "${today}"
- Missing tool → "ShipStation / Helium10"
- Missing order ID → "[Order #7739284651823]"
- Missing law firm → "Hansen & Associates IP Law Firm"
Maintain original format ([SECTION X] for ODR, or 7-section for standard).
Return ONLY the corrected POA text. No preamble.`;

  const user = `[DRAFT POA]:\n${poa}\n\n[ISSUES TO FIX]:\n${issues}`;
  return callAI(settings, sys, user);
};

// ═══════════════════════════════════════════════════════════════════════
// 6. 失败案例 AI 分析（新增）
// ═══════════════════════════════════════════════════════════════════════
export const analyzeFailedCase = async (
  caseData: CaseData,
  settings: GlobalSettings
): Promise<string> => {
  const sys = '你是资深沃尔玛申诉顾问，专门分析失败案例，提供改进方向。用中文输出分析报告。';
  const user = `以下是一个申诉失败的 Walmart 案件，请深入分析失败原因并给出改进建议。

**违规类型**: ${caseData.violationType}
**违规邮件**:
${caseData.suspensionEmail?.substring(0, 2000) || '未提供'}

**提交的 POA（节选）**:
${caseData.poaContent?.substring(0, 4000) || '未提供'}

**质检报告**:
${caseData.cnExplanation?.substring(0, 2000) || '未提供'}

请按以下结构输出分析：

## 🔍 失败原因分析
（列出 3-5 个可能导致失败的核心原因，结合 POA 内容具体指出）

## ⚠️ 关键缺失点
（POA 中缺少了哪些 Walmart 审核官最看重的内容）

## 💡 下次改进建议
（如果重新申诉，应该如何调整策略和内容，给出具体操作建议）

## 📋 参考成功案例特征
（此类违规的成功申诉通常有哪些共同特征，帮助下次参考）`;

  return callAI(settings, sys, user);
};

// ═══════════════════════════════════════════════════════════════════════
// 7. 策略自动迭代（新增）
// ═══════════════════════════════════════════════════════════════════════
export const iterateStrategies = async (
  successCases: CaseData[],
  currentStrategies: { performance: string; ip: string; general: string },
  settings: GlobalSettings
): Promise<{ performance: string; ip: string; general: string }> => {
  const performanceCases = successCases.filter(c => c.violationType === 'Performance' || c.isODRSuspension);
  const ipCases = successCases.filter(c => c.violationType === 'IP' || c.violationType === 'Counterfeit');

  const buildSample = (cases: CaseData[], max = 3) =>
    cases.slice(0, max).map((c, i) =>
      `案例${i + 1}（${c.violationType}）:\n${c.poaContent?.substring(0, 800) || '内容缺失'}`
    ).join('\n\n---\n\n');

  const sys = '你是 Walmart 申诉策略专家。通过分析成功案例，提炼高效的申诉策略模板。只输出 JSON，不输出任何其他内容。';
  const user = `以下是历史成功申诉案例（共 ${successCases.length} 个）。
请分析这些成功案例的共同特征，更新以下三个策略描述。

**Performance/ODR 成功案例样本**:
${buildSample(performanceCases) || '暂无此类成功案例，保持现有策略'}

**IP/Counterfeit 成功案例样本**:
${buildSample(ipCases) || '暂无此类成功案例，保持现有策略'}

**其他类型成功案例**:
${buildSample(successCases.filter(c => c.violationType === 'Related' || c.violationType === 'Other'))}

**当前策略（供参考）**:
Performance: ${currentStrategies.performance}
IP: ${currentStrategies.ip}
General: ${currentStrategies.general}

请输出一个 JSON 对象，键为 "performance"、"ip"、"general"，值为优化后的中文策略描述（每条 100-200 字）。
只输出 JSON，不要任何注释或 markdown 代码块。`;

  try {
    const raw = await callAI(settings, sys, user);
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      performance: parsed.performance || currentStrategies.performance,
      ip: parsed.ip || currentStrategies.ip,
      general: parsed.general || currentStrategies.general,
    };
  } catch {
    throw new Error('策略解析失败，请重试');
  }
};
