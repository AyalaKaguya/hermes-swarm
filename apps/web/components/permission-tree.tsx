"use client";

import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  PermissionCatalog,
  PermissionCatalogOperation,
  PermissionCatalogPurpose,
} from "@/lib/admin-api";

type PermissionTreeProps = {
  catalog: PermissionCatalog | null;
  disabled?: boolean;
  isChecked: (permission: string) => boolean;
  onToggle: (permission: string, enabled?: boolean) => void;
};

export function PermissionTree({
  catalog,
  disabled,
  isChecked,
  onToggle,
}: PermissionTreeProps) {
  const scopes = catalog?.scopes ?? [];

  if (scopes.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm">
        暂无可配置权限
      </div>
    );
  }

  return (
    <div className="divide-y">
      {scopes.map((scope) => (
        <div className="grid gap-2 p-3" key={scope.scope}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AppIcon className="size-4" name="shield" />
            {scope.label}
          </div>
          <div className="grid gap-2">
            {scope.entities.map((entity) => (
              <details
                className="group rounded-md border bg-background"
                key={`${scope.scope}:${entity.entity}`}
                open
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium hover:bg-muted/50">
                  <span className="min-w-0 truncate">{entity.label}</span>
                  <span className="text-xs">
                    {enabledCount(entity.purposes, isChecked)}/
                    {totalCount(entity.purposes)}
                  </span>
                </summary>
                <div className="grid gap-2 border-t p-2">
                  {entity.purposes.map((purpose) => (
                    <PurposeNode
                      disabled={disabled}
                      isChecked={isChecked}
                      key={`${entity.entity}:${purpose.purpose}`}
                      onToggle={onToggle}
                      purpose={purpose}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PurposeNode({
  disabled,
  isChecked,
  onToggle,
  purpose,
}: {
  disabled?: boolean;
  isChecked: (permission: string) => boolean;
  onToggle: (permission: string, enabled?: boolean) => void;
  purpose: PermissionCatalogPurpose;
}) {
  const total = purpose.operations.length;
  const enabled = purpose.operations.filter((operation) =>
    isChecked(operation.permission),
  ).length;
  const checked = enabled === total ? true : enabled > 0 ? "indeterminate" : false;

  function setPurpose(enabledValue: boolean) {
    for (const operation of purpose.operations) {
      onToggle(operation.permission, enabledValue);
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={checked}
            disabled={disabled}
            onCheckedChange={(value) => setPurpose(value !== true)}
          />
          <span className="truncate">{purpose.label}</span>
          <span className="text-xs">
            {enabled}/{total}
          </span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            disabled={disabled}
            onClick={() => setPurpose(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            全选
          </Button>
          <Button
            disabled={disabled}
            onClick={() => setPurpose(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            清空
          </Button>
        </div>
      </div>
      <div className="grid gap-1 p-2">
        {purpose.operations.map((operation) => (
          <OperationNode
            disabled={disabled}
            isChecked={isChecked}
            key={operation.permission}
            onToggle={onToggle}
            operation={operation}
          />
        ))}
      </div>
    </div>
  );
}

function OperationNode({
  disabled,
  isChecked,
  onToggle,
  operation,
}: {
  disabled?: boolean;
  isChecked: (permission: string) => boolean;
  onToggle: (permission: string, enabled?: boolean) => void;
  operation: PermissionCatalogOperation;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
      <Checkbox
        checked={isChecked(operation.permission)}
        disabled={disabled}
        onCheckedChange={(value) => onToggle(operation.permission, value === true)}
      />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{operation.label}</span>
          {operation.isDangerous && (
            <Badge className="px-1.5 text-[11px]" variant="destructive">
              高危
            </Badge>
          )}
        </span>
        {operation.description && (
          <span className="text-xs leading-5">{operation.description}</span>
        )}
        <span className="truncate font-mono text-[11px]">
          {operation.permission}
        </span>
      </span>
    </label>
  );
}

function totalCount(purposes: PermissionCatalogPurpose[]) {
  return purposes.reduce(
    (count, purpose) => count + purpose.operations.length,
    0,
  );
}

function enabledCount(
  purposes: PermissionCatalogPurpose[],
  isChecked: (permission: string) => boolean,
) {
  return purposes.reduce(
    (count, purpose) =>
      count +
      purpose.operations.filter((operation) =>
        isChecked(operation.permission),
      ).length,
    0,
  );
}
