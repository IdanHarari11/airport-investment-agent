"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentResponse } from "@/lib/agent/types";
import {
  applyAssistantReply,
  clearMessagePending,
  findPendingRetries,
  getActiveConversation,
  getOrCreateClientUserId,
  loadUserStore,
  persistActiveMessages,
  persistConversationMessages,
  resetClientUserIdentity,
  setPreferredLanguage,
  startNewConversation,
  switchConversation,
  type StoredConversation,
  type StoredUiMessage,
} from "@/lib/chat/sessionStore";
import {
  detectLanguage,
  isRtlLanguage,
  textDirection,
  toIso639,
} from "@/lib/speech/language";
import { ExampleQuestions } from "./ExampleQuestions";
import { MarkdownMessage } from "./MarkdownMessage";
import { StructuredResults } from "./StructuredResults";
import { BrandLogo } from "@/components/BrandLogo";
import { MessageActions } from "./MessageActions";
import { VoiceControls } from "./VoiceControls";
import { WorkingStatusLine } from "./WorkingStatusLine";

type UiMessage = StoredUiMessage;

type ToolRun = {
  name: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
};

/** Survives React Strict Mode remounts within the same page load. */
const resumedPendingIds = new Set<string>();

function ScrollDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 9l6 6 6-6"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.9L15 12l-11.5 1.7z" />
    </svg>
  );
}

export function ChatApp() {
  const [hydrated, setHydrated] = useState(false);
  const [clientUserId, setClientUserId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  // Always start with a stable default so SSR/CSR markup matches; hydrate from storage/navigator in useEffect.
  const [preferredLanguage, setPreferredLanguageState] = useState<string>("en-US");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Understanding question…");
  const [activeTools, setActiveTools] = useState<ToolRun[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** In-flight abort controllers keyed by conversation id. */
  const abortByConversationRef = useRef<Map<string, AbortController>>(
    new Map(),
  );
  /** Monotonic request generation per conversation (supersede same-chat turns). */
  const requestGenByConversationRef = useRef<Map<string, number>>(new Map());
  const conversationIdRef = useRef(conversationId);
  const loadingConversationsRef = useRef<Set<string>>(new Set());
  const resumeStartedRef = useRef(false);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const userId = getOrCreateClientUserId();
    const store = loadUserStore(userId);
    const active = getActiveConversation(store);
    setClientUserId(userId);
    setConversationId(active.id);
    setConversations(store.conversations);
    setMessages(active.messages);
    setPreferredLanguageState(
      store.preferredLanguage ||
        (typeof navigator !== "undefined" ? navigator.language : "en-US"),
    );
    setHydrated(true);
  }, []);

  const rememberLanguage = useCallback(
    (bcp47: string) => {
      setPreferredLanguageState(bcp47);
      if (clientUserId) {
        setPreferredLanguage(clientUserId, bcp47);
      }
    },
    [clientUserId],
  );

  useEffect(() => {
    if (!hydrated || !clientUserId || !conversationId) return;
    const store = persistActiveMessages(
      clientUserId,
      conversationId,
      messages,
    );
    setConversations(store.conversations);
  }, [messages, hydrated, clientUserId, conversationId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setStickToBottom(true);
    setShowScrollButton(false);
  }, []);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 96;
    setStickToBottom(nearBottom);
    setShowScrollButton(!nearBottom && el.scrollHeight > el.clientHeight + 40);
  }, []);

  useEffect(() => {
    if (stickToBottom) {
      scrollToBottom(messages.length <= 1 ? "auto" : "smooth");
    } else {
      updateScrollState();
    }
  }, [
    messages,
    loading,
    activeTools,
    statusMessage,
    stickToBottom,
    scrollToBottom,
    updateScrollState,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [updateScrollState]);

  function setConversationLoading(targetId: string, value: boolean) {
    if (value) loadingConversationsRef.current.add(targetId);
    else loadingConversationsRef.current.delete(targetId);
    if (conversationIdRef.current === targetId) {
      setLoading(value);
    }
  }

  function beginNewChat() {
    if (!clientUserId) return;
    const store = startNewConversation(clientUserId);
    const active = getActiveConversation(store);
    setConversationId(active.id);
    setConversations(store.conversations);
    setMessages([]);
    setError(null);
    setLoading(loadingConversationsRef.current.has(active.id));
    setActiveTools([]);
    setShowScrollButton(false);
  }

  function openConversation(id: string) {
    if (!clientUserId || id === conversationId) return;
    const store = switchConversation(clientUserId, id);
    const active = getActiveConversation(store);
    setConversationId(active.id);
    setConversations(store.conversations);
    setMessages(active.messages);
    setError(null);
    setLoading(loadingConversationsRef.current.has(active.id));
    setActiveTools([]);
  }

  function resetLocalIdentity() {
    for (const controller of abortByConversationRef.current.values()) {
      controller.abort();
    }
    abortByConversationRef.current.clear();
    requestGenByConversationRef.current.clear();
    loadingConversationsRef.current.clear();
    resumeStartedRef.current = false;
    resumedPendingIds.clear();
    const userId = resetClientUserIdentity();
    const store = loadUserStore(userId);
    const active = getActiveConversation(store);
    setClientUserId(userId);
    setConversationId(active.id);
    setConversations(store.conversations);
    setMessages([]);
    setError(null);
    setLoading(false);
    setActiveTools([]);
  }

  function regenerateAssistant(assistantId: string) {
    if (!hydrated) return;
    const assistantIndex = messages.findIndex(
      (message) => message.id === assistantId,
    );
    if (assistantIndex < 0) return;

    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== "user") {
      userIndex -= 1;
    }
    if (userIndex < 0) return;

    const userContent = messages[userIndex]?.content?.trim();
    if (!userContent) return;

    const truncated = messages.slice(0, userIndex);
    const history = truncated
      .filter((m) => !m.error)
      .map(({ role, content }) => ({ role, content }))
      .slice(-40);

    setMessages(truncated);
    setError(null);
    setActiveTools([]);
    void sendMessage(userContent, { history, seedMessages: truncated });
  }

  async function sendMessage(
    raw: string,
    options?: {
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      conversationId?: string;
      /** Resume an existing pending user turn after refresh (do not append again). */
      resumeUserMessageId?: string;
      /** Explicit message list when React state is not yet flushed (e.g. regenerate). */
      seedMessages?: UiMessage[];
    },
  ) {
    const message = raw.trim();
    const targetConversationId = options?.conversationId ?? conversationId;
    const userId = clientUserId;
    if (!message || !hydrated || !userId || !targetConversationId) return;

    // Supersede only an in-flight request for this same conversation.
    const previous = abortByConversationRef.current.get(targetConversationId);
    previous?.abort();
    const controller = new AbortController();
    abortByConversationRef.current.set(targetConversationId, controller);
    const requestGen =
      (requestGenByConversationRef.current.get(targetConversationId) ?? 0) + 1;
    requestGenByConversationRef.current.set(targetConversationId, requestGen);

    const isActive = () => conversationIdRef.current === targetConversationId;
    const isCurrentRequest = () =>
      requestGenByConversationRef.current.get(targetConversationId) ===
      requestGen;

    let userMessageId = options?.resumeUserMessageId;
    let priorHistory = options?.history;

    if (!userMessageId) {
      const baseMessages =
        options?.seedMessages ??
        (isActive()
          ? messages
          : (loadUserStore(userId).conversations.find(
              (c) => c.id === targetConversationId,
            )?.messages ?? []));
      priorHistory = (
        options?.history ??
        baseMessages
          .filter((m) => !m.error && !m.pending)
          .map(({ role, content }) => ({ role, content }))
      ).slice(-40);

      const userMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        pending: true,
      };
      userMessageId = userMessage.id;

      // Persist immediately so a refresh before the React effect still keeps pending.
      const nextMessages = [...baseMessages, userMessage];
      const nextStore = persistConversationMessages(
        userId,
        targetConversationId,
        nextMessages,
        { setActive: isActive() },
      );
      setConversations(nextStore.conversations);
      if (isActive()) {
        setMessages(nextMessages);
      }
    }

    const detected = detectLanguage(message, preferredLanguage);
    rememberLanguage(detected.bcp47);

    if (isActive()) {
      setError(null);
      setInput("");
      setStickToBottom(true);
      setStatusMessage(`Understanding question… (${detected.label})`);
      setActiveTools([]);
    }
    setConversationLoading(targetConversationId, true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          history: (priorHistory ?? []).slice(-40),
          clientUserId: userId || undefined,
          language: detected.iso639,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: AgentResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!isCurrentRequest()) return;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          let payload: {
            type: string;
            name?: string;
            label?: string;
            ok?: boolean;
            message?: string;
            response?: AgentResponse;
            error?: string;
          };
          try {
            payload = JSON.parse(line.slice(6)) as typeof payload;
          } catch {
            continue;
          }

          if (payload.type === "final" && payload.response) {
            finalResponse = payload.response;
          }
          if (payload.type === "error") {
            throw new Error(payload.error || "Request failed");
          }

          if (!isActive() || !isCurrentRequest()) continue;

          if (payload.type === "status" && payload.message) {
            setStatusMessage(payload.message);
          }
          if (
            payload.type === "tool_start" &&
            payload.name &&
            payload.label
          ) {
            setActiveTools((prev) => {
              const without = prev.filter((tool) => tool.name !== payload.name);
              return [
                ...without,
                {
                  name: payload.name!,
                  label: payload.label!,
                  status: "running",
                  startedAt: Date.now(),
                },
              ];
            });
          }
          if (payload.type === "tool_end" && payload.name) {
            setActiveTools((prev) =>
              prev.map((tool) =>
                tool.name === payload.name
                  ? {
                      ...tool,
                      status: payload.ok === false ? "error" : "done",
                      endedAt: Date.now(),
                    }
                  : tool,
              ),
            );
          }
        }
      }

      if (!isCurrentRequest()) return;

      if (!finalResponse) {
        throw new Error("The agent finished without a final response.");
      }

      const assistantMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: finalResponse.answer,
        structured: finalResponse,
      };

      const nextStore = applyAssistantReply({
        userId,
        conversationId: targetConversationId,
        userMessageId: userMessageId!,
        assistant: assistantMessage,
      });
      setConversations(nextStore.conversations);

      if (isActive()) {
        const active = nextStore.conversations.find(
          (c) => c.id === targetConversationId,
        );
        if (active) setMessages(active.messages);
      }
    } catch (err) {
      if (controller.signal.aborted || !isCurrentRequest()) {
        // Superseded by a newer same-chat turn: drop pending so refresh won't retry it.
        if (!isCurrentRequest() && userMessageId) {
          const nextStore = clearMessagePending(
            userId,
            targetConversationId,
            userMessageId,
          );
          setConversations(nextStore.conversations);
          if (isActive()) {
            const active = nextStore.conversations.find(
              (c) => c.id === targetConversationId,
            );
            if (active) setMessages(active.messages);
          }
        }
        return;
      }
      const text = err instanceof Error ? err.message : "Unexpected error";
      const errorMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I could not complete that request.",
        error: text,
      };
      const nextStore = applyAssistantReply({
        userId,
        conversationId: targetConversationId,
        userMessageId: userMessageId!,
        assistant: errorMessage,
      });
      setConversations(nextStore.conversations);
      if (isActive()) {
        setError(text);
        const active = nextStore.conversations.find(
          (c) => c.id === targetConversationId,
        );
        if (active) setMessages(active.messages);
      }
    } finally {
      if (abortByConversationRef.current.get(targetConversationId) === controller) {
        abortByConversationRef.current.delete(targetConversationId);
      }
      if (isCurrentRequest()) {
        setConversationLoading(targetConversationId, false);
        if (isActive()) {
          setActiveTools([]);
          setStatusMessage("Understanding question…");
          inputRef.current?.focus();
        }
      }
    }
  }

  // After hydrate, retry any pending user turns interrupted by refresh.
  useEffect(() => {
    if (!hydrated || !clientUserId || resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    const store = loadUserStore(clientUserId);
    const retries = findPendingRetries(store);
    for (const retry of retries) {
      if (resumedPendingIds.has(retry.userMessage.id)) continue;
      resumedPendingIds.add(retry.userMessage.id);
      void sendMessage(retry.userMessage.content, {
        conversationId: retry.conversationId,
        history: retry.history,
        resumeUserMessageId: retry.userMessage.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydrate
  }, [hydrated, clientUserId]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  const hasMessages = messages.length > 0;

  /** Keep Working-line honest even if a status SSE event is stale. */
  const workingStatus = useMemo(() => {
    if (!loading) return statusMessage;
    const running = activeTools.find((tool) => tool.status === "running");
    if (running) return `Running ${running.label}…`;
    if (
      activeTools.length > 0 &&
      activeTools.every(
        (tool) => tool.status === "done" || tool.status === "error",
      )
    ) {
      return "Drafting explanation from tool results…";
    }
    return statusMessage;
  }, [loading, activeTools, statusMessage]);

  const isDrafting = useMemo(() => {
    if (!loading || activeTools.length === 0) return false;
    return activeTools.every(
      (tool) => tool.status === "done" || tool.status === "error",
    );
  }, [loading, activeTools]);

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] overflow-hidden pt-[var(--safe-top)]">
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]/70 p-4 xl:flex xl:w-[300px]">
        <div className="mb-5">
          <div className="flex items-center gap-3">
            <BrandLogo size={44} priority />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">
                Airport Intelligence
              </p>
              <h1 className="text-xl font-semibold tracking-tight">
                Expansion Agent
              </h1>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Chat with deterministic FAA/BTS scoring. Numbers come from tools —
            not the model.
          </p>
        </div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={beginNewChat}
            disabled={!hydrated}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={resetLocalIdentity}
            className="text-[10px] text-[var(--muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
            title="Create a new anonymous local identity (does not share chats)"
          >
            Reset local user
          </button>
        </div>
        {conversations.some((c) => c.messages.length > 0) && (
          <div className="mb-4 min-h-0 max-h-40 overflow-y-auto pr-1">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Your chats
            </p>
            <ul className="space-y-1">
              {conversations
                .filter((c) => c.messages.length > 0 || c.id === conversationId)
                .slice(0, 12)
                .map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(conversation.id)}
                      className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-xs transition ${
                        conversation.id === conversationId
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "text-[var(--muted)] hover:bg-[var(--bg)]/50 hover:text-[var(--text)]"
                      }`}
                    >
                      {conversation.title}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ExampleQuestions
            disabled={!hydrated}
            onSelect={(question) => void sendMessage(question)}
          />
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-panel)]/80 px-3 backdrop-blur sm:px-4 md:h-16 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <BrandLogo size={32} className="xl:hidden" priority />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium md:text-base">
                Analyst chat
              </p>
              <p className="truncate text-[11px] text-[var(--muted)] md:text-xs">
                Private local session · scores deterministic · ElevenLabs TTS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={beginNewChat}
            disabled={!hydrated}
            className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
          >
            New chat
          </button>
        </header>

        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={scrollRef}
            className="chat-scroll h-full overflow-x-hidden overflow-y-auto px-2.5 py-3 sm:px-4 sm:py-4 md:px-6"
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl min-w-0 flex-col">
              {!hasMessages && (
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-1 py-8 text-center sm:gap-6 sm:px-2 sm:py-10">
                  <div className="msg-enter space-y-2 px-1">
                    <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                      Where should we screen first?
                    </h2>
                    <p className="mx-auto max-w-md text-sm text-[var(--muted)]">
                      Ask in natural language about rankings, congestion,
                      long-haul share, or unmet-demand proxies.
                    </p>
                  </div>
                  <div className="msg-enter w-full max-w-xl px-1">
                    <ExampleQuestions
                      variant="chips"
                      disabled={!hydrated}
                      onSelect={(question) => void sendMessage(question)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 pb-4 sm:space-y-4">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  const contentLang = detectLanguage(message.content);
                  const contentDir = textDirection(message.content);
                  return (
                    <div
                      key={message.id}
                      className={`msg-enter flex min-w-0 gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`min-w-0 w-full max-w-[min(100%,42rem)] rounded-2xl px-3 py-2.5 text-sm leading-relaxed shadow-sm sm:rounded-3xl sm:px-4 sm:py-3 ${
                          isUser
                            ? "rounded-br-md bg-[var(--bg-user)] text-[var(--text)]"
                            : "rounded-bl-md border border-[var(--border)] bg-[var(--assistant)]"
                        }`}
                      >
                        {isUser ? (
                          <p
                            dir={contentDir}
                            lang={contentLang.iso639}
                            className="break-content whitespace-pre-wrap text-start [unicode-bidi:plaintext]"
                          >
                            {message.content}
                          </p>
                        ) : (
                          <MarkdownMessage
                            content={message.content}
                            dir={contentDir}
                            lang={contentLang.iso639}
                          />
                        )}
                        {message.error && (
                          <p
                            dir={textDirection(message.error)}
                            lang={detectLanguage(message.error).iso639}
                            className="break-content mt-2 text-start text-xs text-[var(--danger)] [unicode-bidi:plaintext]"
                          >
                            {message.error}
                          </p>
                        )}
                        {message.structured && (
                          <StructuredResults data={message.structured} />
                        )}
                        {!isUser && !message.error && (
                          <div dir="ltr" className="text-left">
                            <MessageActions
                              text={message.content}
                              preferredLanguage={preferredLanguage}
                              onRegenerate={() =>
                                regenerateAssistant(message.id)
                              }
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {loading && (
                  <div className="msg-enter flex min-w-0 justify-start">
                    <div className="min-w-0 w-full max-w-[min(100%,42rem)] rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--assistant)] px-3 py-2.5 sm:rounded-3xl sm:px-4 sm:py-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                        Working
                      </p>
                      <div className="mb-3 flex min-w-0 items-center gap-1.5">
                        <span className="typing-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span className="typing-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span className="typing-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <WorkingStatusLine
                          workingStatus={workingStatus}
                          isDrafting={isDrafting}
                        />
                      </div>
                      {activeTools.length > 0 ? (
                        <ul className="space-y-1.5">
                          {activeTools.map((tool) => (
                            <li
                              key={tool.name}
                              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg)]/40 px-2.5 py-1.5 text-xs"
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  tool.status === "running"
                                    ? "animate-pulse bg-[var(--accent)]"
                                    : tool.status === "done"
                                      ? "bg-[var(--accent)]"
                                      : "bg-[var(--danger)]"
                                }`}
                              />
                              <span className="min-w-0 font-medium text-[var(--text)]">
                                {tool.label}
                              </span>
                              <span className="text-[var(--muted)]">
                                {tool.status === "running"
                                  ? "running"
                                  : tool.status === "done"
                                    ? "done"
                                    : "failed"}
                                {tool.endedAt != null
                                  ? ` · ${Math.max(0, tool.endedAt - tool.startedAt)}ms`
                                  : ""}
                              </span>
                              <code className="max-w-full break-content text-[10px] text-[var(--muted)] sm:ml-auto">
                                {tool.name}
                              </code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">
                          Waiting for tool selection…
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} className="h-1" />
              </div>
            </div>
          </div>

          {showScrollButton && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              className="scroll-fab absolute bottom-3 z-20 flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text)] shadow-lg backdrop-blur hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] sm:bottom-4"
              aria-label="Scroll to latest message"
            >
              <ScrollDownIcon />
              <span className="whitespace-nowrap">Jump to latest</span>
            </button>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-panel)]/90 px-2.5 py-2.5 backdrop-blur pb-[calc(0.75rem+var(--safe-bottom))] sm:px-4 sm:py-3 md:px-6 md:py-4">
          <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
            {error && (
              <p className="break-content mb-2 text-xs text-[var(--danger)]">
                {error}
              </p>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-inner focus-within:border-[var(--accent)] sm:rounded-3xl sm:p-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                dir={
                  input.trim()
                    ? textDirection(input)
                    : hydrated && isRtlLanguage(preferredLanguage)
                      ? "rtl"
                      : "ltr"
                }
                lang={
                  input.trim()
                    ? detectLanguage(input, preferredLanguage).iso639
                    : hydrated
                      ? toIso639(preferredLanguage)
                      : "en"
                }
                suppressHydrationWarning
                placeholder={
                  loading
                    ? "Ask a follow-up anytime (cancels the current reply)…"
                    : "Ask about airports…"
                }
                className="max-h-36 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-sm outline-none placeholder:text-[var(--muted)] sm:px-3 text-start"
              />
              <VoiceControls
                preferredLanguage={preferredLanguage}
                onLanguageDetected={rememberLanguage}
                onTranscript={(text) => {
                  const detected = detectLanguage(text, preferredLanguage);
                  rememberLanguage(detected.bcp47);
                  setInput((prev) => (prev ? `${prev.trim()} ${text}` : text));
                  inputRef.current?.focus();
                }}
              />
              <button
                type="submit"
                disabled={!hydrated || !input.trim()}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[#04140c] transition hover:brightness-110 disabled:opacity-40"
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
            <p className="mt-2 hidden text-center text-[11px] text-[var(--muted)] sm:block">
              Enter to send · Shift+Enter for new line · Mic uses browser speech
              recognition · Play on answers uses ElevenLabs TTS
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
