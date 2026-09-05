import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { AppContainer, ErrorRender } from "@lark-apaas/client-toolkit-lite";
import App from "./app";
import { ensureDocumentLanguage } from "@/lib/document-language";
import "./index.css";

// 首次绘制前完成语言/翻译属性初始化（不依赖组件 useEffect），
// 避免浏览器在首帧把页面当作英文触发自动翻译改写 React 管理的 DOM；
// Layout 内的运行时守卫保留，用于纠正平台对构建产物 HTML 的重写
ensureDocumentLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={process.env.CLIENT_BASE_PATH || "/"}>
      <AppContainer>
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <ErrorRender error={error} resetErrorBoundary={resetErrorBoundary} />
          )}
        >
          <App />
        </ErrorBoundary>
      </AppContainer>
    </BrowserRouter>
  </StrictMode>,
);
