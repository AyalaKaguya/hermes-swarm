"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelTenantApplication,
  getPublicBootstrap,
  submitTenantApplication,
  verifyTenantApplication,
  type TenantApplicationSubmission,
} from "@/lib/admin-api";
import { resolveWorkspaceApplicationsEnabled } from "@/lib/platform-settings";

export function TenantApplicationForm() {
  const t = useTranslations("tenantApplication");
  const searchParams = useSearchParams();
  const verificationStarted = useRef(false);
  const [requestedName, setRequestedName] = useState("");
  const [requestedSlug, setRequestedSlug] = useState("");
  const [requestedSubdomain, setRequestedSubdomain] = useState("");
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [submission, setSubmission] = useState<TenantApplicationSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationState, setVerificationState] = useState<"idle" | "verifying" | "verified" | "failed">("idle");
  const [cancellationState, setCancellationState] = useState<"idle" | "cancelling" | "cancelled" | "failed">("idle");
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<
    "checking" | "enabled" | "disabled" | "failed"
  >("checking");
  const applicationId = searchParams.get("applicationId");
  const verificationToken = searchParams.get("token");
  const cancellationToken = searchParams.get("cancelToken");

  useEffect(() => {
    if (
      applicationId &&
      (verificationToken || cancellationToken)
    ) {
      setAvailability("enabled");
      return;
    }
    let cancelled = false;
    void getPublicBootstrap()
      .then((bootstrap) => {
        if (cancelled) return;
        setAvailability(
          resolveWorkspaceApplicationsEnabled(bootstrap.systemSettings)
            ? "enabled"
            : "disabled",
        );
      })
      .catch(() => {
        if (!cancelled) setAvailability("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, cancellationToken, verificationToken]);

  useEffect(() => {
    if (!applicationId || !verificationToken || verificationStarted.current) return;
    verificationStarted.current = true;
    setVerificationState("verifying");
    setError("");
    void verifyTenantApplication(applicationId, verificationToken)
      .then(() => setVerificationState("verified"))
      .catch((verifyError) => {
        setError(getErrorMessage(verifyError, t("verificationFailed")));
        setVerificationState("failed");
      });
  }, [applicationId, t, verificationToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await submitTenantApplication({
        ownerDisplayName: ownerDisplayName.trim(),
        ownerEmail: ownerEmail.trim(),
        requestedName: requestedName.trim(),
        requestedSlug: requestedSlug.trim(),
        requestedSubdomain: requestedSubdomain.trim() || null,
      });
      setSubmission(result);
    } catch (submitError) {
      setError(getErrorMessage(submitError, t("submitFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelApplication() {
    if (!applicationId || !cancellationToken || cancellationState === "cancelling") return;
    setCancellationState("cancelling");
    setError("");
    try {
      await cancelTenantApplication(applicationId, cancellationToken);
      setCancellationState("cancelled");
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, t("cancellationFailed")));
      setCancellationState("failed");
    }
  }

  if (applicationId && cancellationToken) {
    return (
      <PublicCard
        description={
          cancellationState === "cancelled"
            ? t("cancelledDescription")
            : t("cancellationDescription")
        }
        icon="building"
        title={
          cancellationState === "cancelled"
            ? t("cancelledTitle")
            : t("cancelTitle")
        }
      >
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {cancellationState !== "cancelled" && (
          <Button
            className="w-full"
            disabled={cancellationState === "cancelling"}
            onClick={() => void cancelApplication()}
            variant="destructive"
          >
            {cancellationState === "cancelling" ? t("cancelling") : t("confirmCancel")}
          </Button>
        )}
        <Button asChild className="w-full" variant="ghost">
          <Link href="/login">{t("backToSignIn")}</Link>
        </Button>
      </PublicCard>
    );
  }

  if (applicationId && verificationToken) {
    return (
      <PublicCard
        description={
          verificationState === "verified"
            ? t("verifiedDescription")
            : t("verificationDescription")
        }
        icon={verificationState === "verified" ? "check" : "mail"}
        title={verificationState === "verified" ? t("verifiedTitle") : t("verifyTitle")}
      >
        {verificationState === "verifying" && <Status>{t("verifying")}</Status>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {(verificationState === "verified" || verificationState === "failed") && (
          <Button asChild className="w-full" variant="outline">
            <Link href="/login">{t("backToSignIn")}</Link>
          </Button>
        )}
      </PublicCard>
    );
  }

  if (submission) {
    const verificationHref = submission.verificationToken
      ? `/apply?applicationId=${encodeURIComponent(submission.applicationId)}&token=${encodeURIComponent(submission.verificationToken)}`
      : null;
    const cancellationHref = submission.cancellationToken
      ? `/apply?applicationId=${encodeURIComponent(submission.applicationId)}&cancelToken=${encodeURIComponent(submission.cancellationToken)}`
      : null;
    return (
      <PublicCard description={t("submittedDescription")} icon="mail" title={t("submittedTitle")}>
        <Status>{t("checkEmail")}</Status>
        {verificationHref && (
          <Button asChild className="w-full">
            <Link href={verificationHref}>{t("verifyDevelopment")}</Link>
          </Button>
        )}
        {cancellationHref && (
          <Button asChild className="w-full" variant="outline">
            <Link href={cancellationHref}>{t("cancelApplication")}</Link>
          </Button>
        )}
        <Button asChild className="w-full" variant="ghost">
          <Link href="/login">{t("backToSignIn")}</Link>
        </Button>
      </PublicCard>
    );
  }

  if (availability !== "enabled") {
    const unavailable = availability === "disabled";
    return (
      <PublicCard
        description={
          unavailable
            ? t("unavailableDescription")
            : availability === "failed"
              ? t("availabilityFailed")
              : t("availabilityChecking")
        }
        icon="building"
        title={unavailable ? t("unavailableTitle") : t("title")}
      >
        <Button asChild className="w-full" variant="ghost">
          <Link href="/login">{t("backToSignIn")}</Link>
        </Button>
      </PublicCard>
    );
  }

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4 py-10">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-xl" size="sm">
        <CardHeader className="gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
            <AppIcon className="size-4" name="building" />
          </div>
          <div className="grid gap-1">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("tenantName")} name="tenant-application-name">
                <Input id="tenant-application-name" onChange={(event) => setRequestedName(event.target.value)} required value={requestedName} />
              </Field>
              <Field label={t("tenantSlug")} name="tenant-application-slug">
                <Input id="tenant-application-slug" onChange={(event) => setRequestedSlug(event.target.value.toLowerCase())} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={requestedSlug} />
              </Field>
              <Field label={t("subdomain")} name="tenant-application-subdomain">
                <Input id="tenant-application-subdomain" onChange={(event) => setRequestedSubdomain(event.target.value.toLowerCase())} value={requestedSubdomain} />
              </Field>
              <Field label={t("ownerName")} name="tenant-application-owner-name">
                <Input id="tenant-application-owner-name" onChange={(event) => setOwnerDisplayName(event.target.value)} required value={ownerDisplayName} />
              </Field>
            </div>
            <Field label={t("ownerEmail")} name="tenant-application-owner-email">
              <Input autoComplete="email" id="tenant-application-owner-email" onChange={(event) => setOwnerEmail(event.target.value)} required type="email" value={ownerEmail} />
            </Field>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Button disabled={submitting} type="submit">
              {submitting ? t("submitting") : t("submit")}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/login">{t("backToSignIn")}</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function PublicCard({ children, description, icon, title }: { children: React.ReactNode; description: string; icon: "building" | "check" | "mail"; title: string }) {
  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground"><AppIcon className="size-4" name={icon} /></div>
          <div className="grid gap-1"><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>
        </CardHeader>
        <CardContent className="grid gap-3">{children}</CardContent>
      </Card>
    </main>
  );
}

function Field({ children, label, name }: { children: React.ReactNode; label: string; name: string }) {
  return <div className="grid gap-1.5"><Label htmlFor={name}>{label}</Label>{children}</div>;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="error">{children}</InlineNotice>;
}

function Status({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="success">{children}</InlineNotice>;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
