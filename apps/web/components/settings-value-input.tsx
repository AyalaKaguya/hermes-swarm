"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { cn } from "@/lib/utils";
import {
  SECRET_SETTING_MASK,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core/settings/definitions";
import type {
  SettingPayloadEntry,
  SettingPayloadValue,
} from "@/lib/admin-api";

export type CustomSettingScope = "organization" | "platform";

export type CustomSettingSubmit = SettingPayloadEntry & {
  scope?: CustomSettingScope;
};

type SettingValueInputProps = {
  className?: string;
  disabled?: boolean;
  id?: string;
  inputClassName?: string;
  onCommit?: (value: SettingPayloadValue) => void | Promise<void>;
  onValueChange?: (value: SettingPayloadValue) => void;
  placeholder?: string;
  value?: SettingPayloadValue;
  valueOptions?: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
};

const VALUE_TYPE_OPTIONS: Array<{
  label: string;
  value: SettingValueType;
}> = [
  { label: "文本", value: "string" },
  { label: "开关", value: "boolean" },
  { label: "数字", value: "number" },
  { label: "JSON", value: "json" },
  { label: "枚举", value: "enum" },
  { label: "密钥", value: "secret" },
];

const DEFAULT_ENUM_OPTION_VALUE = "option_1";
const identityTranslator = (value: string) => value;

export function SettingValueInput({
  className,
  disabled,
  id,
  inputClassName,
  onCommit,
  onValueChange,
  placeholder,
  value,
  valueOptions,
  valueType,
}: SettingValueInputProps) {
  const tr = useTextTranslation();
  const [draft, setDraft] = useState(
    valueType === "secret" ? "" : formatDraftValue(value, valueType),
  );
  const [error, setError] = useState<string | null>(null);
  const secretDraftRef = useRef("");
  const [secretLength, setSecretLength] = useState(0);

  useEffect(() => {
    if (valueType === "secret") return;
    setDraft(formatDraftValue(value, valueType));
    setError(null);
  }, [value, valueType]);

  useEffect(() => {
    if (valueType !== "secret") return;
    secretDraftRef.current = "";
    setSecretLength(0);
    setError(null);
  }, [valueType]);

  function updateDraft(nextValue: string) {
    setDraft(nextValue);
    setError(null);
    onValueChange?.(nextValue);
  }

  async function commitDraft() {
    const result = normalizeDraftValue(draft, valueType, valueOptions, tr);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(formatDraftValue(result.value, valueType));
    await onCommit?.(result.value);
  }

  function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }

  if (valueType === "boolean") {
    const checked = value === true || value === "true";
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Switch
          checked={checked}
          disabled={disabled}
          id={id}
          onCheckedChange={(nextValue) => {
            onValueChange?.(nextValue);
            void onCommit?.(nextValue);
          }}
        />
      </div>
    );
  }

  if (valueType === "enum") {
    return (
      <div className={cn("grid gap-1", className)}>
        <Select
          disabled={disabled || !valueOptions?.length}
          onValueChange={(nextValue) => {
            setError(null);
            setDraft(nextValue);
            onValueChange?.(nextValue);
            void onCommit?.(nextValue);
          }}
          value={draft || undefined}
        >
          <SelectTrigger className={cn("w-full", inputClassName)} id={id}>
            <SelectValue placeholder={tr(placeholder ?? "选择选项")} />
          </SelectTrigger>
          <SelectContent>
            {(valueOptions ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!valueOptions?.length && (
          <div className="text-xs text-destructive">
            {tr("枚举设置缺少选项")}
          </div>
        )}
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    );
  }

  if (valueType === "secret") {
    const maskedDraft = "*".repeat(secretLength);
    const setSecretDraft = (nextValue: string) => {
      secretDraftRef.current = nextValue;
      setSecretLength(nextValue.length);
      setError(null);
      onValueChange?.(nextValue);
    };

    return (
      <div className={cn("grid gap-1", className)}>
        <Input
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className={cn(inputClassName)}
          disabled={disabled}
          id={id}
          onBlur={async () => {
            const secretDraft = secretDraftRef.current;
            if (!secretDraft) return;
            const result = normalizeDraftValue(
              secretDraft,
              valueType,
              undefined,
              tr,
            );
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            if (onCommit) {
              await onCommit(result.value);
              secretDraftRef.current = "";
              setSecretLength(0);
            }
          }}
          onChange={(event) => {
            event.currentTarget.value = maskedDraft;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key === "Backspace") {
              event.preventDefault();
              setSecretDraft(secretDraftRef.current.slice(0, -1));
              return;
            }
            if (event.key === "Delete" || event.key === "Escape") {
              event.preventDefault();
              setSecretDraft("");
              return;
            }
            if (event.key.length === 1) {
              event.preventDefault();
              setSecretDraft(`${secretDraftRef.current}${event.key}`);
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (!text) return;
            setSecretDraft(`${secretDraftRef.current}${text}`);
          }}
          placeholder={
            value ? SECRET_SETTING_MASK : tr(placeholder ?? "输入密钥")
          }
          type="text"
          value={maskedDraft}
        />
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    );
  }

  if (valueType === "json") {
    return (
      <div className={cn("grid gap-1", className)}>
        <Textarea
          aria-invalid={Boolean(error)}
          className={cn("min-h-20 font-mono text-xs", inputClassName)}
          disabled={disabled}
          id={id}
          onBlur={() => void commitDraft()}
          onChange={(event) => updateDraft(event.currentTarget.value)}
          placeholder={placeholder ? tr(placeholder) : '{"enabled": true}'}
          value={draft}
        />
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <Input
        aria-invalid={Boolean(error)}
        className={cn(inputClassName)}
        disabled={disabled}
        id={id}
        inputMode={valueType === "number" ? "decimal" : undefined}
        onBlur={() => void commitDraft()}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onKeyDown={commitOnEnter}
        placeholder={placeholder ? tr(placeholder) : undefined}
        type={valueType === "number" ? "number" : "text"}
        value={draft}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}

export function CustomSettingForm({
  disabled,
  idPrefix,
  namePlaceholder = "custom.setting",
  onSubmit,
  onSubmitted,
  saving,
  scopeOptions = [
    { label: "组织", value: "organization" },
    { label: "平台", value: "platform" },
  ],
  showScope = false,
  submitLabel = "添加",
}: {
  disabled?: boolean;
  idPrefix: string;
  namePlaceholder?: string;
  onSubmit: (setting: CustomSettingSubmit) => Promise<void> | void;
  onSubmitted?: () => void;
  saving?: boolean;
  scopeOptions?: ReadonlyArray<{ label: string; value: CustomSettingScope }>;
  showScope?: boolean;
  submitLabel?: string;
}) {
  const tr = useTextTranslation();
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<CustomSettingScope>(
    scopeOptions[0]?.value ?? "organization",
  );
  const [value, setValue] = useState<SettingPayloadValue>("");
  const formSecretValueRef = useRef("");
  const [valueOptions, setValueOptions] =
    useState<SettingValueOption[]>(() => makeDefaultEnumOptions(tr));
  const [valueType, setValueType] = useState<SettingValueType>("string");

  const busy = Boolean(disabled || saving || localSaving);
  const effectiveValueOptions = useMemo(
    () => (valueType === "enum" ? valueOptions : null),
    [valueOptions, valueType],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settingName = name.trim();
    if (!settingName) {
      setError(tr("设置名称不能为空"));
      return;
    }

    const optionsResult =
      valueType === "enum"
        ? normalizeCustomOptions(valueOptions, tr)
        : { ok: true as const, value: null };
    if (!optionsResult.ok) {
      setError(optionsResult.error);
      return;
    }

    const valueResult = normalizeDraftValue(
      valueType === "secret"
        ? formSecretValueRef.current
        : formatDraftValue(value, valueType),
      valueType,
      optionsResult.value,
      tr,
    );
    if (!valueResult.ok) {
      setError(valueResult.error);
      return;
    }

    setError(null);
    setLocalSaving(true);
    try {
      await onSubmit({
        name: settingName,
        scope,
        value: valueResult.value,
        valueOptions: optionsResult.value,
        valueType,
      });
      setName("");
      setScope(scopeOptions[0]?.value ?? "organization");
      setValue("");
      formSecretValueRef.current = "";
      setValueOptions(makeDefaultEnumOptions(tr));
      setValueType("string");
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setLocalSaving(false);
    }
  }

  function changeValueType(nextType: SettingValueType) {
    setValueType(nextType);
    setError(null);
    if (nextType === "boolean") {
      setValue(false);
    } else if (nextType === "json") {
      setValue("{}");
    } else if (nextType === "enum") {
      const defaultOptions = makeDefaultEnumOptions(tr);
      setValueOptions((current) =>
        current.length > 0 ? current : defaultOptions,
      );
      setValue(valueOptions[0]?.value ?? DEFAULT_ENUM_OPTION_VALUE);
    } else if (nextType === "secret") {
      setValue("");
      formSecretValueRef.current = "";
    } else {
      setValue("");
    }
  }

  function updateOption(
    index: number,
    field: keyof SettingValueOption,
    nextValue: string,
  ) {
    const previous = valueOptions[index];
    setValueOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, [field]: nextValue } : option,
      ),
    );
    if (field === "value" && value === previous?.value) {
      setValue(nextValue);
    }
  }

  function addOption() {
    const nextValue = makeNextOptionValue(valueOptions);
    setValueOptions((current) => [
      ...current,
      { label: `${tr("选项")} ${current.length + 1}`, value: nextValue },
    ]);
    if (valueType === "enum" && !value) {
      setValue(nextValue);
    }
  }

  function removeOption(index: number) {
    if (valueOptions.length <= 1) return;
    const removed = valueOptions[index];
    const next = valueOptions.filter((_, optionIndex) => optionIndex !== index);
    setValueOptions(next);
    if (value === removed?.value) {
      setValue(next[0]?.value ?? "");
    }
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div
        className={cn(
          "grid gap-3",
          showScope
            ? "sm:grid-cols-[minmax(0,1fr)_9rem_9rem]"
            : "sm:grid-cols-[minmax(0,1fr)_9rem]",
        )}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>{tr("名称")}</Label>
          <Input
            disabled={busy}
            id={`${idPrefix}-name`}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={namePlaceholder}
            value={name}
          />
        </div>
        {showScope && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-scope`}>{tr("范围")}</Label>
            <Select
              disabled={busy || scopeOptions.length < 2}
              onValueChange={(nextValue) =>
                setScope(nextValue as CustomSettingScope)
              }
              value={scope}
            >
              <SelectTrigger className="w-full" id={`${idPrefix}-scope`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {tr(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-type`}>{tr("类型")}</Label>
          <Select
            disabled={busy}
            onValueChange={(nextValue) =>
              changeValueType(nextValue as SettingValueType)
            }
            value={valueType}
          >
            <SelectTrigger className="w-full" id={`${idPrefix}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {tr(option.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {valueType === "enum" && (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">{tr("枚举选项")}</div>
            <Button
              disabled={busy}
              onClick={addOption}
              size="sm"
              type="button"
              variant="outline"
            >
              <AppIcon className="size-3.5" name="plus" />
              {tr("添加选项")}
            </Button>
          </div>
          <div className="grid gap-2">
            {valueOptions.map((option, index) => (
              <div
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]"
                key={`${option.value}-${index}`}
              >
                <Input
                  disabled={busy}
                  onChange={(event) =>
                    updateOption(index, "label", event.currentTarget.value)
                  }
                  placeholder={tr("显示名称")}
                  value={option.label}
                />
                <Input
                  disabled={busy}
                  onChange={(event) =>
                    updateOption(index, "value", event.currentTarget.value)
                  }
                  placeholder={tr("值")}
                  value={option.value}
                />
                <Button
                  disabled={busy || valueOptions.length <= 1}
                  onClick={() => removeOption(index)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <AppIcon className="size-4" name="x" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-value`}>{tr("值")}</Label>
        <SettingValueInput
          disabled={busy}
          id={`${idPrefix}-value`}
          onValueChange={(nextValue) => {
            if (valueType === "secret") {
              formSecretValueRef.current =
                typeof nextValue === "string" ? nextValue : "";
              return;
            }
            setValue(nextValue);
          }}
          value={valueType === "secret" ? undefined : value}
          valueOptions={effectiveValueOptions}
          valueType={valueType}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={busy || !name.trim()} type="submit">
          {tr(submitLabel)}
        </Button>
      </div>
    </form>
  );
}

export function CustomSettingDialog({
  description = "创建一条自定义设置，并为后续编辑保存类型信息。",
  disabled,
  idPrefix,
  namePlaceholder,
  onSubmit,
  saving,
  scopeOptions,
  showScope,
  title = "添加自定义设置",
  triggerLabel = "添加",
}: {
  description?: string;
  disabled?: boolean;
  idPrefix: string;
  namePlaceholder?: string;
  onSubmit: (setting: CustomSettingSubmit) => Promise<void> | void;
  saving?: boolean;
  scopeOptions?: ReadonlyArray<{ label: string; value: CustomSettingScope }>;
  showScope?: boolean;
  title?: string;
  triggerLabel?: string;
}) {
  const tr = useTextTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={disabled || saving} size="sm" type="button">
          <AppIcon className="size-3.5" name="plus" />
          {tr(triggerLabel)}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr(title)}</DialogTitle>
          <DialogDescription>{tr(description)}</DialogDescription>
        </DialogHeader>
        <CustomSettingForm
          disabled={disabled}
          idPrefix={idPrefix}
          namePlaceholder={namePlaceholder}
          onSubmit={onSubmit}
          onSubmitted={() => setOpen(false)}
          saving={saving}
          scopeOptions={scopeOptions}
          showScope={showScope}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SettingEditDialog({
  disabled,
  idPrefix,
  name,
  onSubmit,
  saving,
  value,
  valueOptions,
  valueType,
}: {
  disabled?: boolean;
  idPrefix: string;
  name: string;
  onSubmit: (setting: CustomSettingSubmit) => Promise<void> | void;
  saving?: boolean;
  value: SettingPayloadValue;
  valueOptions?: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
}) {
  const tr = useTextTranslation();
  const [draftValue, setDraftValue] = useState<SettingPayloadValue>(() =>
    valueType === "secret" ? "" : (value ?? ""),
  );
  const [draftValueOptions, setDraftValueOptions] = useState<SettingValueOption[]>(
    () => cloneSettingOptions(valueOptions) ?? makeDefaultEnumOptions(tr),
  );
  const [draftValueType, setDraftValueType] =
    useState<SettingValueType>(valueType);
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const editSecretValueRef = useRef("");

  const busy = Boolean(disabled || saving || localSaving);
  const effectiveValueOptions =
    draftValueType === "enum" ? draftValueOptions : null;

  useEffect(() => {
    if (!open) return;
    setDraftValueType(valueType);
    setDraftValue(valueType === "secret" ? "" : (value ?? ""));
    setDraftValueOptions(
      cloneSettingOptions(valueOptions) ?? makeDefaultEnumOptions(tr),
    );
    editSecretValueRef.current = "";
    setError(null);
  }, [open, tr, value, valueOptions, valueType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const optionsResult =
      draftValueType === "enum"
        ? normalizeCustomOptions(draftValueOptions, tr)
        : { ok: true as const, value: null };
    if (!optionsResult.ok) {
      setError(optionsResult.error);
      return;
    }

    const shouldKeepExistingSecret =
      draftValueType === "secret" &&
      !editSecretValueRef.current &&
      Boolean(value);
    const valueResult = shouldKeepExistingSecret
      ? { ok: true as const, value: SECRET_SETTING_MASK }
      : normalizeDraftValue(
          draftValueType === "secret"
            ? editSecretValueRef.current
            : formatDraftValue(draftValue, draftValueType),
          draftValueType,
          optionsResult.value,
          tr,
        );
    if (!valueResult.ok) {
      setError(valueResult.error);
      return;
    }

    setError(null);
    setLocalSaving(true);
    try {
      await onSubmit({
        name,
        value: valueResult.value,
        valueOptions: optionsResult.value,
        valueType: draftValueType,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setLocalSaving(false);
    }
  }

  function changeValueType(nextType: SettingValueType) {
    setDraftValueType(nextType);
    setError(null);
    if (nextType === "boolean") {
      setDraftValue(false);
    } else if (nextType === "json") {
      setDraftValue("{}");
    } else if (nextType === "enum") {
      const nextOptions =
        draftValueOptions.length > 0
          ? draftValueOptions
          : cloneSettingOptions(valueOptions) ?? makeDefaultEnumOptions(tr);
      setDraftValueOptions(nextOptions);
      setDraftValue(nextOptions[0]?.value ?? DEFAULT_ENUM_OPTION_VALUE);
    } else {
      setDraftValue("");
      editSecretValueRef.current = "";
    }
  }

  function updateOption(
    index: number,
    field: keyof SettingValueOption,
    nextValue: string,
  ) {
    const previous = draftValueOptions[index];
    setDraftValueOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, [field]: nextValue } : option,
      ),
    );
    if (field === "value" && draftValue === previous?.value) {
      setDraftValue(nextValue);
    }
  }

  function addOption() {
    const nextValue = makeNextOptionValue(draftValueOptions);
    setDraftValueOptions((current) => [
      ...current,
      { label: `${tr("选项")} ${current.length + 1}`, value: nextValue },
    ]);
    if (draftValueType === "enum" && !draftValue) {
      setDraftValue(nextValue);
    }
  }

  function removeOption(index: number) {
    if (draftValueOptions.length <= 1) return;
    const removed = draftValueOptions[index];
    const next = draftValueOptions.filter(
      (_, optionIndex) => optionIndex !== index,
    );
    setDraftValueOptions(next);
    if (draftValue === removed?.value) {
      setDraftValue(next[0]?.value ?? "");
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={disabled || saving} size="icon" type="button" variant="ghost">
          <AppIcon className="size-4" name="pencil" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("编辑设置")}</DialogTitle>
          <DialogDescription className="break-all font-mono">
            {name}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-edit-type`}>{tr("类型")}</Label>
            <Select
              disabled={busy}
              onValueChange={(nextValue) =>
                changeValueType(nextValue as SettingValueType)
              }
              value={draftValueType}
            >
              <SelectTrigger className="w-full" id={`${idPrefix}-edit-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {tr(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draftValueType === "enum" && (
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{tr("枚举选项")}</div>
                <Button
                  disabled={busy}
                  onClick={addOption}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <AppIcon className="size-3.5" name="plus" />
                  {tr("添加选项")}
                </Button>
              </div>
              <div className="grid gap-2">
                {draftValueOptions.map((option, index) => (
                  <div
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]"
                    key={`${option.value}-${index}`}
                  >
                    <Input
                      disabled={busy}
                      onChange={(event) =>
                        updateOption(index, "label", event.currentTarget.value)
                      }
                      placeholder={tr("显示名称")}
                      value={option.label}
                    />
                    <Input
                      disabled={busy}
                      onChange={(event) =>
                        updateOption(index, "value", event.currentTarget.value)
                      }
                      placeholder={tr("值")}
                      value={option.value}
                    />
                    <Button
                      disabled={busy || draftValueOptions.length <= 1}
                      onClick={() => removeOption(index)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <AppIcon className="size-4" name="x" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-edit-value`}>{tr("值")}</Label>
            <SettingValueInput
              disabled={busy}
              id={`${idPrefix}-edit-value`}
              onValueChange={(nextValue) => {
                if (draftValueType === "secret") {
                  editSecretValueRef.current =
                    typeof nextValue === "string" ? nextValue : "";
                  return;
                }
                setDraftValue(nextValue);
              }}
              value={draftValueType === "secret" ? undefined : draftValue}
              valueOptions={effectiveValueOptions}
              valueType={draftValueType}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button disabled={busy} type="submit">
              {tr("保存")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDraftValue(
  value: SettingPayloadValue | undefined,
  valueType: SettingValueType,
) {
  if (value === undefined || value === null) return "";
  if (valueType === "boolean") {
    return value === true || value === "true" ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function normalizeDraftValue(
  draft: string,
  valueType: SettingValueType,
  valueOptions?: readonly SettingValueOption[] | null,
  tr: (value: string) => string = identityTranslator,
):
  | { ok: true; value: SettingPayloadValue }
  | { error: string; ok: false } {
  if (valueType === "boolean") {
    if (draft === "true") return { ok: true, value: true };
    if (draft === "false" || draft === "") return { ok: true, value: false };
    return { error: tr("布尔设置值必须为 true 或 false"), ok: false };
  }

  if (valueType === "number") {
    const normalized = draft.trim();
    const parsed = Number(normalized);
    if (!normalized || !Number.isFinite(parsed)) {
      return { error: tr("数字设置值无效"), ok: false };
    }
    return { ok: true, value: String(parsed) };
  }

  if (valueType === "json") {
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(draft)) };
    } catch {
      return { error: tr("JSON 设置值格式无效"), ok: false };
    }
  }

  if (valueType === "enum") {
    const normalized = draft.trim();
    if (!valueOptions?.length) {
      return { error: tr("枚举设置必须提供选项"), ok: false };
    }
    if (!valueOptions.some((option) => option.value === normalized)) {
      return { error: tr("枚举设置值不在选项范围内"), ok: false };
    }
    return { ok: true, value: normalized };
  }

  if (valueType === "secret") {
    if (!draft) {
      return { error: tr("密钥设置值不能为空"), ok: false };
    }
    return { ok: true, value: draft };
  }

  return { ok: true, value: draft };
}

function normalizeCustomOptions(
  options: readonly SettingValueOption[],
  tr: (value: string) => string = identityTranslator,
):
  | { ok: true; value: SettingValueOption[] }
  | { error: string; ok: false } {
  if (options.length === 0) {
    return { error: tr("枚举设置至少需要一个选项"), ok: false };
  }

  const seen = new Set<string>();
  const normalized: SettingValueOption[] = [];
  for (const option of options) {
    const value = option.value.trim();
    if (!value) {
      return { error: tr("枚举选项值不能为空"), ok: false };
    }
    if (seen.has(value)) {
      return { error: tr("枚举选项值不能重复"), ok: false };
    }
    seen.add(value);
    normalized.push({
      label: option.label.trim() || value,
      value,
    });
  }
  return { ok: true, value: normalized };
}

function makeDefaultEnumOptions(tr: (value: string) => string) {
  return [{ label: tr("选项 1"), value: DEFAULT_ENUM_OPTION_VALUE }];
}

function cloneSettingOptions(
  options?: readonly SettingValueOption[] | null,
) {
  return options?.map((option) => ({ ...option })) ?? null;
}

function makeNextOptionValue(options: readonly SettingValueOption[]) {
  let index = options.length + 1;
  let value = `option_${index}`;
  const existing = new Set(options.map((option) => option.value));
  while (existing.has(value)) {
    index += 1;
    value = `option_${index}`;
  }
  return value;
}
