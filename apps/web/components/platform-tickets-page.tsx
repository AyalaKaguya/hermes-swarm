"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import { useI18n } from "@/components/i18n-provider";
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
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  closePlatformTicket,
  listPlatformTicketMessages,
  listPlatformTickets,
  markPlatformTicketRead,
  sendPlatformTicketMessage,
  uploadPlatformFile,
  type PlatformTicket,
  type TicketMessage,
  type TicketMessageAttachment,
  type TicketStatus,
} from "@/lib/admin-api";
import { withAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { formatRuntimeDateTime } from "@/lib/runtime-format";
import { ArrowUpIcon } from "lucide-react";

const MAX_TICKET_IMAGES = 6;
const MAX_TICKET_IMAGE_SIZE = 2 * 1024 * 1024;

type TicketFilter = "all" | TicketStatus;

export function PlatformTicketsPage() {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const { snapshot } = useAdminShell();
  const [tickets, setTickets] = useState<PlatformTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<PlatformTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const next = await withAuthenticatedAdminSessionMarker((session) =>
        listPlatformTickets(session),
      );
      setTickets(next);
      setSelectedTicket((current) =>
        current ? next.find((ticket) => ticket.id === current.id) ?? null : null,
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : tr("工单加载失败"),
      );
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    if (snapshot?.principalType === "platform") void loadTickets();
  }, [loadTickets, snapshot?.principalType]);

  useEffect(() => {
    if (!selectedTicket) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    void withAuthenticatedAdminSessionMarker(async (session) => {
      const next = await listPlatformTicketMessages(session, selectedTicket.id);
      await markPlatformTicketRead(session, selectedTicket.id);
      return next;
    })
      .then((next) => {
        if (!cancelled) setMessages(next);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : tr("工单消息加载失败"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTicket?.id, tr]);

  const visibleTickets = useMemo(
    () =>
      filter === "all"
        ? tickets
        : tickets.filter((ticket) => ticket.status === filter),
    [filter, tickets],
  );
  const ticketCounts = useMemo(
    () => ({
      all: tickets.length,
      archived: tickets.filter((ticket) => ticket.status === "archived").length,
      closed: tickets.filter((ticket) => ticket.status === "closed").length,
      open: tickets.filter((ticket) => ticket.status === "open").length,
    }),
    [tickets],
  );

  function selectTicket(ticket: PlatformTicket) {
    setError(null);
    setSelectedTicket(ticket);
  }

  async function sendMessage(input: PromptInputMessage) {
    if (!selectedTicket || saving || (!input.text.trim() && input.files.length === 0)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const message = await withAuthenticatedAdminSessionMarker(async (session) => {
        const uploaded = await Promise.all(
          input.files.map((file) => uploadTicketPromptAttachment(session, file, tr)),
        );
        return sendPlatformTicketMessage(session, selectedTicket.id, {
          attachments: uploaded,
          body: input.text.trim() || tr("图片附件"),
        });
      });
      setMessages((current) => [...current, message]);
      await loadTickets();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : tr("发送失败"));
      throw sendError;
    } finally {
      setSaving(false);
    }
  }

  async function closeSelectedTicket() {
    if (!selectedTicket || saving) return;
    setSaving(true);
    setError(null);
    try {
      const closed = await withAuthenticatedAdminSessionMarker((session) =>
        closePlatformTicket(session, selectedTicket.id),
      );
      setTickets((current) =>
        current.map((ticket) => (ticket.id === closed.id ? closed : ticket)),
      );
      setSelectedTicket(closed);
      setCloseConfirmOpen(false);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : tr("关闭失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{tr("平台工单中心")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("集中接收并处理所有工作空间提交的工单")}
          </p>
        </div>
        <Button disabled={loading} onClick={() => void loadTickets()} variant="outline">
          <AppIcon className="size-4" name="refresh" />
          {tr("刷新")}
        </Button>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>{tr("统一工单收件箱")}</CardTitle>
            <CardDescription>
              {tr("按来源工作空间查看、回复和关闭工单")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterButton active={filter === "all"} count={ticketCounts.all} onClick={() => setFilter("all")}>
              {tr("全部")}
            </FilterButton>
            <FilterButton active={filter === "open"} count={ticketCounts.open} onClick={() => setFilter("open")}>
              {tr("待处理")}
            </FilterButton>
            <FilterButton active={filter === "closed"} count={ticketCounts.closed} onClick={() => setFilter("closed")}>
              {tr("已关闭")}
            </FilterButton>
            <FilterButton active={filter === "archived"} count={ticketCounts.archived} onClick={() => setFilter("archived")}>
              {tr("已归档")}
            </FilterButton>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{tr("加载中...")}</div>
          ) : visibleTickets.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              {tr("暂无工单")}
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleTickets.map((ticket) => (
                <button
                  className="grid gap-2 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={ticket.id}
                  onClick={() => selectTicket(ticket)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{ticket.subject}</span>
                    <TicketStatusBadge status={ticket.status} tr={tr} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <AppIcon className="size-3.5" name="building" />
                      {ticket.workspace.name}
                      <span className="font-mono">{ticket.workspace.slug}</span>
                    </span>
                    <span>{formatRuntimeDateTime(ticket.lastMessageAt ?? ticket.createdAt, runtimePreferences)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSelectedTicket(null);
        }}
        open={Boolean(selectedTicket)}
      >
        <DialogContent className="grid h-[min(52rem,calc(100svh-2rem))] w-[min(72rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none">
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <DialogTitle className="truncate">{selectedTicket?.subject ?? tr("工单")}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{selectedTicket?.workspace.name}</span>
                  <span>·</span>
                  <span>{selectedTicket ? statusLabel(selectedTicket.status, tr) : ""}</span>
                </DialogDescription>
              </div>
              {selectedTicket?.status === "open" && (
                <Button disabled={saving} onClick={() => setCloseConfirmOpen(true)} size="sm" type="button" variant="destructive">
                  {tr("关闭工单")}
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            {error && (
              <div className="row-start-1 border-b px-5 py-2 sm:px-6">
                <InlineNotice tone="error">{error}</InlineNotice>
              </div>
            )}
            {loadingMessages ? (
              <div className="row-start-2 grid min-h-0 place-items-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-8">
                {tr("加载中...")}
              </div>
            ) : messages.length === 0 ? (
              <TicketConversationEmpty />
            ) : (
              <ConversationPanel
                className="row-start-2 h-full bg-background px-5 py-6 sm:px-8"
                messages={messages}
                renderMessage={(message) => (
                  <TicketMessageBubble
                    currentUserId={snapshot?.user.id ?? null}
                    key={message.id}
                    message={message}
                  />
                )}
              />
            )}
            <div className="row-start-3 border-t bg-background px-5 py-4 sm:px-6">
              {selectedTicket?.status === "open" ? (
                <PromptInput
                  accept="image/*"
                  className="mx-auto w-full max-w-3xl [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-muted/70 [&_[data-slot=input-group]]:shadow-none"
                  key={selectedTicket.id}
                  maxFileSize={MAX_TICKET_IMAGE_SIZE}
                  maxFiles={MAX_TICKET_IMAGES}
                  multiple
                  onError={(inputError) => {
                    setError(
                      inputError.code === "accept"
                        ? tr("仅支持图片附件")
                        : inputError.code === "max_files"
                          ? tr("最多上传 6 张图片")
                          : tr("图片附件过大"),
                    );
                  }}
                  onSubmit={sendMessage}
                >
                  <PromptInputBody>
                    <TicketPromptAttachmentPreview />
                    <PromptInputTextarea
                      className="min-h-[4.5rem] max-h-36 px-4 py-3 text-[15px] leading-6"
                      disabled={saving}
                      placeholder={tr("输入回复...")}
                    />
                  </PromptInputBody>
                  <PromptInputFooter className="px-3 pb-3 pt-1">
                    <PromptInputTools>
                      <PromptInputActionMenu>
                        <PromptInputActionMenuTrigger
                          aria-label={tr("添加图片")}
                          className="size-9 rounded-full border bg-background shadow-sm hover:bg-accent"
                          disabled={saving}
                          tooltip={tr("添加图片")}
                          variant="outline"
                        />
                        <PromptInputActionMenuContent>
                          <PromptInputActionAddAttachments label={tr("图片")} />
                        </PromptInputActionMenuContent>
                      </PromptInputActionMenu>
                    </PromptInputTools>
                    <PromptInputSubmit
                      aria-label={tr("发送回复")}
                      className="size-9 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/90"
                      disabled={saving}
                      status={saving ? "submitted" : undefined}
                    >
                      {saving ? undefined : <ArrowUpIcon className="size-4" />}
                    </PromptInputSubmit>
                  </PromptInputFooter>
                </PromptInput>
              ) : (
                <p className="text-sm text-muted-foreground">{tr("该工单已关闭，不能继续回复。")}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCloseConfirmOpen} open={closeConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("关闭工单")}</DialogTitle>
            <DialogDescription>{tr("关闭后，工作空间成员将不能继续在此工单中回复。")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={saving} onClick={() => setCloseConfirmOpen(false)} type="button" variant="outline">
              {tr("取消")}
            </Button>
            <Button disabled={saving} onClick={() => void closeSelectedTicket()} type="button" variant="destructive">
              {tr("关闭工单")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FilterButton({
  active,
  children,
  count,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} size="sm" type="button" variant={active ? "secondary" : "ghost"}>
      {children}
      <Badge className="ml-1" variant="outline">{count}</Badge>
    </Button>
  );
}

function TicketStatusBadge({
  status,
  tr,
}: {
  status: TicketStatus;
  tr: (value: string) => string;
}) {
  return <Badge variant={status === "open" ? "secondary" : "outline"}>{statusLabel(status, tr)}</Badge>;
}

function TicketConversationEmpty() {
  const tr = useTextTranslation();

  return (
    <div className="row-start-2 grid min-h-0 place-items-center bg-background px-5 py-8 sm:px-8">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-muted">
          <AppIcon className="size-5 text-muted-foreground" name="mail" />
        </div>
        <div className="grid gap-1">
          <h2 className="text-base font-semibold tracking-tight">
            {tr("开始处理工单")}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {tr("使用下方输入框回复工作空间成员，必要时可附上图片。")}
          </p>
        </div>
      </div>
    </div>
  );
}

function TicketPromptAttachmentPreview() {
  const tr = useTextTranslation();
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.files.map((file) => (
        <div
          className="flex max-w-full items-center gap-2 rounded-xl border bg-background/80 px-2 py-1.5 text-xs shadow-sm"
          key={file.id}
        >
          {file.url && (
            <img
              alt={file.filename ?? tr("图片附件")}
              className="size-8 rounded-lg object-cover"
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

function TicketMessageBubble({
  currentUserId,
  message,
}: {
  currentUserId: string | null;
  message: TicketMessage;
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
      <div className={mine ? "grid max-w-[min(42rem,88%)] gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "grid max-w-[min(42rem,88%)] gap-2 rounded-lg border bg-background px-3 py-2"}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-80">
          <span className="font-medium">{authorName}</span>
          <span>{formatRuntimeDateTime(message.createdAt, runtimePreferences)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
        {message.attachments.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {message.attachments.map((attachment, index) => (
              <a className="group grid gap-1 rounded-md border bg-background/50 p-1 text-foreground transition-colors hover:bg-muted" href={attachment.url} key={`${attachment.url}-${index}`} rel="noreferrer" target="_blank">
                <img alt={attachment.name} className="aspect-video w-full rounded object-cover" src={attachment.url} />
                <span className="truncate px-1 text-xs text-muted-foreground">{attachment.name}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function uploadTicketImage(
  session: Parameters<typeof uploadPlatformFile>[0],
  file: File,
  tr: (value: string) => string,
): Promise<TicketMessageAttachment> {
  const result = await uploadPlatformFile(session, file);
  if (!result.url) throw new Error(tr("图片上传失败"));
  return {
    mimeType: result.mimeType,
    name: result.originalName ?? result.name ?? file.name,
    size: result.size,
    type: "image",
    url: result.url,
  };
}

async function uploadTicketPromptAttachment(
  session: Parameters<typeof uploadPlatformFile>[0],
  filePart: PromptInputMessage["files"][number],
  tr: (value: string) => string,
): Promise<TicketMessageAttachment> {
  const file = await promptAttachmentToFile(filePart, tr);
  return uploadTicketImage(session, file, tr);
}

async function promptAttachmentToFile(
  filePart: PromptInputMessage["files"][number],
  tr: (value: string) => string,
): Promise<File> {
  if (!filePart.url) throw new Error(tr("图片上传失败"));

  const response = await fetch(filePart.url);
  if (!response.ok) throw new Error(tr("图片上传失败"));
  const blob = await response.blob();
  const type = filePart.mediaType || blob.type || "application/octet-stream";
  return new File([blob], filePart.filename ?? "ticket-image", { type });
}

function statusLabel(status: TicketStatus, tr: (value: string) => string) {
  if (status === "closed") return tr("已关闭");
  if (status === "archived") return tr("已归档");
  return tr("待处理");
}
