"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { TIME_ZONE_OPTIONS } from "@hermes-swarm/core/settings/definitions";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  fetchMe,
  getPublicBootstrap,
  isUnauthorizedApiError,
  onboard,
  resumeOnboarding,
  type PrincipalSession,
  type PublicBootstrap,
} from "@/lib/admin-api";
import {
  createWorkspaceSlug,
  validateOnboardingStep,
  type OnboardingValidationIssue,
} from "@/lib/onboarding";
import { rememberWorkspace } from "@/lib/login-workspace";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";

const LANGUAGE_OPTIONS = [
  { label: "简体中文", value: "zh-Hans" },
  { label: "繁體中文", value: "zh-Hant" },
  { label: "English", value: "en" },
] as const;
const STEP_TRANSLATIONS = [
  {
    description: "onboarding.steps.0.description",
    shortTitle: "onboarding.steps.0.shortTitle",
    title: "onboarding.steps.0.title",
  },
  {
    description: "onboarding.steps.1.description",
    shortTitle: "onboarding.steps.1.shortTitle",
    title: "onboarding.steps.1.title",
  },
  {
    description: "onboarding.steps.2.description",
    shortTitle: "onboarding.steps.2.shortTitle",
    title: "onboarding.steps.2.title",
  },
  {
    description: "onboarding.steps.3.description",
    shortTitle: "onboarding.steps.3.shortTitle",
    title: "onboarding.steps.3.title",
  },
] as const;
const VALIDATION_TRANSLATIONS: Record<
  OnboardingValidationIssue,
  | "onboarding.validation.adminRequired"
  | "onboarding.validation.emailInvalid"
  | "onboarding.validation.passwordLength"
  | "onboarding.validation.passwordMismatch"
  | "onboarding.validation.platformTitleRequired"
  | "onboarding.validation.slugInvalid"
  | "onboarding.validation.workspaceRequired"
> = {
  adminRequired: "onboarding.validation.adminRequired",
  emailInvalid: "onboarding.validation.emailInvalid",
  passwordLength: "onboarding.validation.passwordLength",
  passwordMismatch: "onboarding.validation.passwordMismatch",
  platformTitleRequired: "onboarding.validation.platformTitleRequired",
  slugInvalid: "onboarding.validation.slugInvalid",
  workspaceRequired: "onboarding.validation.workspaceRequired",
};

export function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations();
  const { language, runtimePreferences, setRuntimePreferences } = useI18n();
  const slugEdited = useRef(false);
  const [onboardingState, setOnboardingState] = useState<
    PublicBootstrap["onboardingState"] | null
  >(null);
  const [principal, setPrincipal] = useState<PrincipalSession | null>(null);
  const [step, setStep] = useState(0);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [platformTitle, setPlatformTitle] = useState("Hermes Swarm");
  const [defaultLanguage, setDefaultLanguage] = useState(language);
  const [defaultTimeZone, setDefaultTimeZone] = useState(
    runtimePreferences.timeZone,
  );
  const [workspaceApplicationsEnabled, setWorkspaceApplicationsEnabled] =
    useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [error, setError] = useState("");

  const resumeMode = onboardingState === "workspace_required";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const bootstrap = await getPublicBootstrap();
        if (cancelled) return;
        setOnboardingState(bootstrap.onboardingState);
        setPlatformTitle(
          resolvePlatformNameFromSettings(bootstrap.systemSettings) ??
            "Hermes Swarm",
        );
        if (bootstrap.onboardingState === "workspace_required") {
          try {
            const current = await fetchMe();
            if (cancelled) return;
            if (current.principalType !== "platform") {
              router.replace("/login?context=platform&next=%2Fonboarding");
              return;
            }
            setPrincipal(current);
          } catch (loadError) {
            if (isUnauthorizedApiError(loadError)) {
              router.replace("/login?context=platform&next=%2Fonboarding");
              return;
            }
            throw loadError;
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, t("common.operationFailed")));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadVersion, router, t]);

  function updateWorkspaceName(value: string) {
    setWorkspaceName(value);
    if (!slugEdited.current) setWorkspaceSlug(createWorkspaceSlug(value));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (step < 2) {
      setError("");
      setStep((current) => current + 1);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const workspacePayload = {
        defaultLanguage,
        defaultTimeZone,
        platformTitle: platformTitle.trim(),
        workspaceApplicationsEnabled,
        workspaceName: workspaceName.trim(),
        workspaceSlug: workspaceSlug.trim(),
      };
      const response = resumeMode
        ? await resumeOnboarding(workspacePayload)
        : await onboard({
            ...workspacePayload,
            adminEmail: adminEmail.trim(),
            adminName: adminName.trim(),
            adminPassword,
          });
      if (response.snapshot.principalType !== "workspace") {
        throw new Error(t("onboarding.validation.workspaceSessionRequired"));
      }
      if (response.snapshot.workspace?.slug) {
        rememberWorkspace(window.localStorage, response.snapshot.workspace.slug);
      }
      setRuntimePreferences(response.snapshot.runtimePreferences);
      setStep(3);
      window.requestAnimationFrame(() => router.replace("/home"));
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("common.operationFailed")));
    } finally {
      setSaving(false);
    }
  }

  function validateStep() {
    const issue = validateOnboardingStep({
      adminEmail,
      adminName,
      adminPassword,
      confirmPassword,
      platformTitle,
      resumeMode,
      step,
      workspaceName,
      workspaceSlug,
    });
    return issue ? t(VALIDATION_TRANSLATIONS[issue]) : "";
  }

  if (loading || onboardingState === null) {
    return (
      <OnboardingFrame>
        {error ? (
          <div className="grid min-h-56 content-center gap-3 p-6">
            <InlineNotice tone="error">{error}</InlineNotice>
            <Button
              className="justify-self-end"
              onClick={() => setLoadVersion((current) => current + 1)}
              type="button"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            <span>{t("onboarding.loading")}</span>
          </div>
        )}
      </OnboardingFrame>
    );
  }

  if (onboardingState === "complete" || onboardingState === "recovery_required") {
    const recovery = onboardingState === "recovery_required";
    return (
      <OnboardingFrame>
        <CardHeader className="gap-3">
          <BrandHeader platformName={platformTitle} />
          <div className="grid gap-1">
            <CardTitle>
              {t(recovery ? "onboarding.recoveryTitle" : "onboarding.alreadyCompleteTitle")}
            </CardTitle>
            <CardDescription>
              {t(recovery ? "onboarding.recoveryDescription" : "onboarding.alreadyCompleteDescription")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <InlineNotice tone={recovery ? "error" : "info"}>
            {t(recovery ? "onboarding.recoveryNotice" : "onboarding.alreadyCompleteNotice")}
          </InlineNotice>
        </CardContent>
        <CardFooter className="justify-end">
          {recovery ? (
            <Button
              onClick={() => setLoadVersion((current) => current + 1)}
              type="button"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          ) : (
            <Button asChild>
              <a href="/login">{t("auth.goToSignIn")}</a>
            </Button>
          )}
        </CardFooter>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame>
      <CardHeader className="gap-4">
        <BrandHeader platformName={platformTitle} />
        <div className="grid gap-1">
          <CardTitle>{t("onboarding.title")}</CardTitle>
          <CardDescription>
            {t(resumeMode ? "onboarding.resumeDescription" : "onboarding.description")}
          </CardDescription>
        </div>
        <StepProgress currentStep={step} />
      </CardHeader>

      <form onSubmit={submit}>
        <CardContent className="grid min-h-64 content-start gap-4">
          <div className="grid gap-1">
            <h2 className="text-sm font-semibold">
              {t(STEP_TRANSLATIONS[step]?.title ?? STEP_TRANSLATIONS[0].title)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t(
                STEP_TRANSLATIONS[step]?.description ??
                  STEP_TRANSLATIONS[0].description,
              )}
            </p>
          </div>

          {step === 0 && (
            resumeMode ? (
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                    <AppIcon className="size-4" name="shield" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {principal?.account.displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {principal?.account.email}
                    </p>
                  </div>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <AppIcon className="size-3.5" name="check" />
                    {t("onboarding.adminReady")}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("onboarding.adminName")} htmlFor="onboarding-admin-name">
                  <Input
                    autoComplete="name"
                    id="onboarding-admin-name"
                    onChange={(event) => setAdminName(event.target.value)}
                    required
                    value={adminName}
                  />
                </Field>
                <Field label={t("onboarding.adminEmail")} htmlFor="onboarding-admin-email">
                  <Input
                    autoComplete="email"
                    id="onboarding-admin-email"
                    onChange={(event) => setAdminEmail(event.target.value)}
                    required
                    type="email"
                    value={adminEmail}
                  />
                </Field>
                <Field label={t("onboarding.adminPassword")} htmlFor="onboarding-admin-password">
                  <Input
                    autoComplete="new-password"
                    id="onboarding-admin-password"
                    minLength={8}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    required
                    type="password"
                    value={adminPassword}
                  />
                </Field>
                <Field label={t("onboarding.confirmPassword")} htmlFor="onboarding-confirm-password">
                  <Input
                    autoComplete="new-password"
                    id="onboarding-confirm-password"
                    minLength={8}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    type="password"
                    value={confirmPassword}
                  />
                </Field>
              </div>
            )
          )}

          {step === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("onboarding.workspaceName")} htmlFor="onboarding-workspace-name">
                <Input
                  id="onboarding-workspace-name"
                  onChange={(event) => updateWorkspaceName(event.target.value)}
                  required
                  value={workspaceName}
                />
              </Field>
              <Field label={t("onboarding.workspaceSlug")} htmlFor="onboarding-workspace-slug">
                <Input
                  id="onboarding-workspace-slug"
                  onChange={(event) => {
                    slugEdited.current = true;
                    setWorkspaceSlug(event.target.value.toLowerCase());
                  }}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                  value={workspaceSlug}
                />
                <p className="text-xs text-muted-foreground">
                  {t("onboarding.workspaceSlugHint")}
                </p>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <Field label={t("onboarding.platformTitle")} htmlFor="onboarding-platform-title">
                <Input
                  id="onboarding-platform-title"
                  onChange={(event) => setPlatformTitle(event.target.value)}
                  required
                  value={platformTitle}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("onboarding.defaultLanguage")} htmlFor="onboarding-default-language">
                  <Select
                    onValueChange={(value) =>
                      setDefaultLanguage(value as typeof defaultLanguage)
                    }
                    value={defaultLanguage}
                  >
                    <SelectTrigger className="w-full" id="onboarding-default-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("onboarding.defaultTimeZone")} htmlFor="onboarding-default-time-zone">
                  <Select onValueChange={setDefaultTimeZone} value={defaultTimeZone}>
                    <SelectTrigger className="w-full" id="onboarding-default-time-zone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_ZONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="onboarding-workspace-applications">
                    {t("onboarding.workspaceApplicationsEnabled")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.workspaceApplicationsHint")}
                  </p>
                </div>
                <Switch
                  checked={workspaceApplicationsEnabled}
                  id="onboarding-workspace-applications"
                  onCheckedChange={setWorkspaceApplicationsEnabled}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid place-items-center gap-3 py-8 text-center">
              <div className="grid size-12 place-items-center rounded-full border bg-muted text-foreground">
                <AppIcon className="size-5" name="check" />
              </div>
              <p className="text-sm font-medium">{t("onboarding.completeTitle")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t("onboarding.completeDescription")}
              </p>
            </div>
          )}

          {error && (
            <InlineNotice tone="error">
              <div className="flex items-center justify-between gap-3">
                <span>{error}</span>
                {onboardingState === null && (
                  <Button
                    onClick={() => setLoadVersion((current) => current + 1)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("common.retry")}
                  </Button>
                )}
              </div>
            </InlineNotice>
          )}
        </CardContent>

        {step < 3 && (
          <CardFooter className="flex justify-between gap-2">
            <Button
              disabled={step === 0 || saving}
              onClick={() => {
                setError("");
                setStep((current) => Math.max(0, current - 1));
              }}
              type="button"
              variant="ghost"
            >
              {t("onboarding.previous")}
            </Button>
            <Button disabled={saving} type="submit">
              {saving && <Spinner />}
              {saving
                ? t("onboarding.saving")
                : step === 2
                  ? t("onboarding.createAndEnter")
                  : t("onboarding.next")}
            </Button>
          </CardFooter>
        )}
      </form>
    </OnboardingFrame>
  );
}

function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-2xl" size="sm">
        {children}
      </Card>
    </main>
  );
}

function BrandHeader({ platformName }: { platformName?: string | null }) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2">
      <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
        <AppIcon className="size-4" name="sparkles" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {platformName?.trim() || "Hermes Swarm"}
        </p>
        <p className="text-xs text-muted-foreground">{t("onboarding.firstSetup")}</p>
      </div>
    </div>
  );
}

function StepProgress({ currentStep }: { currentStep: number }) {
  const t = useTranslations();
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={t("onboarding.progressLabel")}>
      {[0, 1, 2, 3].map((item) => {
        const complete = item < currentStep;
        const active = item === currentStep;
        return (
          <li className="grid gap-1.5" key={item} aria-current={active ? "step" : undefined}>
            <div className="flex items-center gap-2">
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium ${
                  complete || active
                    ? "border-foreground bg-foreground text-background"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {complete ? <AppIcon className="size-3.5" name="check" /> : item + 1}
              </span>
              {item < 3 && <span className="h-px flex-1 bg-border" />}
            </div>
            <span className={active ? "text-xs font-medium" : "text-xs text-muted-foreground"}>
              {t(STEP_TRANSLATIONS[item]!.shortTitle)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
