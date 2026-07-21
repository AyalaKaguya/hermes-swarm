"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useI18n } from "@/components/i18n-provider";
import { AppIcon } from "@/components/app-icon";
import { useAdminShell } from "@/components/admin-shell";
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
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { InlineNotice } from "@/components/inline-notice";
import { useRealtime } from "@/components/realtime-provider";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  closeTicket,
  createTicket,
  listTicketMessages,
  listTickets,
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
  applyTicketMessageRealtimeUpdate,
  applyTicketSourceRealtimeUpdate,
  toTicketMessageRealtimeUpdate,
  toTicketSourceRealtimeUpdate,
  upsertTicketMessage,
} from "@/lib/realtime-events";
import { formatRuntimeDateTime } from "@/lib/runtime-format";

const MAX_TICKET_IMAGES = 6;
const MAX_TICKET_IMAGE_SIZE = 2 * 1024 * 1024;

type TicketDraft = {
  attachments: TicketMessageAttachment[];
  body: string;
  subject: string;
};

export default function TicketsPage() {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const { snapshot } = useAdminShell();
  const { connectionEpoch, subscribe } = useRealtime();
  const currentUserId = snapshot?.user.id ?? null;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<TicketMessageAttachment | null>(null);
  const [draft, setDraft] = useState<TicketDraft>(() => emptyDraft());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, tickets],
  );
  const submittedTickets = useMemo(
    () => tickets.filter((ticket) => ticket.requesterUserId === currentUserId),
    [currentUserId, tickets],
  );
  const relatedTickets = useMemo(
    () => tickets.filter((ticket) => ticket.requesterUserId !== currentUserId),
    [currentUserId, tickets],
  );

  const loadTickets = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await listTickets(session);
      setTickets(next);
      setSelectedTicketId((current) =>
        current && next.some((item) => item.id === current) ? current : null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("工单加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicketId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const session = await requireAuthenticatedAdminSessionMarker();
        const next = await listTicketMessages(session, selectedTicketId);
        if (!cancelled) setMessages(next);
        await markTicketRead(session, selectedTicketId);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : tr("工单消息加载失败"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTicketId, tr]);

  useEffect(
    () =>
      subscribe("conversation.message.created", (event) => {
        const update = toTicketMessageRealtimeUpdate(event);
        if (!update) return;
        setTickets((current) => applyTicketMessageRealtimeUpdate(current, update));
        if (selectedTicketId === update.ticketId) {
          setMessages((current) => upsertTicketMessage(current, update.message));
          void getAuthenticatedAdminSessionMarker().then((session) => {
            if (session) return markTicketRead(session, update.ticketId).catch(() => undefined);
          });
        }
      }),
    [selectedTicketId, subscribe],
  );

  useEffect(
    () =>
      subscribe("conversation.source.updated", (event) => {
        const update = toTicketSourceRealtimeUpdate(event);
        if (update) {
          setTickets((current) => applyTicketSourceRealtimeUpdate(current, update));
        }
      }),
    [subscribe],
  );

  useEffect(() => {
    if (connectionEpoch === 0) return;
    void loadTickets();
    if (!selectedTicketId) return;
    let cancelled = false;
    void requireAuthenticatedAdminSessionMarker()
      .then((session) => listTicketMessages(session, selectedTicketId))
      .then((next) => {
        if (!cancelled) setMessages(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectionEpoch, loadTickets, selectedTicketId]);

  function openCreate() {
    setDraft(emptyDraft());
    setError(null);
    setCreateOpen(true);
  }

  function openTicket(ticket: Ticket) {
    setError(null);
    setMessages([]);
    setSelectedTicketId(ticket.id);
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const created = await createTicket(session, {
        attachments: draft.attachments,
        body: draft.body.trim(),
        subject: draft.subject.trim(),
      });
      setCreateOpen(false);
      setDraft(emptyDraft());
      await loadTickets();
      setSelectedTicketId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("提交工单失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendMessage(input: PromptInputMessage) {
    if (!selectedTicket || (!input.text.trim() && input.files.length === 0)) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const attachments = await Promise.all(
        input.files.map((item) => uploadPromptAttachment(session, item, tr)),
      );
      const message = await sendTicketMessage(session, selectedTicket.id, {
        attachments,
        body: input.text.trim() || tr("图片附件"),
      });
      setMessages((current) => upsertTicketMessage(current, message));
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("发送失败"));
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadCreateAttachment(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(tr("仅支持图片附件"));
      return;
    }
    if (file.size > MAX_TICKET_IMAGE_SIZE) {
      setError(tr("图片附件过大"));
      return;
    }
    if (draft.attachments.length >= MAX_TICKET_IMAGES) {
      setError(tr("最多上传 6 张图片"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const attachment = await uploadFile(session, file, tr);
      setDraft((current) => ({
        ...current,
        attachments: [...current.attachments, attachment],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("图片上传失败"));
    } finally {
      setUploading(false);
    }
  }

  async function closeSelectedTicket() {
    if (!selectedTicket) return false;
    setSubmitting(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const closed = await closeTicket(session, selectedTicket.id);
      setTickets((current) =>
        current.map((ticket) => (ticket.id === closed.id ? closed : ticket)),
      );
      await loadTickets();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("关闭失败"));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const messageInputDisabled =
    !selectedTicket || selectedTicket.status !== "open" || submitting;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("工单")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("工作空间内你有权查看的工单")}
          </p>
        </div>
        <Button
          onClick={openCreate}
          type="button"
        >
          <AppIcon className="size-3.5" name="plus" />
          {tr("新建工单")}
        </Button>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div
        className={
          relatedTickets.length > 0
            ? "grid min-h-0 flex-1 gap-4 xl:grid-cols-2"
            : "grid min-h-0 flex-1"
        }
      >
        <TicketListPanel
          emptyLabel={loading ? tr("加载中...") : tr("暂无我提交的工单")}
          onOpen={openTicket}
          tickets={submittedTickets}
          title={tr("我提交的工单")}
        />
        {relatedTickets.length > 0 && (
          <TicketListPanel
            emptyLabel={loading ? tr("加载中...") : tr("暂无相关工单")}
            onOpen={openTicket}
            tickets={relatedTickets}
            title={tr("相关工单")}
          />
        )}
      </div>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("新建工单")}</DialogTitle>
            <DialogDescription>
              {tr("工单将归属于当前工作空间。")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitTicket}>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-subject">{tr("主题")}</Label>
              <Input
                id="ticket-subject"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
                required
                value={draft.subject}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-body">{tr("描述")}</Label>
              <Textarea
                className="min-h-36"
                id="ticket-body"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                placeholder={tr(
                  "使用 Markdown 描述问题；输入 @邮箱 或 @用户名可提及成员",
                )}
                required
                value={draft.body}
              />
            </div>
            <AttachmentPicker
              attachments={draft.attachments}
              disabled={uploading || submitting}
              onPreview={setPreviewAttachment}
              onRemove={(index) =>
                setDraft((current) => ({
                  ...current,
                  attachments: current.attachments.filter(
                    (_, attachmentIndex) => attachmentIndex !== index,
                  ),
                }))
              }
              onUpload={(file) => void uploadCreateAttachment(file)}
            />
            <DialogFooter>
              <Button
                disabled={submitting}
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="outline"
              >
                {tr("取消")}
              </Button>
              <Button
                disabled={
                  submitting ||
                  uploading ||
                  !draft.subject.trim() ||
                  !draft.body.trim()
                }
                type="submit"
              >
                {submitting ? tr("提交中...") : tr("提交")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setCloseConfirmOpen(false);
            setSelectedTicketId(null);
          }
        }}
        open={Boolean(selectedTicket)}
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
                    ? `${statusLabel(selectedTicket.status, tr)} · ${formatRuntimeDateTime(selectedTicket.lastMessageAt ?? selectedTicket.createdAt, runtimePreferences)}`
                    : tr("工单会话")}
                </DialogDescription>
              </div>
              {selectedTicket?.status === "open" && (
                <Button
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
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            {error && (
              <div className="border-b px-4 py-2">
                <InlineNotice tone="error">{error}</InlineNotice>
              </div>
            )}
            <ConversationPanel
              className="row-start-2 h-full min-h-0"
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

            <div className="row-start-3 max-h-[14rem] overflow-auto border-t bg-background p-4">
              <PromptInput
                accept="image/*"
                maxFileSize={MAX_TICKET_IMAGE_SIZE}
                maxFiles={MAX_TICKET_IMAGES}
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
                    placeholder={tr(
                      "输入 Markdown 消息；输入 @邮箱 或 @用户名可提及成员",
                    )}
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <PromptInputActionMenu>
                      <PromptInputActionMenuTrigger
                        aria-label={tr("添加图片")}
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
                  <PromptInputSubmit
                    disabled={messageInputDisabled}
                    status={submitting ? "submitted" : undefined}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCloseConfirmOpen} open={closeConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("关闭工单")}</DialogTitle>
            <DialogDescription>
              {tr(
                "关闭后，这个工单会从你的待处理流程中移出。对方仍可继续回复并重新打开会话；当双方都关闭后，工单会进入归档状态。",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={submitting}
              onClick={() => setCloseConfirmOpen(false)}
              type="button"
              variant="outline"
            >
              {tr("取消")}
            </Button>
            <Button
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
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
        open={Boolean(previewAttachment)}
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
  const { runtimePreferences } = useI18n();
  const tr = useTextTranslation();
  return (
    <section className="flex min-h-[32rem] flex-col rounded-lg border bg-card">
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
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {ticket.subject}
                  </span>
                  <Badge variant="outline">
                    {statusLabel(ticket.status, tr)}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {formatRuntimeDateTime(
                      ticket.lastMessageAt ?? ticket.createdAt,
                      runtimePreferences,
                    )}
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
  const { runtimePreferences } = useI18n();
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
          <span>{formatRuntimeDateTime(message.createdAt, runtimePreferences)}</span>
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
  onPreview,
  onRemove,
  onUpload,
}: {
  attachments: TicketMessageAttachment[];
  disabled?: boolean;
  onPreview: (attachment: TicketMessageAttachment) => void;
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
              <button
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => onPreview(attachment)}
                type="button"
              >
                <img
                  alt={attachment.name}
                  className="size-9 rounded object-cover"
                  src={attachment.url}
                />
                <span className="truncate">{attachment.name}</span>
              </button>
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
          className="group grid gap-1 rounded-md border bg-background/50 p-1 text-foreground transition-colors hover:bg-muted"
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
        <li key={`li-${index}`}>
          {renderInlineMarkdown(listMatch[1] ?? "")}
        </li>,
      );
      return;
    }
    flushList();
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      nodes.push(
        <div
          className={
            level === 1
              ? "text-base font-semibold"
              : level === 2
                ? "text-sm font-semibold"
                : "text-sm font-medium"
          }
          key={`h-${index}`}
        >
          {renderInlineMarkdown(headingMatch[2] ?? "")}
        </div>,
      );
      return;
    }
    nodes.push(
      <p
        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
        key={`p-${index}`}
      >
        {renderInlineMarkdown(line)}
      </p>,
    );
  });
  flushList();

  return <div className="grid gap-1.5">{nodes}</div>;
}

function renderInlineMarkdown(value: string) {
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9_.-]+)/g;
  const parts = value.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-xs" key={index}>
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

async function uploadPromptAttachment(
  session: AuthenticatedAdminSessionMarker,
  filePart: PromptInputMessage["files"][number],
  tr: (value: string) => string,
) {
  const file = await filePartToFile(filePart, tr);
  return uploadFile(session, file, tr);
}

async function uploadFile(
  session: AuthenticatedAdminSessionMarker,
  file: File,
  tr: (value: string) => string,
) {
  if (!file.type.startsWith("image/")) {
    throw new Error(tr("仅支持图片附件"));
  }
  if (file.size > MAX_TICKET_IMAGE_SIZE) {
    throw new Error(tr("图片附件过大"));
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

async function filePartToFile(
  filePart: PromptInputMessage["files"][number],
  tr: (value: string) => string,
) {
  if (!filePart.url) throw new Error(tr("图片上传失败"));
  const response = await fetch(filePart.url);
  const blob = await response.blob();
  const type = filePart.mediaType || blob.type || "application/octet-stream";
  return new File([blob], filePart.filename ?? "ticket-image", { type });
}

function emptyDraft(): TicketDraft {
  return {
    attachments: [],
    body: "",
    subject: "",
  };
}

function statusLabel(status: Ticket["status"], tr: (value: string) => string) {
  if (status === "closed") return tr("已关闭");
  if (status === "archived") return tr("已归档");
  return tr("处理中");
}
