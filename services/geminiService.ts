import { GoogleGenAI } from "@google/genai";
import { CaseData, GlobalSettings, ReferenceCase, RiskAnalysis, POAOutline } from "../types";

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

/**
 * 从案例库中智能检索最相关的Top-N案例
 * 算法：同类型优先 + 关键词重叠度排序
 */
export const findTopReferences = (
  refs: ReferenceCase[],
  violationType: string,
  suspensionEmail: string,
  topN = 3
): ReferenceCase[] => {
  if (!refs.length) return [];

  const tokenize = (s: string) =>
    new Set((s || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));

  const emailTokens = tokenize(suspensionEmail);

  const scored = refs.map(r => {
    const typeMatch = r.type === violationType ? 0.4 : 0;
    const contentTokens = tokenize(r.content);
    const overlap = [...emailTokens].filter(t => contentTokens.has(t)).length;
    const jaccard = emailTokens.size + contentTokens.size > 0
      ? overlap / (emailTokens.size + contentTokens.size - overlap)
      : 0;
    return { ref: r, score: typeMatch + jaccard };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(x => x.ref);
};

/**
 * 把多个参考案例组合成一段精华摘要注入 prompt
 * 每个案例取前1000字，总共不超过4000字
 */
const buildRefDigest = (refs: ReferenceCase[]): string => {
  if (!refs.length) return '';
  const snippets = refs.map((r, i) =>
    `--- Reference ${i + 1}: "${r.title}" [${r.type}] ---\n${r.content.substring(0, 1200).trim()}`
  );
  return `**REFERENCE CASES** (${refs.length} successful appeals — learn their argument structure, tone, and evidence patterns):
${snippets.join('\n\n')}

Key patterns to replicate: specific timelines, named corrective actions, quantified metrics, supplier/carrier accountability.`;
};

const buildBaseContext = (
  data: Partial<CaseData>,
  risk: RiskAnalysis,
  fileEvidence: string,
  similarCase?: ReferenceCase,       // 兼容旧调用（单案例手选）
  topRefs?: ReferenceCase[]          // 新：多案例智能检索结果
) => `
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

${topRefs?.length ? buildRefDigest(topRefs) : similarCase ? `**REFERENCE CASE** (successful appeal — adapt its argument structure):\n${similarCase.content.substring(0, 3000)}` : ''}
`;

// ═══════════════════════════════════════════════════════════════════════
// 1. 生成 POA 大纲（两阶段第一步）
// ═══════════════════════════════════════════════════════════════════════
export const generatePOAOutline = async (
  data: Partial<CaseData>,
  settings: GlobalSettings,
  risk: RiskAnalysis,
  fileEvidence: string,
  similarCase?: ReferenceCase,
  topRefs?: ReferenceCase[]
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
  ? 'For ODR: produce exactly 3 sections (Root Cause, Immediate Actions, Future Plan). Each section gets 4-6 key points. IMPORTANT: key points must be detailed enough that when expanded into paragraphs they will reach 700-950 characters per section — avoid vague one-liners.'
  : `For standard account suspension: produce EXACTLY 5 sections in this order:
  1. Opening Statement — 1-2 key points (acknowledge suspension, state responsibility, reference track record)
  2. Root Cause Analysis — MINIMUM 3 key points (each must be a distinct, specific cause — operational/technical/management layer)
  3. Immediate Corrective Actions Taken — MINIMUM 5 key points (past tense, actions already completed)
  4. Future Prevention Plan — MINIMUM 5 key points (future-oriented measures to prevent recurrence)
  5. Closing Statement — 1-2 key points (reaffirm commitment, request reinstatement)
  DO NOT add extra sections. DO NOT merge sections. Keep exactly these 5.`}

Make key points SPECIFIC and DATA-DRIVEN based on the case context provided. NOT generic.`;

  const user = buildBaseContext(data, risk, fileEvidence, similarCase, topRefs);

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
            { id: 's1', title: 'Opening Statement', keyPoints: ['Acknowledge the suspension and take full responsibility', 'Reference positive track record to establish credibility'] },
            { id: 's2', title: 'Root Cause Analysis', keyPoints: ['[根本原因 1 — 运营层]', '[根本原因 2 — 技术层]', '[根本原因 3 — 管理层]'] },
            { id: 's3', title: 'Immediate Corrective Actions Taken', keyPoints: ['[即时措施 1]', '[即时措施 2]', '[即时措施 3]', '[即时措施 4]', '[即时措施 5]'] },
            { id: 's4', title: 'Future Prevention Plan', keyPoints: ['[未来计划 1]', '[未来计划 2]', '[未来计划 3]', '[未来计划 4]', '[未来计划 5]'] },
            { id: 's5', title: 'Closing Statement', keyPoints: ['Reaffirm commitment to Walmart policies', 'Respectfully request reinstatement'] },
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
  similarCase?: ReferenceCase,
  topRefs?: ReferenceCase[]
): Promise<string> => {
  const isODR = data.isODRSuspension === true;

  const outlineText = outline.sections.map((s, i) =>
    `${i + 1}. ${s.title}\n${s.keyPoints.map(p => `   - ${p}`).join('\n')}` +
    (s.adminNote ? `\n   ⚑ ADMIN INSTRUCTION FOR THIS SECTION: "${s.adminNote}"` : '')
  ).join('\n\n');

  // 管理员全局指示——最高优先级块
  const adminDirectiveBlock = outline.adminDirective?.trim()
    ? `\n\n🔴 MANDATORY OPERATOR DIRECTIVE (HIGHEST PRIORITY — MUST be implemented before all other rules):
"""
${outline.adminDirective}
"""
This directive OVERRIDES any generic expansion rule below. Failure to implement it is unacceptable.`
    : '';

  const sys = `You are a Senior Walmart Appeal Attorney.
The operator has APPROVED the following strategic outline. Your job is to expand it into a complete, professional POA.

**APPROVED OUTLINE** (follow this EXACTLY — do not add or remove sections):
Overall Strategy: ${outline.overallStrategy}
${outlineText}
${adminDirectiveBlock}

**CRITICAL RULES FOR ADMIN INSTRUCTIONS**:
- Any section with a "⚑ ADMIN INSTRUCTION" marker: that instruction MUST be implemented in that section's content — include the specified facts, examples, or arguments explicitly.
- The MANDATORY OPERATOR DIRECTIVE above (if present) MUST be addressed somewhere in the POA, even if it means adding a sentence to an otherwise complete section.

**EXPANSION RULES**:
${isODR
  ? `- ODR MODE: Exactly 3 sections. Use [SECTION X: TITLE] tags.
- CRITICAL CHARACTER REQUIREMENT: Each section body MUST be between 700 and 950 characters (count the actual characters, excluding the [SECTION X: TITLE] tag line itself).
- To reach 700+ characters: write in FULL SENTENCES, not bullet points. Expand every point with explanation of WHY the action was taken and HOW it prevents recurrence. Include specific Order IDs, dates, names, and tool names.
- Do NOT use bullet points or numbered lists within ODR sections — only flowing paragraphs.
- After drafting, MENTALLY COUNT the characters in each section. If any section is below 700, ADD more detail until it reaches 700-950.
- Cite specific Order IDs or Tracking Numbers from evidence.
- Auto-generate realistic names (Mr. Chen Wei), specific dates, and tool names (ShipStation, FedEx).`
  : `- STANDARD 5-SECTION MODE. Use bold Roman numeral headers: **I. Opening Statement**, **II. Root Cause Analysis**, **III. Immediate Corrective Actions Taken**, **IV. Future Prevention Plan**, **V. Closing Statement**.
- DO NOT create any additional sections. DO NOT split or rename sections. Exactly 5.
- Section II (Root Cause Analysis): MINIMUM 3 numbered points. Each cause must be distinct and specific. Analyze from operational, technical, and management failure layers. Cite Order IDs from evidence where possible.
- Section III (Immediate Corrective Actions Taken): MINIMUM 5 numbered points written in PAST TENSE (already completed). Each action must directly address a root cause identified in Section II. Include specific dates, names, and tools. Each action MUST include a concrete timeline marker using one of: "within 24 hours", "within 1-3 days", "within 1 week" — inserted naturally into the sentence.
- Section IV (Future Prevention Plan): MINIMUM 5 numbered points written in FUTURE/PRESENT PROGRESSIVE tense. Each measure must be concrete with a named owner, specific date, and specific tool or system. Each measure MUST specify its implementation timeline using one of: "within 1 week", "within 2 weeks", "within 1 month", "within 3 months", "quarterly" — stated explicitly in the point. Auto-generate if not provided: "Compliance Manager Mr. Chen Wei", "ShipStation", "2026 dates".
- Section V (Closing): Short paragraph. Reaffirm Walmart policy commitment. Request reinstatement. Offer weekly performance updates.
- Auto-generate realistic specifics throughout: person names, tool names (ShipStation, Helium10, Azure DevOps, Power BI), law firm (Hansen & Associates), and dates.`}

**TONE**: ${risk.toneInstruction}
Return ONLY the complete POA text. No preamble, no meta-comments.`;

  const user = buildBaseContext(data, risk, fileEvidence, similarCase, topRefs) +
    `\n\n**CONFIRMED OUTLINE TO EXPAND**:\n${outlineText}` +
    (outline.adminDirective ? `\n\n**OPERATOR DIRECTIVE**: ${outline.adminDirective}` : '');

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let result = (await callAI(settings, sys + `\n\nToday's date: ${today}`, user)).trim();

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let result = (await callAI(settings, sys + `\n\nToday's date: ${today}`, user)).trim();

  // ── ODR 后置验证：检查每段是否达到 700 字符，不足则自动补写 ──────
  if (isODR) {
    const sectionRegex = /(\[SECTION \d+:[^\]]+\])([\s\S]*?)(?=\[SECTION \d+:|$)/gi;
    const sections: { tag: string; body: string }[] = [];
    let match;
    while ((match = sectionRegex.exec(result)) !== null) {
      sections.push({ tag: match[1], body: match[2].trim() });
    }

    // Check if any section is under 700 chars
    const shortSections = sections.filter(s => s.body.length < 700);
    if (shortSections.length > 0) {
      const fixPrompt = `The following ODR appeal sections are too short (must be 700-950 characters each).
Expand ONLY the short sections by adding more specific detail, explanations, and context. Keep the [SECTION X: TITLE] tags.
Do NOT shorten any section that is already 700+ characters.

Current draft:
${result}

Short sections that need expansion:
${shortSections.map(s => `${s.tag} — current length: ${s.body.length} chars (need at least 700)`).join('\n')}

Return the complete corrected 3-section ODR appeal with all sections at 700-950 characters.`;

      try {
        const expanded = await callAI(settings, 'You are a Walmart appeal specialist. Expand the short sections to meet the 700-950 character requirement. Return only the complete POA text.', fixPrompt);
        result = expanded.trim();
      } catch {
        // If auto-expand fails, return original result
      }
    }
  }

  return result;
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

**1. 结构完整性**：POA 必须包含且仅包含以下 5 个章节：
- ✅ I. 开头陈述 (Opening Statement)
- ✅ II. 原因分析 (Root Cause Analysis) — 至少 3 个独立原因
- ✅ III. 已采取的措施 (Immediate Corrective Actions Taken) — 至少 5 个措施（过去式）
- ✅ IV. 未来计划 (Future Prevention Plan) — 至少 5 个计划（未来式）
- ✅ V. 结尾 (Closing Statement)
- ❌ 如有多余章节或章节缺失，标记为「结构错误」

**2. 细节核查**（最重要）：
- ✅ 是否有具体负责人姓名（如 Mr. Wang）？
- ✅ 是否有具体整改日期？
- ✅ 是否有具体物流商/工具名（FedEx、ShipStation 等）？
- ✅ 是否引用具体订单号？
- ❌ 任意缺失 → 标记「待补充」

**3. 逻辑核查**：原因分析是否体现运营/技术/管理三层根本原因？III 中每条措施是否能直接对应 II 中某条原因？

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
TARGET STRUCTURE — The corrected POA MUST have exactly these 5 sections:
  I. Opening Statement
  II. Root Cause Analysis (minimum 3 numbered causes)
  III. Immediate Corrective Actions Taken (minimum 5 numbered actions, past tense)
  IV. Future Prevention Plan (minimum 5 numbered measures, future/present progressive)
  V. Closing Statement

AUTO-GENERATION (apply immediately, DO NOT ask user):
- Missing name → "Compliance Manager Mr. Chen Wei"
- Missing date → "${today}"
- Missing tool → "ShipStation / Helium10 / Azure DevOps / Power BI"
- Missing order ID → "[Order #7739284651823]"
- Missing law firm → "Hansen & Associates IP Law Firm"
If draft has more than 5 sections (e.g. 7 sections), MERGE extra sections into the correct 5.
Maintain [SECTION X] tags if ODR mode (3 sections).
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
// 7. 策略自动迭代（升级版：同时利用案件历史 + 成功案例库）
// ═══════════════════════════════════════════════════════════════════════
export const iterateStrategies = async (
  successCases: CaseData[],
  currentStrategies: { performance: string; ip: string; general: string },
  settings: GlobalSettings,
  refLibrary?: ReferenceCase[]   // 新增：成功案例库（300个文件）
): Promise<{ performance: string; ip: string; general: string }> => {

  // ── 从案件历史中按类型分组 ───────────────────────────────────────
  const perfCases  = successCases.filter(c => c.violationType === 'Performance' || c.isODRSuspension);
  const ipCases    = successCases.filter(c => c.violationType === 'IP' || c.violationType === 'Counterfeit');
  const otherCases = successCases.filter(c => c.violationType === 'Related' || c.violationType === 'Other');

  // 从案件历史抽样（最多5条，取最新的）
  const sampleCases = (cases: CaseData[], max = 5) =>
    cases.slice(0, max).map((c, i) =>
      `案例${i + 1}（${c.violationType}）：\n${c.poaContent?.substring(0, 600) || '内容缺失'}`
    ).join('\n---\n');

  // ── 从案例库（300个文件）中提取关键策略模式 ─────────────────────
  const buildLibDigest = (type: string, lib: ReferenceCase[], max = 8) => {
    const filtered = lib.filter(r => r.type === type).slice(0, max);
    if (!filtered.length) return '（暂无此类型案例库数据）';
    // 每个只取开头400字，提炼论点结构而非全文
    return filtered.map((r, i) =>
      `库案例${i + 1}「${r.title.substring(0, 30)}」：\n${r.content.substring(0, 400)}`
    ).join('\n---\n');
  };

  const lib = refLibrary || [];
  const libTotal = lib.length;

  const sys = `你是 Walmart 申诉策略首席专家。你将分析来自两个来源的数据：
1. 本系统历史成功案件（含完整POA内容）
2. 成功案例库（共 ${libTotal} 个导入的成功申诉文件）
请综合两个来源，提炼出最有效的申诉策略模板。只输出 JSON，不输出任何其他内容。`;

  const user = `
## 数据来源一：系统内历史成功案件（共 ${successCases.length} 个）

**Performance / ODR 类（${perfCases.length} 个）**：
${sampleCases(perfCases) || '暂无'}

**IP / Counterfeit 类（${ipCases.length} 个）**：
${sampleCases(ipCases) || '暂无'}

**其他类型（${otherCases.length} 个）**：
${sampleCases(otherCases) || '暂无'}

---

## 数据来源二：成功案例库（共 ${libTotal} 个导入文件）

**Performance / ODR 类案例库样本**：
${buildLibDigest('Performance', lib)}

**IP / Counterfeit 类案例库样本**：
${buildLibDigest('IP', lib)}
${buildLibDigest('Counterfeit', lib)}

---

## 任务

综合以上 ${successCases.length + libTotal} 份数据，分析这些成功申诉的共同特征：
- 用词和语气模式
- 根本原因分析的深度和层次
- 整改措施的具体程度（时间线、责任人、工具名称）
- 预防措施的可量化程度
- 开头和结尾的有效策略

**当前策略（供参考，请在此基础上优化）**：
Performance: ${currentStrategies.performance}
IP: ${currentStrategies.ip}
General: ${currentStrategies.general}

请输出一个 JSON 对象，键为 "performance"、"ip"、"general"，值为优化后的中文策略描述（每条150-250字，要具体可操作）。
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

// ═══════════════════════════════════════════════════════════════════════
// 8. 一键翻译 POA 全文为中文
// ═══════════════════════════════════════════════════════════════════════
export const translatePOAToChinese = async (
  poaText: string,
  settings: GlobalSettings
): Promise<string> => {
  const sys = `你是专业的跨境电商申诉翻译专家，擅长将 Walmart POA 英文申诉翻译成流畅的中文。
翻译要求：
- 保留原文的所有章节结构和格式（如 **I. Opening Statement** 翻译为 **一、开头陈述**）
- 保留所有订单号、日期、人名、工具名等专有名词（不翻译 Order ID、ShipStation 等）
- 语言流畅自然，符合中文表达习惯
- 不增减任何实质内容
只输出翻译后的完整中文文本，不要任何说明。`;

  return callAI(settings, sys, `请将以下 Walmart POA 翻译成中文：\n\n${poaText}`);
};

// ═══════════════════════════════════════════════════════════════════════
// 9. 一键翻译大纲为中文
// ═══════════════════════════════════════════════════════════════════════
export const translateOutlineToChinese = async (
  outline: POAOutline,
  settings: GlobalSettings
): Promise<POAOutline> => {
  const sys = `你是专业翻译，将 Walmart POA 大纲从英文翻译成中文。
只输出 JSON，格式与输入完全一致，仅将文本内容翻译为中文。
保留所有订单号、人名（Mr. Chen Wei 等）、工具名（ShipStation 等）不翻译。
不要任何注释或 markdown 代码块。`;

  const raw = await callAI(settings, sys, `翻译以下 JSON 大纲的所有文本字段为中文：\n${JSON.stringify(outline, null, 2)}`);
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return { ...outline, ...JSON.parse(clean) };
  } catch {
    throw new Error('大纲翻译解析失败，请重试');
  }
};
