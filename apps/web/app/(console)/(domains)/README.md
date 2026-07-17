# Business Domain Pages

业务页面放在这个 route group 下，避免继续把业务入口挂在 `/settings/**`。

Next.js route group 不影响 URL。例如：

```text
apps/web/app/(console)/(domains)/projects/page.tsx -> /projects
```

接入规则：

- 页面访问能力继续使用共享 page access/permission 体系。
- 业务页面继续继承 `(console)` 的 `AdminShell`；不要在业务域内重复创建应用外壳。
- 页面和组件显隐统一使用 `usePermission()` 或 `AccessGate`。
- 不要基于固定角色名判断业务能力；除 `platform-admin` 种子角色外，角色是动态配置。
- `/settings/**` 只用于个人、组织、平台基础设施配置。
