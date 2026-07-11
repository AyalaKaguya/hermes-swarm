"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  approveTenantApplication,
  listTenantApplications,
  listPlatformTenants,
  rejectTenantApplication,
  updatePlatformTenantStatus,
  type Tenant,
  type TenantApplication,
  type TenantApplicationStatus,
} from "@/lib/admin-api";
import { withAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";

type ReviewAction = "approve" | "reject";
type ManagedTenantStatus = "active" | "archived" | "suspended";

export function TenantApplicationsPage() {
  const t = useTranslations("platform");
  const { snapshot } = useAdminShell();
  const [applications, setApplications] = useState<TenantApplication[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewing, setReviewing] = useState<TenantApplication | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction>("approve");
  const [organizationName, setOrganizationName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusChange, setStatusChange] = useState<{
    status: ManagedTenantStatus;
    tenant: Tenant;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [applicationResult, tenantResult] =
        await withAuthenticatedAdminSessionMarker((session) =>
          Promise.all([
            listTenantApplications(session),
            listPlatformTenants(session),
          ]),
        );
      setApplications(applicationResult);
      setTenants(tenantResult);
    } catch (loadError) {
      setError(getErrorMessage(loadError, t("loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (snapshot?.principalType === "platform") void load();
  }, [load, snapshot?.principalType]);

  function openReview(application: TenantApplication, action: ReviewAction) {
    setReviewing(application);
    setReviewAction(action);
    setOrganizationName(application.requestedName);
    setNote("");
    setError("");
    setSuccess("");
  }

  async function submitReview() {
    if (!reviewing || saving) return;
    setSaving(true);
    setError("");
    try {
      if (reviewAction === "approve") {
        const result = await withAuthenticatedAdminSessionMarker((session) =>
          approveTenantApplication(session, reviewing.id, {
            note: note.trim() || null,
            organizationName: organizationName.trim() || reviewing.requestedName,
          }),
        );
        setSuccess(
          result.ownerActivationToken
            ? t("approvedWithToken", { token: result.ownerActivationToken })
            : t("approved"),
        );
      } else {
        await withAuthenticatedAdminSessionMarker((session) =>
          rejectTenantApplication(session, reviewing.id, {
            note: note.trim() || null,
          }),
        );
        setSuccess(t("rejected"));
      }
      setReviewing(null);
      await load();
    } catch (reviewError) {
      setError(getErrorMessage(reviewError, t("reviewFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function submitStatusChange() {
    if (!statusChange || saving) return;
    setSaving(true);
    setError("");
    try {
      await withAuthenticatedAdminSessionMarker((session) =>
        updatePlatformTenantStatus(
          session,
          statusChange.tenant.id,
          statusChange.status,
        ),
      );
      setSuccess(t("tenantStatusUpdated"));
      setStatusChange(null);
      await load();
    } catch (statusError) {
      setError(getErrorMessage(statusError, t("tenantStatusFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {t("tenantGovernance")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("tenantGovernanceDescription")}
          </p>
        </div>
        <Button disabled={loading} onClick={() => void load()} variant="outline">
          <AppIcon className="size-4" name="refresh" />
          {t("refresh")}
        </Button>
      </div>

      {error && <Feedback kind="error">{error}</Feedback>}
      {success && <Feedback kind="success">{success}</Feedback>}

      <Card>
        <CardHeader>
          <CardTitle>{t("tenantDirectory")}</CardTitle>
          <CardDescription>{t("tenantCount", { count: tenants.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : tenants.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{t("emptyTenants")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenant")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <div className="grid gap-0.5">
                        <span className="font-medium">{tenant.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{tenant.slug}</span>
                      </div>
                    </TableCell>
                    <TableCell><TenantStatusBadge status={tenant.status} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {tenant.status === "active" ? (
                          <Button onClick={() => setStatusChange({ status: "suspended", tenant })} size="sm" variant="outline">{t("suspend")}</Button>
                        ) : tenant.status !== "archived" ? (
                          <Button onClick={() => setStatusChange({ status: "active", tenant })} size="sm">{t("activate")}</Button>
                        ) : null}
                        {tenant.status !== "archived" && (
                          <Button onClick={() => setStatusChange({ status: "archived", tenant })} size="sm" variant="destructive">{t("archive")}</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("applicationQueue")}</CardTitle>
          <CardDescription>
            {t("applicationCount", { count: applications.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : applications.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t("emptyApplications")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenant")}</TableHead>
                  <TableHead>{t("applicant")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("submittedAt")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <div className="grid gap-0.5">
                        <span className="font-medium">{application.requestedName}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {application.requestedSlug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-0.5">
                        <span>{application.ownerDisplayName}</span>
                        <span className="text-xs text-muted-foreground">
                          {application.ownerEmail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={application.status} />
                    </TableCell>
                    <TableCell>{formatDate(application.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          disabled={application.status !== "pending_review"}
                          onClick={() => openReview(application, "approve")}
                          size="sm"
                        >
                          {t("approve")}
                        </Button>
                        <Button
                          disabled={
                            application.status !== "pending_review" &&
                            application.status !== "pending_email_verification"
                          }
                          onClick={() => openReview(application, "reject")}
                          size="sm"
                          variant="outline"
                        >
                          {t("reject")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? t("approveApplication") : t("rejectApplication")}
            </DialogTitle>
            <DialogDescription>
              {reviewing
                ? t("reviewDescription", { name: reviewing.requestedName })
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {reviewAction === "approve" && (
              <div className="grid gap-1.5">
                <Label htmlFor="application-organization-name">
                  {t("defaultOrganization")}
                </Label>
                <Input
                  id="application-organization-name"
                  onChange={(event) => setOrganizationName(event.target.value)}
                  value={organizationName}
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="application-review-note">{t("reviewNote")}</Label>
              <Textarea
                id="application-review-note"
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("reviewNotePlaceholder")}
                value={note}
              />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button
              disabled={saving || (reviewAction === "approve" && !organizationName.trim())}
              onClick={() => void submitReview()}
              variant={reviewAction === "reject" ? "destructive" : "default"}
            >
              {saving
                ? t("processing")
                : reviewAction === "approve"
                  ? t("confirmApprove")
                  : t("confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(statusChange)} onOpenChange={(open) => !open && setStatusChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changeTenantStatus")}</DialogTitle>
            <DialogDescription>
              {statusChange
                ? t("changeTenantStatusDescription", {
                    name: statusChange.tenant.name,
                    status: t(`tenantStatuses.${statusChange.status}`),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              disabled={saving}
              onClick={() => void submitStatusChange()}
              variant={statusChange?.status === "archived" ? "destructive" : "default"}
            >
              {saving ? t("processing") : t("confirmStatusChange")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusBadge({ status }: { status: TenantApplicationStatus }) {
  const t = useTranslations("platform.statuses");
  const variant =
    status === "approved"
      ? "default"
      : status === "rejected" || status === "cancelled"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{t(status)}</Badge>;
}

function TenantStatusBadge({ status }: { status: Tenant["status"] }) {
  const t = useTranslations("platform.tenantStatuses");
  return (
    <Badge variant={status === "active" ? "default" : status === "archived" ? "destructive" : "secondary"}>
      {t(status)}
    </Badge>
  );
}

function Feedback({ children, kind }: { children: React.ReactNode; kind: "error" | "success" }) {
  return (
    <div
      className={
        kind === "error"
          ? "rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm"
          : "rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm"
      }
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

function formatDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp) : "—";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
