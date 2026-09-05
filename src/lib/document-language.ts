/**
 * 页面语言 / 翻译属性守卫：
 * 平台构建产物可能把 <html lang> 重写为 "en" 且不带任何翻译豁免标记，
 * 浏览器自动翻译（如 Chrome 翻译）会改写 React 管理的文本节点，
 * 导致 NotFoundError: removeChild / insertBefore 渲染崩溃与统计标签被改写。
 *
 * 应用启动时在运行时强制设置：
 * - <html lang="zh-CN" translate="no" class="notranslate">
 * - <body translate="no" class="notranslate">（覆盖 Radix 挂到 body 下的弹窗 Portal）
 * - <meta name="google" content="notranslate">
 *
 * 幂等，可重复调用。
 */
export function ensureDocumentLanguage(): void {
  if (typeof document === 'undefined') return;

  const { documentElement, body } = document;

  documentElement.lang = 'zh-CN';
  documentElement.setAttribute('translate', 'no');
  documentElement.classList.add('notranslate');

  if (body) {
    body.setAttribute('translate', 'no');
    body.classList.add('notranslate');
  }

  let meta = document.querySelector<HTMLMetaElement>('meta[name="google"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'google');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', 'notranslate');
}
