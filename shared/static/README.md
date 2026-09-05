# shared/static/

⚠️ **此目录资源经鉴权访问**——由平台托管在私有源，仅登录用户可拉取。请勿放公开资源。

## 与其他资源目录的区分

| 目录 | 访问 | 部署目标 | 适用场景 |
|---|---|---|---|
| `src/assets/` | 代码 `import` | 随 JS 一起进 CDN | 图标、被组件 import 的小图（多数情况选这里） |
| `public/` | 公网匿名可访问 | 公网 CDN | favicon、被外部按固定 URL 引用的资源 |
| `shared/static/` | 需应用鉴权 | 私有源 | 仅登录用户可见的图片、PDF、配置文件等 |

## 引用方式

`shared/static/` 下文件**不要**用 `/shared/static/foo.png` 这种相对路径直接引用——浏览器无法匿名访问。
应通过平台运行时 SDK 拿到带 token 的 URL 后再使用。
