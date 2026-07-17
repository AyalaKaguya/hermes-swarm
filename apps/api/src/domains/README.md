# Business Domains

业务模块放在这里，基础设施模块不要继续混入业务能力。

每个业务域建议使用独立目录：

```text
apps/api/src/domains/<domain>/<domain>.module.ts
apps/api/src/domains/<domain>/<domain>.controller.ts
apps/api/src/domains/<domain>/<domain>.service.ts
```

接入规则：

- 在 `DomainsModule` 中导入业务域模块。
- 业务接口使用 `@AccessResource` / `@AccessOperation` 声明权限目录。
- 业务模块可以依赖基础设施公开服务和 `@hermes-swarm/core` / `@hermes-swarm/rbac-api`。
- 基础设施模块不能反向依赖业务模块。
- 不要把业务能力放入 `settings`、`organizations`、`platform-*`、`users` 等基础设施目录。

当前业务域：

- `support`：Ticket、Conversation、业务访问解析与 Ticket 归档任务。
