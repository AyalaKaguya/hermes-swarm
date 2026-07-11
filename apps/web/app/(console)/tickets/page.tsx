"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { useNotifications } from "@/components/app-notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";
import { useSourceConversation } from "@/hooks/use-source-conversation";
import {
  closeTicket,
  createOrganizationTicket,
  createTenantTicket,
  listOrganizationSettings,
  listOrganizationTickets,
  listTenantTickets,
  listTicketMessages,
  markTicketRead,
  sendTicketMessage,
  uploadAdminFile,
  type Ticket,
  type TicketMessage,
  type TicketMessageAttachment,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
  type AuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import {
  FEATURE_SETTING_KEYS,
  PLATFORM_SETTING_KEYS,
} from "@hermes-swarm/core/settings/definitions";

type TicketView = "organization" | "tenant";
type CreateDraft = {
  attachments: TicketMessageAttachment[];
  body: string;
  subject: string;
};

const ORGANIZATION_TICKETING_FEATURE_KEY = FEATURE_SETTING_KEYS.ticketing;
const ORGANIZATION_TICKET_HANDLING_FEATURE_KEY =
  FEATURE_SETTING_KEYS.ticketingHandling;
const ORGANIZATION_TICKET_HANDLE_PERMISSION =
  "ticket.conversation.handle:organization";
const TENANT_TICKET_HANDLE_PERMISSION =
  "ticket.tenant_conversation.list_tenant:own";

export default function TicketsPage() {
  const locale = useLocale();
  const tr = useTextTranslation();
  const { snapshot } = useAdminShell();
  const access = usePermission();
  const notifications = useNotifications();
  const organizationId = snapshot?.organization?.id ?? null;
  const currentUserId = snapshot?.user.id ?? null;
  const isCurrentOrganizationOwner = snapshot?.role?.name === "owner";
  const isAnyOrganizationOwner = snapshot?.memberships?.some(
    (membership) => membership.role?.name === "owner",
  );
  const ticketingVisible = getPlatformBooleanSetting(
    snapshot?.systemSettings,
    PLATFORM_SETTING_KEYS.ticketingVisible,
    true,
  );
  const tenantSubmissionEnabled = getPlatformBooleanSetting(
    snapshot?.systemSettings,
    PLATFORM_SETTING_KEYS.ticketingPlatformSubmissionEnabled,
    true,
  );
  const hasOrganizationTicketHandlePermission = access.hasPermission(
    ORGANIZATION_TICKET_HANDLE_PERMISSION,
  );
  const canHandleTenantTickets = access.hasPermission(
    TENANT_TICKET_HANDLE_PERMISSION,
  );
  const canViewOrganizationTickets =
    ticketingVisible && access.hasPageAccess("tickets");
  const canViewTenantTickets =
    ticketingVisible &&
    (access.hasPageAccess("tickets.tenant") ||
      canHandleTenantTickets ||
      Boolean(isAnyOrganizationOwner));
  const canCreateTenantTicket =
    canViewTenantTickets &&
    (tenantSubmissionEnabled ||
      Boolean(isAnyOrganizationOwner) ||
      canHandleTenantTickets);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationTicketingEnabled, setOrganizationTicketingEnabled] =
    useState(true);
  const [organizationTicketHandlingEnabled, setOrganizationTicketHandlingEnabled] =
    useState(true);
  const [previewAttachment, setPreviewAttachment] =
    useState<TicketMessageAttachment | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [uploading, setUploading] = useState<"create" | "message" | null>(null);
  const [view, setView] = useState<TicketView>("organization");

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, tickets],
  );
  const submittedTickets = useMemo(
    () => tickets.filter((ticket) => ticket.requesterUserId === currentUserId),
    [currentUserId, tickets],
  );
  const receivedTickets = useMemo(
    () => tickets.filter((ticket) => ticket.requesterUserId !== currentUserId),
    [currentUserId, tickets],
  );
  const canCreateOrganizationTicket =
    canViewOrganizationTickets &&
    Boolean(organizationId) &&
    (organizationTicketingEnabled || Boolean(isCurrentOrganizationOwner));
  const canHandleOrganizationTickets =
    hasOrganizationTicketHandlePermission && organizationTicketHandlingEnabled;
  const showConversationError = useCallback((message: string) => {
    setError(message);
  }, []);
  const handleSourceUpdated = useCallback((ticket: Ticket) => {
    mergeTicket(ticket);
  }, []);
  const loadConversationMessages = useCallback(
    (session: AuthenticatedAdminSessionMarker, ticketId: string) =>
      listTicketMessages(session, ticketId),
    [],
  );
  const markConversationRead = useCallback(
    (session: AuthenticatedAdminSessionMarker, ticketId: string) =>
      markTicketRead(session, ticketId),
    [],
  );
  const { appendMessage, messages } = useSourceConversation<TicketMessage, Ticket>({
    enabled: ticketingVisible,
    loadMessages: loadConversationMessages,
    markRead: markConversationRead,
    onError: showConversationError,
    onSourceUpdated: handleSourceUpdated,
    sourceId: selectedTicketId,
    sourceType: "ticket",
  });

  useEffect(() => {
    if (view === "organization" && !canViewOrganizationTickets && canViewTenantTickets) {
      setView("tenant");
    }
  }, [canViewOrganizationTickets, canViewTenantTickets, view]);

  const loadOrganizationFeatures = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token || !organizationId) {
      setOrganizationTicketingEnabled(true);
      setOrganizationTicketHandlingEnabled(true);
      return;
    }

    try {
      const settings = await listOrganizationSettings(
        token,
        organizationId,
      );
      const setting = settings.find(
        (item) => item.name === ORGANIZATION_TICKETING_FEATURE_KEY,
      );
      const handlingSetting = settings.find(
        (item) => item.name === ORGANIZATION_TICKET_HANDLING_FEATURE_KEY,
      );
      setOrganizationTicketingEnabled(setting?.value !== "false");
      setOrganizationTicketHandlingEnabled(handlingSetting?.value !== "false");
    } catch {
      setOrganizationTicketingEnabled(true);
      setOrganizationTicketHandlingEnabled(true);
    }
  }, [organizationId]);

  const loadTickets = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token || !ticketingVisible) {
      setLoading(false);
      return;
    }
    if (view === "organization" && !organizationId) {
      setTickets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextTickets =
        view === "tenant"
          ? await listTenantTickets(token)
          : await listOrganizationTickets(token, organizationId as string);
      setTickets(nextTickets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("工单加载失败"));
    } finally {
      setLoading(false);
    }
  }, [organizationId, ticketingVisible, tr, view]);

  useEffect(() => {
    void loadOrganizationFeatures();
  }, [loadOrganizationFeatures]);

  useEffect(() => {
    setSelectedTicketId(null);
    void loadTickets();
  }, [loadTickets]);

  function mergeTicket(ticket: Ticket) {
    setTickets((current) => {
      const exists = current.some((item) => item.id === ticket.id);
      const next = exists
        ? current.map((item) => (item.id === ticket.id ? ticket : item))
        : [ticket, ...current];
      return next.sort((left, right) =>
        String(right.lastMessageAt ?? right.updatedAt).localeCompare(
          String(left.lastMessageAt ?? left.updatedAt),
        ),
      );
    });
  }

  function openTicket(ticket: Ticket) {
    setSelectedTicketId(ticket.id);
  }

  async function createTicket() {
    if (!draft.subject.trim() || !draft.body.trim()) {
      return;
    }
    if (view === "organization" && !canCreateOrganizationTicket) return;
    if (view === "tenant" && !canCreateTenantTicket) return;

    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const payload = {
        attachments: draft.attachments,
        body: draft.body,
        subject: draft.subject,
      };
      const ticket =
        view === "tenant"
          ? await createTenantTicket(token, payload)
          : await createOrganizationTicket(
              token,
              organizationId as string,
              payload,
            );
      setDraft(emptyDraft());
      setCreateDialogOpen(false);
      notifications.success(tr("工单已创建"));
      await loadTickets();
      setSelectedTicketId(ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("创建失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendMessage(input: PromptInputMessage) {
    if (!selectedTicketId || !input.text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const attachments = await Promise.all(
        input.files.map((item) => uploadPromptAttachment(token, item)),
      );
      const message = await sendTicketMessage(token, selectedTicketId, {
        attachments,
        body: input.text,
      });
      appendMessage(message);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("发送失败"));
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadPromptAttachment(
    session: AuthenticatedAdminSessionMarker,
    filePart: PromptInputMessage["files"][number],
  ) {
    const file = await filePartToFile(filePart, tr);
    if (!file.type.startsWith("image/")) {
      throw new Error(tr("仅支持图片附件"));
    }
    const result = await uploadAdminFile(session, file);
    if (!result.url) throw new Error(tr("图片上传失败"));
    return {
      mimeType: result.mimeType,
      name: result.originalName ?? result.name ?? file.name,
      size: result.size,
      type: "image" as const,
      url: result.url,
    };
  }

  async function uploadAttachment(file: File, target: "create" | "message") {
    if (!file.type.startsWith("image/")) {
      setError(tr("仅支持图片附件"));
      return;
    }
    setUploading(target);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const result = await uploadAdminFile(token, file);
      if (!result.url) throw new Error(tr("图片上传失败"));
      const attachment: TicketMessageAttachment = {
        mimeType: result.mimeType,
        name: result.originalName ?? result.name ?? file.name,
        size: result.size,
        type: "image",
        url: result.url,
      };
      if (target === "create") {
        setDraft((current) => ({
          ...current,
          attachments: [...current.attachments, attachment],
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("图片上传失败"));
    } finally {
      setUploading(null);
    }
  }

  async function closeSelectedTicket() {
    if (!selectedTicket) return false;
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const nextTicket = await closeTicket(token, selectedTicket.id);
      mergeTicket(nextTicket);
      notifications.success(tr("工单已关闭"));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("关闭失败"));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  if (!ticketingVisible || (!canViewOrganizationTickets && !canViewTenantTickets)) {
    return (
      <div className="mx-auto grid min-h-[50vh] max-w-md place-items-center px-4 text-center">
        <div className="grid gap-2">
          <div className="text-sm font-medium">{tr("没有访问工单的权限")}</div>
          <div className="text-xs text-muted-foreground">
            {tr("当前角色没有工单页面访问权限，或平台已关闭工单入口。")}
          </div>
        </div>
      </div>
    );
  }

  const canCreateInCurrentView =
    view === "tenant" ? canCreateTenantTicket : canCreateOrganizationTicket;
  const canHandleTicketsInCurrentView =
    view === "tenant" ? canHandleTenantTickets : canHandleOrganizationTickets;
  const showSecondaryTicketPanel =
    canHandleTicketsInCurrentView || receivedTickets.length > 0;
  const secondaryTicketPanelTitle = canHandleTicketsInCurrentView
    ? tr("待处理工单")
    : tr("相关工单");
  const secondaryTicketEmptyLabel = canHandleTicketsInCurrentView
    ? tr("暂无待处理工单")
    : tr("暂无相关工单");
  const messageInputDisabled =
    !selectedTicket || selectedTicket.status === "archived" || submitting;

  return (
    <div className="mx-auto flex h-[calc(100svh-7rem)] w-full max-w-7xl flex-col gap-4 overflow-hidden md:h-[calc(100svh-4rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tr("工单")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("查看提交记录和待处理会话，打开工单后继续交流。")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(canViewOrganizationTickets || canViewTenantTickets) && (
            <Tabs
              onValueChange={(value) => setView(value as TicketView)}
              value={view}
            >
              <TabsList aria-label={tr("工单作用域")}>
                {canViewOrganizationTickets && (
                  <TabsTrigger value="organization">{tr("组织")}</TabsTrigger>
                )}
                {canViewTenantTickets && (
                  <TabsTrigger value="tenant">{tr("租户")}</TabsTrigger>
                )}
              </TabsList>
            </Tabs>
          )}
          <Button disabled={loading} onClick={() => void loadTickets()} size="sm" variant="outline">
            <AppIcon className="size-3.5" name="refresh" />
            {tr("刷新")}
          </Button>
          <Button
            disabled={!canCreateInCurrentView}
            onClick={() => setCreateDialogOpen(true)}
            size="sm"
            type="button"
          >
            <AppIcon className="size-3.5" name="plus" />
            {tr("新建")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {view === "organization" && !organizationTicketingEnabled && !isCurrentOrganizationOwner && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {tr("当前组织已关闭工单提交，普通成员只能查看已有工单。")}
        </div>
      )}

      {view === "organization" &&
        !organizationTicketHandlingEnabled &&
        hasOrganizationTicketHandlePermission && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {tr("当前组织已关闭工单处理，有处理权限的成员只能查看自己参与的工单。")}
          </div>
        )}

      {view === "tenant" && !tenantSubmissionEnabled && !canCreateTenantTicket && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {tr("租户工单提交已关闭。")}
        </div>
      )}

      <div
        className={`grid min-h-0 flex-1 gap-4 overflow-hidden ${
          showSecondaryTicketPanel ? "xl:grid-cols-2" : ""
        }`}
      >
        <TicketListPanel
          emptyLabel={loading ? tr("加载中...") : tr("暂无我提交的工单")}
          onOpen={openTicket}
          tickets={submittedTickets}
          title={tr("我提交的工单")}
        />
        {showSecondaryTicketPanel && (
          <TicketListPanel
            emptyLabel={loading ? tr("加载中...") : secondaryTicketEmptyLabel}
            onOpen={openTicket}
            tickets={receivedTickets}
            title={secondaryTicketPanelTitle}
          />
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {view === "tenant" ? tr("新建租户工单") : tr("新建组织工单")}
            </DialogTitle>
            <DialogDescription>
              {tr("支持 Markdown、图片附件和 @邮箱 或 @用户名提及。")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              onChange={(event) =>
                setDraft((current) => ({ ...current, subject: event.target.value }))
              }
              placeholder={tr("标题")}
              value={draft.subject}
            />
            <Textarea
              className="min-h-36"
              onChange={(event) =>
                setDraft((current) => ({ ...current, body: event.target.value }))
              }
              placeholder={tr("使用 Markdown 描述问题；输入 @邮箱 或 @用户名可提及成员")}
              value={draft.body}
            />
            <AttachmentPicker
              attachments={draft.attachments}
              disabled={uploading === "create"}
              onRemove={(index) =>
                setDraft((current) => ({
                  ...current,
                  attachments: current.attachments.filter((_, i) => i !== index),
                }))
              }
              onUpload={(file) => void uploadAttachment(file, "create")}
            />
            <div className="flex justify-end">
              <Button
                disabled={submitting || !draft.subject.trim() || !draft.body.trim()}
                onClick={() => void createTicket()}
                type="button"
              >
                {tr("保存")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedTicket)}
        onOpenChange={(open) => {
          if (!open) {
            setCloseConfirmOpen(false);
            setSelectedTicketId(null);
          }
        }}
      >
        <DialogContent className="grid h-[min(52rem,calc(100svh-2rem))] w-[min(72rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="border-b px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <DialogTitle className="truncate">
                  {selectedTicket?.subject ?? tr("工单")}
                </DialogTitle>
                <DialogDescription>
                  {selectedTicket
                    ? `${view === "tenant" ? tr("租户工单") : tr("组织工单")} · ${statusLabel(selectedTicket.status, tr)} · ${formatDate(selectedTicket.lastMessageAt ?? selectedTicket.createdAt, locale)}`
                    : tr("工单会话")}
                </DialogDescription>
              </div>
              {selectedTicket && selectedTicket.status !== "archived" && (
                <Button
                  className="bg-destructive text-white hover:bg-destructive/90 dark:hover:bg-destructive/80"
                  disabled={submitting}
                  onClick={() => setCloseConfirmOpen(true)}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {tr("关闭工单")}
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <ConversationPanel
              className="h-full"
              messages={messages}
              renderMessage={(message) => (
                <MessageBubble
                  currentUserId={currentUserId}
                  key={message.id}
                  message={message}
                  onPreviewAttachment={setPreviewAttachment}
                />
              )}
            />

            <div className="max-h-[14rem] overflow-auto border-t bg-background p-4">
              <PromptInput
                accept="image/*"
                maxFiles={6}
                multiple
                onError={(err) => {
                  setError(
                    err.code === "accept"
                      ? tr("仅支持图片附件")
                      : err.code === "max_files"
                        ? tr("最多上传 6 张图片")
                        : tr("图片附件过大"),
                  );
                }}
                onSubmit={sendMessage}
              >
                <PromptInputBody>
                  <PromptInputAttachmentPreview />
                  <PromptInputTextarea
                    disabled={messageInputDisabled}
                    placeholder={tr("输入 Markdown 消息；输入 @邮箱 或 @用户名可提及成员")}
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <PromptInputActionMenu>
                      <PromptInputActionMenuTrigger
                        disabled={messageInputDisabled}
                        tooltip={tr("添加图片")}
                      >
                        <AppIcon className="size-4" name="image-upload" />
                      </PromptInputActionMenuTrigger>
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments label={tr("图片")} />
                      </PromptInputActionMenuContent>
                    </PromptInputActionMenu>
                  </PromptInputTools>
                  <PromptInputSubmit disabled={messageInputDisabled} />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("关闭工单")}</DialogTitle>
            <DialogDescription>
              {tr(
                "关闭后，这个工单会从你的待处理流程中移出。对方仍可继续回复并重新打开会话；当双方都关闭后，工单会进入归档状态。",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-4 -mb-4">
            <Button
              disabled={submitting}
              onClick={() => setCloseConfirmOpen(false)}
              type="button"
              variant="outline"
            >
              {tr("取消")}
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90 dark:hover:bg-destructive/80"
              disabled={submitting}
              onClick={async () => {
                if (await closeSelectedTicket()) setCloseConfirmOpen(false);
              }}
              type="button"
              variant="destructive"
            >
              {tr("关闭工单")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      >
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="truncate">
              {previewAttachment?.name ?? tr("图片预览")}
            </DialogTitle>
            <DialogDescription>{tr("工单图片附件预览")}</DialogDescription>
          </DialogHeader>
          {previewAttachment && (
            <div className="grid max-h-[78svh] place-items-center overflow-auto bg-muted/20 p-4">
              <img
                alt={previewAttachment.name}
                className="max-h-[72svh] max-w-full rounded-md object-contain"
                src={previewAttachment.url}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PromptInputAttachmentPreview() {
  const tr = useTextTranslation();
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {attachments.files.map((file) => (
        <div
          className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs"
          key={file.id}
        >
          {file.url && (
            <img
              alt={file.filename ?? tr("图片附件")}
              className="size-8 rounded object-cover"
              src={file.url}
            />
          )}
          <span className="max-w-40 truncate">
            {file.filename ?? tr("图片附件")}
          </span>
          <Button
            aria-label={tr("移除附件")}
            onClick={() => attachments.remove(file.id)}
            size="icon-xs"
            title={tr("移除附件")}
            type="button"
            variant="ghost"
          >
            <AppIcon className="size-3" name="x" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function TicketListPanel({
  emptyLabel,
  onOpen,
  tickets,
  title,
}: {
  emptyLabel: string;
  onOpen: (ticket: Ticket) => void;
  tickets: Ticket[];
  title: string;
}) {
  const locale = useLocale();
  const tr = useTextTranslation();
  return (
    <section className="flex min-h-0 flex-col rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge variant="secondary">{tickets.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tickets.length === 0 ? (
          <div className="grid h-full min-h-64 place-items-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="grid gap-2">
            {tickets.map((ticket) => (
              <button
                className="grid gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={ticket.id}
                onClick={() => onOpen(ticket)}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {ticket.subject}
                  </span>
                  <Badge variant="outline">
                    {statusLabel(ticket.status, tr)}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {formatDate(ticket.lastMessageAt ?? ticket.createdAt, locale)}
                  </span>
                  <span>
                    {ticket.scope === "tenant"
                      ? tr("租户")
                      : ticket.scope === "department"
                        ? tr("部门")
                        : tr("组织")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MessageBubble({
  currentUserId,
  message,
  onPreviewAttachment,
}: {
  currentUserId: string | null;
  message: TicketMessage;
  onPreviewAttachment: (attachment: TicketMessageAttachment) => void;
}) {
  const locale = useLocale();
  const tr = useTextTranslation();
  const mine = message.authorUserId === currentUserId;
  const authorName =
    message.author?.displayName ||
    message.author?.username ||
    message.author?.email ||
    tr("未知用户");

  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          mine
            ? "grid max-w-[min(42rem,88%)] gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground"
            : "grid max-w-[min(42rem,88%)] gap-2 rounded-lg border bg-background px-3 py-2"
        }
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-80">
          <span className="font-medium">{authorName}</span>
          {message.author?.email && <span>{message.author.email}</span>}
          <span>{formatDate(message.createdAt, locale)}</span>
        </div>
        <MarkdownContent value={message.body} />
        {message.attachments.length > 0 && (
          <AttachmentGrid
            attachments={message.attachments}
            onPreview={onPreviewAttachment}
          />
        )}
      </div>
    </div>
  );
}

function AttachmentPicker({
  attachments,
  disabled,
  onRemove,
  onUpload,
}: {
  attachments: TicketMessageAttachment[];
  disabled?: boolean;
  onRemove: (index: number) => void;
  onUpload: (file: File) => void;
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-2">
      <label className="inline-flex h-8 w-fit cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm transition-colors hover:bg-muted has-disabled:pointer-events-none has-disabled:opacity-50">
        <AppIcon className="size-3.5" name="image-upload" />
        {tr("图片")}
        <input
          accept="image/*"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onUpload(file);
          }}
          type="file"
        />
      </label>
      {attachments.length > 0 && (
        <div className="grid gap-2">
          {attachments.map((attachment, index) => (
            <div
              className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
              key={`${attachment.url}-${index}`}
            >
              <span className="truncate">{attachment.name}</span>
              <Button
                aria-label={tr("移除附件")}
                onClick={() => onRemove(index)}
                size="icon-xs"
                title={tr("移除附件")}
                type="button"
                variant="ghost"
              >
                <AppIcon className="size-3" name="x" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentGrid({
  attachments,
  onPreview,
}: {
  attachments: TicketMessageAttachment[];
  onPreview: (attachment: TicketMessageAttachment) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attachments.map((attachment, index) => (
        <button
          className="group grid gap-1 rounded-md border bg-background/50 p-1 transition-colors hover:bg-muted"
          key={`${attachment.url}-${index}`}
          onClick={() => onPreview(attachment)}
          type="button"
        >
          <img
            alt={attachment.name}
            className="aspect-video w-full rounded object-cover"
            src={attachment.url}
          />
          <span className="truncate px-1 text-xs text-muted-foreground">
            {attachment.name}
          </span>
        </button>
      ))}
    </div>
  );
}

function MarkdownContent({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let listItems: ReactNode[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    nodes.push(
      <ul className="list-disc space-y-1 pl-5" key={`list-${nodes.length}`}>
        {listItems}
      </ul>,
    );
    listItems = [];
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      listItems.push(
        <li key={`li-${index}`}>{renderInlineMarkdown(listMatch[1] ?? "")}</li>,
      );
      return;
    }
    flushList();
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const className =
        level === 1
          ? "text-base font-semibold"
          : level === 2
            ? "text-sm font-semibold"
            : "text-sm font-medium";
      nodes.push(
        <div className={className} key={`h-${index}`}>
          {renderInlineMarkdown(headingMatch[2] ?? "")}
        </div>,
      );
      return;
    }
    nodes.push(
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" key={`p-${index}`}>
        {renderInlineMarkdown(line)}
      </p>,
    );
  });
  flushList();

  return <div className="grid gap-1.5">{nodes}</div>;
}

function renderInlineMarkdown(value: string) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9_.-]+)/g;
  const parts = value.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (linkMatch) {
      return (
        <a
          className="underline-offset-4 hover:underline"
          href={linkMatch[2]}
          key={index}
          rel="noreferrer"
          target="_blank"
        >
          {linkMatch[1]}
        </a>
      );
    }
    if (part.startsWith("@")) {
      return (
        <span className="rounded bg-background/50 px-1" key={index}>
          {part}
        </span>
      );
    }
    return part;
  });
}

function emptyDraft(): CreateDraft {
  return {
    attachments: [],
    body: "",
    subject: "",
  };
}

async function filePartToFile(
  filePart: PromptInputMessage["files"][number],
  tr: (value: string) => string,
) {
  if (!filePart.url) {
    throw new Error(tr("图片上传失败"));
  }
  const response = await fetch(filePart.url);
  const blob = await response.blob();
  const type = filePart.mediaType || blob.type || "application/octet-stream";
  return new File([blob], filePart.filename ?? "ticket-image", { type });
}

function statusLabel(status: Ticket["status"], tr: (value: string) => string) {
  if (status === "archived") return tr("已归档");
  if (status === "closed") return tr("已关闭");
  return tr("处理中");
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale);
}

function getPlatformBooleanSetting(
  settings: Array<{ name: string; value: string | null }> | undefined,
  name: string,
  fallback: boolean,
) {
  const value = settings?.find((setting) => setting.name === name)?.value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
