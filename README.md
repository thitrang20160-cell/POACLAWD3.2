# 泽远跨境 POA 智能申诉系统 V6

## 本版本 (V6) 相对 V5 的修复与优化

### 🔴 Bug 修复（影响功能）
- **[致命] Gemini 模型名错误**：`gemini-3-flash-preview` → `gemini-2.0-flash`（原来模型不存在，API 必然报错）
- **[严重] 修改密码表单缺旧密码字段**：修改密码 Modal 中补充了「当前密码」输入框，密码验证逻辑现在可以正常运作
- **[严重] History Tab 空白**：案件历史页面原来完全没有渲染代码，现已重建，支持搜索和状态筛选

### 🟠 安全修复
- **密码不再明文存储**：用户密码现在通过加盐哈希后存储，不再在 LocalStorage 中保存明文
- **移除写死后门账户**：删除了 `if (username === 'admin' && password === 'admin888')` 的硬编码后门，改为「首次启动注册」机制：首个注册的账号自动成为超级管理员

### 🟡 提高通过率的优化
- **参考案例截断从 300 字 → 3000 字**：AI 现在能学习到完整的论证结构，而不只是开头几句
- **风险评分驱动 AI 语气**：新增 `toneInstruction` 字段，高危案件 AI 自动采用极度认错的语气，低危案件保持自信专业
- **autoFixPOA 解耦中英文 feedback**：质检报告末尾自动附加英文 `[ISSUES_FOR_AUTOFIX]` 摘要，修复模块只读英文指令，避免语言混乱
- **generateCNExplanation 修复传参**：不再在 service 层偷读 localStorage，改为通过参数传入 settings

### ✅ 新功能
- **Dashboard 饼图**：案件状态分布可视化，PieChart 现在真正被使用
- **Dashboard 最近案件列表**：快速预览最新5条案件
- **Generator 补全输入字段**：新增「根本原因简述」、「已采取措施」、「Case ID」、「受影响数量」字段，让 AI 生成更精准
- **POA 导出为 TXT 文件**：一键下载纯文本 POA，文件名自动包含店铺名和日期
- **History 搜索+筛选**：支持关键词搜索 + 状态筛选
- **Library 导出 JSON**：案例库可一键备份导出
- **密码显示/隐藏按钮**：登录和修改密码界面支持眼睛图标切换
- **案件状态徽章样式**：统一的状态标签设计
- **风险进度条可视化**：RiskBadge 现在显示进度条，更直观

## 项目结构

```
├── App.tsx                    # 主应用（已重构）
├── types.ts                   # 类型定义（新增 toneInstruction）
├── components/
│   └── RiskBadge.tsx          # 风险标签（新增进度条）
└── services/
    ├── geminiService.ts       # AI 服务（模型修复+架构优化）
    ├── storageService.ts      # 存储服务（密码哈希+移除后门）
    ├── cloudService.ts        # Supabase 云端（未改）
    ├── fileService.ts         # 文件解析（未改）
    └── walmartService.ts      # Walmart API（未改）
```

## 启动

```bash
npm install
npm run dev
```
