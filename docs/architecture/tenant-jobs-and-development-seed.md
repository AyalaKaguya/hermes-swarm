# Tenant Jobs 与开发 Seed 基线

## Tenant-aware Jobs

所有租户任务必须使用 `TenantJobEnvelope`，并显式携带：

- `tenantId`：唯一租户执行边界；缺失时在访问 Redis 或数据库前失败。
- `name`：稳定任务名称。
- `idempotencyKey`：调用方提供的稳定投递键。
- `payload`：任务数据，不能依赖进程全局的“当前租户”。

`TenantJobExecutor` 在执行 handler 前完成：

1. 使用 `jobs:tenant:{tenantId}:{name}:...` Redis key 获取带 TTL 的所有权锁。
2. 检查同一 tenant/name/idempotencyKey 的完成标记。
3. 打开 tenant datasource 事务并用 `SET LOCAL` 设置 `app.tenant_id` 与 tenant scope。
4. 通过 `TenantContextService` 向 handler 提供事务内 EntityManager。
5. 成功后写入完成标记；失败只释放锁，允许重试。

平台任务不能在一个 handler 内遍历租户数据。`TenantJobFanoutService` 只使用 platform datasource 查询 active Tenant，然后产生逐租户 envelope。首个 handler 是 `tickets.archive-expired`；它复用幂等的条件 UPDATE，不安装 `setInterval`、Cron 或进程内全表 timer。外部 scheduler 应为每个调度周期提供稳定 `runId`。

## Migration 后开发 Seed

空库执行顺序：

```powershell
pnpm nx run @hermes-swarm/api:migration:run
$env:DEV_SEED_PLATFORM_ADMIN_PASSWORD='<至少 8 位>'
$env:DEV_SEED_OWNER_PASSWORD='<至少 8 位>'
pnpm nx run @hermes-swarm/api:seed:development
```

Seed 使用 platform datasource 幂等创建/更新：

- controller + navigation 权限目录；
- `platform-admin`、平台管理员及其权限；
- active 开发 Tenant。

随后使用 tenant datasource 开启事务，设置该 Tenant 的 RLS 上下文并幂等创建/更新：

- Tenant Owner；
- 默认 Organization；
- tenant-owner / organization owner 角色、成员关系和默认权限。

密码没有开发默认值，必须通过 `DEV_SEED_PLATFORM_ADMIN_PASSWORD` 与 `DEV_SEED_OWNER_PASSWORD` 明确提供。邮箱、显示名、tenant/org slug 可使用对应 `DEV_SEED_*` 变量覆盖。生产环境默认拒绝运行；紧急显式执行还需要 `ALLOW_PRODUCTION_SEED=true`。
