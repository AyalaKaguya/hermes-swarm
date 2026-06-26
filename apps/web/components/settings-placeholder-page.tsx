import { AppIcon } from "@/components/app-icon";

export function SettingsPlaceholderPage({
  description,
  icon,
  label,
  shortDescription,
}: {
  description?: string;
  icon?: string;
  label: string;
  shortDescription?: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-6 py-6">
        <div className="flex items-center gap-3">
          {icon && (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-secondary text-xl text-text-secondary">
              {icon}
            </span>
          )}
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{label}</h1>
            {shortDescription && (
              <p className="mt-0.5 text-sm text-text-secondary">
                {shortDescription}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
            <AppIcon className="size-6 text-text-tertiary" name="grid" />
          </div>
          <h2 className="text-base font-medium text-text-primary">{label}管理</h2>
          <p className="mt-2 text-sm text-text-secondary">
            {description ??
              "此功能模块正在开发中，请联系管理员获取更多信息。"}
          </p>
        </div>
      </div>
    </div>
  );
}
