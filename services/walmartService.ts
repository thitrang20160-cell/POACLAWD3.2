import { CaseData, GlobalSettings } from "../types";

/**
 * Walmart 提交服务
 * 注：Walmart Marketplace API 不支持浏览器直接调用（CORS 限制）。
 * 真实提交需要服务端代理。当前仅支持模拟模式。
 */
export const submitPOAToWalmart = async (
  caseData: CaseData,
  settings: GlobalSettings
): Promise<{ success: boolean; caseNumber?: string; message?: string }> => {

  if (settings.enableSimulationMode) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          caseNumber: "CASE-" + Math.floor(Math.random() * 1000000),
          message: "模拟提交成功（测试模式，未真实发送）。"
        });
      }, 1500);
    });
  }

  // 真实提交需要服务端代理，浏览器端无法直接调用（CORS）
  return {
    success: false,
    message: "真实提交需要服务端代理支持。请将 POA 内容手动提交至 Walmart Seller Center，或联系开发者部署服务端。"
  };
};
