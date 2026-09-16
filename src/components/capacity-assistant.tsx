import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, Loader2, Send, Sparkles, Square, User, X } from "lucide-react";

import type {
  AssistantPreview,
  AssistantReadDetails,
  AssistantRequest,
  AssistantResponse,
  ConversationContext,
} from "@/domain/capacity/assistant";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type UiMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; response: AssistantResponse; request?: AssistantRequest }
  | { id: string; role: "assistant"; text: string };

type AssistantContextValue = { enabled: boolean; open: () => void };

const AssistantContext = createContext<AssistantContextValue>({ enabled: false, open: () => {} });

function localAssistantEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

function useCapacityAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}

const examples = [
  "Who has capacity next Tuesday?",
  "Who could staff Phoenix?",
  "Who is overallocated?",
  "Assign Anna to Phoenix at 50%.",
];

function valueText(value: unknown): string {
  if (value === null) return "None";
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function ReadCard({ details }: { details: AssistantReadDetails }) {
  if (details.kind === "people") {
    return (
      <div className="space-y-2">
        {details.rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {index + 1}. {row.name}
                </p>
                <p className="text-xs text-muted-foreground">{row.secondary}</p>
              </div>
              {row.availableCapacity !== null && (
                <Badge variant="secondary">{row.availableCapacity}% free</Badge>
              )}
            </div>
            {!!row.skills.length && (
              <p className="mt-2 text-xs text-muted-foreground">{row.skills.join(" · ")}</p>
            )}
            {row.warnings.map((warning) => (
              <p key={warning} className="mt-1 text-xs text-warning-foreground">
                {warning}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (details.kind === "demands") {
    return (
      <div className="space-y-2">
        {details.rows.map((row) => (
          <div key={row.id} className="rounded-lg border bg-background p-3">
            <div className="flex justify-between gap-3">
              <p className="text-sm font-medium">{row.title}</p>
              <Badge variant="secondary">{row.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{row.client || "No client"}</p>
            <p className="mt-2 text-xs">
              {row.staffedCapacity}% staffed · {row.gapCapacity}% gap
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (details.kind === "capacity") {
    const overAllocated = (details.person.rawFreeCapacity ?? 0) < 0;
    return (
      <div className="rounded-lg border bg-background p-3 text-sm">
        <div className="flex justify-between">
          <span className="font-medium">{details.person.name}</span>
          <Badge variant="secondary">
            {details.archived
              ? "Archived"
              : details.unavailable
                ? "Unavailable"
                : overAllocated
                  ? `${Math.abs(details.person.rawFreeCapacity ?? 0)}% overallocated`
                  : `${details.person.availableCapacity}% free`}
          </Badge>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>Committed {details.committedCapacity}%</span>
          <span>Pipeline {details.pipelineCapacity}%</span>
        </div>
        {details.unavailable && (
          <p className="mt-2 text-xs text-warning-foreground">Marked unavailable on this date.</p>
        )}
        {details.allocations?.map((allocation) => (
          <p
            key={`${allocation.demand}-${allocation.classification}`}
            className="mt-1 text-xs text-muted-foreground"
          >
            {allocation.demand} · {allocation.capacity}% {allocation.classification}
          </p>
        ))}
      </div>
    );
  }
  if (details.kind === "demand") {
    return (
      <div className="rounded-lg border bg-background p-3">
        <div className="flex justify-between gap-3">
          <p className="text-sm font-medium">{details.demand.title}</p>
          <Badge variant="secondary">{details.demand.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{details.demand.client || "No client"}</p>
        <p className="mt-2 text-xs">
          Required {details.demand.requiredCapacity}% · Staffed {details.demand.staffedCapacity}% ·
          Gap {details.demand.gapCapacity}%
        </p>
        {details.allocations.map((allocation) => (
          <p key={allocation.id} className="mt-1 text-xs text-muted-foreground">
            {allocation.name} · {allocation.capacity}%
          </p>
        ))}
      </div>
    );
  }
  if (details.kind === "rangeCapacity") {
    return (
      <div className="space-y-2 rounded-lg border bg-background p-3 text-xs">
        <p className="font-medium">
          {details.onDateStart} → {details.onDateEnd}
        </p>
        <p>
          Free: {details.aggregate.minimumFree}%–{details.aggregate.maximumFree}% (average{" "}
          {details.aggregate.averageFree}%)
        </p>
        {details.utilization !== undefined && (
          <p>
            Utilization: {details.utilization === null ? "not defined" : `${details.utilization}%`}
          </p>
        )}
        <div className="space-y-1 text-muted-foreground">
          {details.days.map((day) => (
            <p key={day.onDate}>
              {day.onDate}:{" "}
              {day.free < 0 ? `0% free · ${day.overAllocated}% overallocated` : `${day.free}% free`}{" "}
              · {day.committed}% committed
              {day.pipeline ? ` · ${day.pipeline}% pipeline` : ""}
              {day.unavailable ? " · unavailable" : ""}
            </p>
          ))}
        </div>
      </div>
    );
  }
  if (details.kind === "availabilityWindows") {
    return (
      <div className="space-y-2">
        {details.windows.map((window) => (
          <div
            key={`${window.consultant}-${window.startDate}`}
            className="rounded-lg border bg-background p-3 text-xs"
          >
            <p className="font-medium">{window.consultant}</p>
            <p>
              {window.startDate} → {window.endDate}
            </p>
            <p className="text-muted-foreground">
              {window.minimumFree}% minimum free · {window.averageFree}% average
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (details.kind === "help") {
    return <div className="rounded-lg border bg-background p-3 text-xs">{details.answer}</div>;
  }
  if (details.kind === "skillSupplyDemand") {
    return (
      <div className="space-y-2">
        {details.rows.map((row) => (
          <div
            key={row.skill}
            className="flex justify-between rounded-lg border bg-background p-3 text-xs"
          >
            <span>{row.skill}</span>
            <span>
              {row.consultants} people · {row.demandCount} demands
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (details.kind === "rangeOverview") {
    if (!details.days.length) {
      return (
        <div className="rounded-lg border bg-background p-3 text-xs">
          No Monday–Friday working days are present in the requested range.
        </div>
      );
    }
    return (
      <div className="space-y-2 rounded-lg border bg-background p-3 text-xs">
        <p>
          Free range: {details.minimumFree}%–{details.maximumFree}%
        </p>
        {details.days.map((day) => (
          <p key={day.onDate}>
            {day.onDate}: {day.free}% free
            {day.overAllocated ? ` · ${day.overAllocated}% overallocated` : ""} · {day.committed}%
            committed · {day.gap}% staffing gap
          </p>
        ))}
      </div>
    );
  }
  if (details.kind === "allocationBreakdown") {
    return (
      <div className="space-y-2">
        {details.allocations.map((allocation) => (
          <div
            key={`${allocation.demand}-${allocation.classification}`}
            className="rounded-lg border bg-background p-3 text-xs"
          >
            <div className="flex justify-between">
              <span className="font-medium">{allocation.demand}</span>
              <Badge variant="secondary">
                {allocation.capacity}% {allocation.classification}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">
              Active on {allocation.activeDays.join(", ")}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-background p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <span>Active people</span>
        <strong>{details.activeCount}</strong>
        <span>Available</span>
        <strong>{details.availableCapacity}%</strong>
        <span>Overallocated</span>
        <strong>{details.overAllocatedCapacity}%</strong>
        <span>Staffing gap</span>
        <strong>{details.staffingGap}%</strong>
      </div>
      {details.people.map((row) => (
        <p key={row.id} className="mt-2 text-warning-foreground">
          {row.name} · {Math.abs(row.rawFreeCapacity ?? 0)}% over
        </p>
      ))}
    </div>
  );
}

function PreviewCard({
  preview,
  disabled,
  onCancel,
  onConfirm,
}: {
  preview: AssistantPreview;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-xl border bg-background p-3 shadow-sm">
      <p className="text-sm font-semibold">{preview.title}</p>
      <p className="text-xs text-muted-foreground">{preview.subject}</p>
      <div className="mt-3 space-y-2">
        {preview.changes.map((change) => (
          <div key={change.field} className="rounded-md bg-muted/60 p-2 text-xs">
            <p className="font-medium">{change.field}</p>
            <p className="mt-1 text-muted-foreground">
              {valueText(change.before)} →{" "}
              <span className="text-foreground">{valueText(change.after)}</span>
            </p>
          </div>
        ))}
        {preview.impact.capacity.map((impact) => (
          <p key={impact.consultantId} className="text-xs">
            {preview.labels[impact.consultantId] ?? "Consultant"}: {impact.before.rawFreeCapacity}%
            → {impact.after.rawFreeCapacity}% free on {preview.asOfDate}
          </p>
        ))}
        {preview.impact.staffing.map((impact, index) => (
          <p key={impact.demandId ?? `new-${index}`} className="text-xs">
            {impact.demandId ? preview.labels[impact.demandId] : "New demand"}: staffing gap{" "}
            {impact.before.gapCapacity}% → {impact.after.gapCapacity}%
          </p>
        ))}
      </div>
      {preview.warnings.map((warning) => (
        <Alert
          key={`${warning.code}-${warning.message}`}
          className="mt-3 border-warning/50 bg-warning/10 py-2"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{warning.message}</AlertDescription>
        </Alert>
      ))}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="sm" disabled={disabled} onClick={onConfirm}>
          <Check className="h-4 w-4" /> Confirm
        </Button>
      </div>
    </div>
  );
}

export function CapacityAssistantProvider({ children }: { children: ReactNode }) {
  const enabled = localAssistantEnabled();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationContext, setConversationContext] = useState<ConversationContext | undefined>();
  const [pending, setPending] = useState(false);
  const [pendingMode, setPendingMode] = useState<AssistantRequest["mode"] | null>(null);
  const [resolvedCards, setResolvedCards] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const queryClient = useQueryClient();

  const invalidateCapacity = useCallback(() => {
    for (const key of Object.values(queryKeys))
      void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient]);

  const requestAssistant = useCallback(
    async (body: AssistantRequest, addUserText?: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      if (addUserText)
        setMessages((items) => [
          ...items,
          { id: crypto.randomUUID(), role: "user", text: addUserText },
        ]);
      setPending(true);
      setPendingMode(body.mode);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("UNAUTHORIZED");
        const requestBody =
          body.mode === "interpret" || body.mode === "clarify"
            ? { ...body, context: body.context ?? conversationContext }
            : body;
        const response = await fetch("/api/ai/capacity", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        const payload = (await response.json()) as AssistantResponse;
        if (payload.context) setConversationContext(payload.context);
        if (
          !payload.ok &&
          (payload.error.code === "CONTEXT_INVALIDATED" ||
            (payload.error.code === "CONFLICT" && payload.error.message.includes("context")) ||
            (payload.error.code === "VALIDATION_ERROR" && body.mode !== "confirm"))
        )
          setConversationContext(undefined);
        setMessages((items) => [
          ...items,
          { id: crypto.randomUUID(), role: "assistant", response: payload, request: body },
        ]);
        if (payload.ok && payload.kind === "executed") invalidateCapacity();
      } catch (error) {
        if (controller.signal.aborted) {
          setMessages((items) => [
            ...items,
            { id: crypto.randomUUID(), role: "assistant", text: "Request cancelled." },
          ]);
        } else {
          const code =
            error instanceof Error && error.message === "UNAUTHORIZED"
              ? "Your session has expired. Sign in again."
              : "The assistant request failed safely. Please retry.";
          setMessages((items) => [
            ...items,
            { id: crypto.randomUUID(), role: "assistant", text: code },
          ]);
        }
      } finally {
        abortRef.current = null;
        pendingRef.current = false;
        setPending(false);
        setPendingMode(null);
      }
    },
    [conversationContext, invalidateCapacity],
  );

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    void requestAssistant({ mode: "interpret", message }, message);
  };

  const context = useMemo(() => ({ enabled, open: () => setIsOpen(true) }), [enabled]);

  if (!enabled)
    return <AssistantContext.Provider value={context}>{children}</AssistantContext.Provider>;

  return (
    <AssistantContext.Provider value={context}>
      {children}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-[440px]">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" /> Capacity Assistant
            </SheetTitle>
            <SheetDescription>Ask about capacity or preview a staffing change.</SheetDescription>
            {conversationContext &&
              (conversationContext.lastConsultant ||
                conversationContext.lastDemand ||
                conversationContext.lastRange) && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {[
                      conversationContext.lastConsultant?.label,
                      conversationContext.lastDemand?.label,
                      conversationContext.lastRange?.label ??
                        (conversationContext.lastRange &&
                          `${conversationContext.lastRange.startDate} → ${conversationContext.lastRange.endDate}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setConversationContext(undefined)}
                  >
                    Reset context
                  </Button>
                </div>
              )}
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              {!messages.length && (
                <div className="py-6 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-secondary">
                    <Bot className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-medium">What would you like to know?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reads are immediate. Every edit is previewed before confirmation.
                  </p>
                  <div className="mt-4 space-y-2">
                    {examples.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => {
                          setInput("");
                          void requestAssistant({ mode: "interpret", message: example }, example);
                        }}
                        className="block w-full rounded-lg border bg-background px-3 py-2 text-left text-xs hover:bg-secondary/60"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((message) => {
                if ("text" in message)
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex gap-2",
                        message.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      {message.role === "assistant" && (
                        <Bot className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div
                        className={cn(
                          "max-w-[88%] rounded-xl px-3 py-2 text-sm",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary",
                        )}
                      >
                        {message.text}
                      </div>
                    </div>
                  );
                const result = message.response;
                return (
                  <div key={message.id} className="flex gap-2">
                    <Bot className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-2 rounded-xl bg-secondary p-3 text-sm">
                      {result.ok ? (
                        <>
                          {result.kind === "read" && (
                            <>
                              <p>{result.message}</p>
                              <ReadCard details={result.details} />
                            </>
                          )}
                          {result.kind === "unsupported" && <p>{result.message}</p>}
                          {result.kind === "clarification" && (
                            <>
                              <p>{result.message}</p>
                              <div className="space-y-2">
                                {result.candidates.map((candidate) => (
                                  <Button
                                    key={candidate.id}
                                    variant="outline"
                                    className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                                    disabled={pending}
                                    onClick={() =>
                                      void requestAssistant({
                                        mode: "clarify",
                                        intent: result.intent,
                                        selections: [
                                          ...result.selections,
                                          { field: result.field, candidateId: candidate.id },
                                        ],
                                      })
                                    }
                                  >
                                    <span>
                                      <span className="block text-xs font-medium">
                                        {candidate.label}
                                      </span>
                                      {candidate.secondary && (
                                        <span className="block text-[11px] text-muted-foreground">
                                          {candidate.secondary}
                                        </span>
                                      )}
                                    </span>
                                  </Button>
                                ))}
                              </div>
                            </>
                          )}
                          {result.kind === "preview" && (
                            <>
                              <p>{result.message}</p>
                              <PreviewCard
                                preview={result.preview}
                                disabled={pending || resolvedCards.has(message.id)}
                                onCancel={() => {
                                  setResolvedCards((current) => new Set(current).add(message.id));
                                  setMessages((items) => [
                                    ...items,
                                    {
                                      id: crypto.randomUUID(),
                                      role: "assistant",
                                      text: "Change canceled. Nothing was written.",
                                    },
                                  ]);
                                }}
                                onConfirm={() => {
                                  setResolvedCards((current) => new Set(current).add(message.id));
                                  void requestAssistant({
                                    mode: "confirm",
                                    confirmed: true,
                                    action: result.action,
                                    asOfDate: result.preview.asOfDate,
                                    previewId: result.preview.previewId,
                                  });
                                }}
                              />
                            </>
                          )}
                          {result.kind === "executed" && (
                            <>
                              <p>{result.success.message}</p>
                              <div className="space-y-1 rounded-lg border bg-background p-2 text-xs">
                                <p>
                                  {result.success.result.changedFields.length
                                    ? `Changed: ${result.success.result.changedFields.join(", ")}`
                                    : "No fields changed."}
                                </p>
                                {result.success.result.actualImpact.capacity.map((impact) => (
                                  <p key={impact.consultantId}>
                                    {result.success.labels[impact.consultantId] ?? "Consultant"}:{" "}
                                    {impact.before.rawFreeCapacity}% →{" "}
                                    {impact.after.rawFreeCapacity}% free
                                  </p>
                                ))}
                                {result.success.result.actualImpact.staffing.map(
                                  (impact, index) => (
                                    <p key={impact.demandId ?? `new-${index}`}>
                                      {impact.demandId
                                        ? result.success.labels[impact.demandId]
                                        : "New demand"}
                                      : staffing gap {impact.before.gapCapacity}% →{" "}
                                      {impact.after.gapCapacity}%
                                    </p>
                                  ),
                                )}
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Alert variant="destructive">
                            <AlertTitle>
                              {result.error.code === "STALE_PREVIEW"
                                ? "Preview changed"
                                : "Request failed"}
                            </AlertTitle>
                            <AlertDescription>{result.error.message}</AlertDescription>
                          </Alert>
                          {result.replacement && (
                            <PreviewCard
                              preview={result.replacement.preview}
                              disabled={pending || resolvedCards.has(`${message.id}:replacement`)}
                              onCancel={() =>
                                setResolvedCards((current) =>
                                  new Set(current).add(`${message.id}:replacement`),
                                )
                              }
                              onConfirm={() => {
                                setResolvedCards((current) =>
                                  new Set(current).add(`${message.id}:replacement`),
                                );
                                void requestAssistant({
                                  mode: "confirm",
                                  confirmed: true,
                                  action: result.replacement!.action,
                                  asOfDate: result.replacement!.preview.asOfDate,
                                  previewId: result.replacement!.preview.previewId,
                                });
                              }}
                            />
                          )}
                          {result.error.retryable && message.request && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => void requestAssistant(message.request!)}
                            >
                              Retry
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {pending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {pendingMode === "confirm" ? "Applying confirmed change…" : "Thinking safely…"}
                  {pendingMode !== "confirm" && (
                    <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                      <Square className="h-3 w-3" /> Stop
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
          <form onSubmit={submit} className="border-t bg-background p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask about capacity…"
                maxLength={4000}
                className="min-h-[44px] max-h-32 resize-none"
                disabled={pending}
              />
              <Button
                type="submit"
                size="icon"
                disabled={pending || !input.trim()}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              AI interprets requests. Capacity Hub validates and executes them.
            </p>
          </form>
        </SheetContent>
      </Sheet>
    </AssistantContext.Provider>
  );
}

export function CapacityAssistantLauncher() {
  const assistant = useCapacityAssistant();
  if (!assistant.enabled) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={assistant.open}
      aria-label="Open Capacity Assistant"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden lg:inline">Ask AI</span>
    </Button>
  );
}
