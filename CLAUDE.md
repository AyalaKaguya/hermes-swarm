<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->

## Xpert Alignment Rules

- Before changing an existing feature, inspect the matching Xpert backend and frontend implementation first. Use `/home/ayala/Projects/xpert` as the source repo; the older `/home/ayala/Project/xpert` path is not present in this environment.
- Preserve behavior in this order of priority: business logic, data flow, API behavior, UI behavior, then visual polish.
- Backend comparisons should start from Xpert `packages/server/src/**` and map shared entities into `packages/core/**` in this repo. App-specific Nest modules stay under `apps/api/src/**`.
- Frontend comparisons should start from Xpert `apps/cloud/src/app/**`, then translate the interaction into the Next.js app under `apps/web/**`. Match workflows and compact enterprise layouts rather than Angular implementation details.
- The web app already has Tailwind CSS and shadcn/ui configured. Prefer existing shadcn/ui components in `apps/web/components/ui`; add missing primitives from `apps/web` with `pnpm dlx shadcn@latest add <component>`.
- Do not add large custom CSS blocks or duplicate base UI primitives that shadcn/ui already provides. Use compact Tailwind utility layouts and local composition around shared components.
- Keep admin/back-office APIs under `/api/admin/**`, with browser configuration continuing to use `NEXT_PUBLIC_API_BASE_URL` for the `/api` base.
- Local app defaults are web `3100` and API `3200`; the web app proxies `/api/**` to the API. Prefer Nx commands for server work: `pnpm nx run @hermes-swarm/api:dev` and `pnpm nx run @hermes-swarm/web:dev`. If logs are needed, stop the existing background servers and restart them manually with those commands.
- Reuse `docs/dev-runtime-playbook.md` for port checks, foreground log capture, browser navigation, and Playwright screenshot commands.
