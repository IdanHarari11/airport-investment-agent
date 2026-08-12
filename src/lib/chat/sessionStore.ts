import type { AgentResponse, ChatMessage } from "@/lib/agent/types";

export type StoredUiMessage = ChatMessage & {
  id: string;
  structured?: AgentResponse;
  error?: string;
};

export type StoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredUiMessage[];
};

export type UserSessionStore = {
  version: 1;
  userId: string;
  activeConversationId: string;
  conversations: StoredConversation[];
  /** Sticky BCP-47 from last spoken/typed user language (e.g. he-IL). */
  preferredLanguage?: string;
};

const USER_ID_KEY = "airport-agent:v1:clientUserId";
const storeKey = (userId: string) => `airport-agent:v1:store:${userId}`;

const MAX_CONVERSATIONS = 25;
const MAX_MESSAGES_PER_CONVERSATION = 200;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function newId(): string {
  return crypto.randomUUID();
}

function emptyConversation(id = newId()): StoredConversation {
  return {
    id,
    title: "New chat",
    updatedAt: Date.now(),
    messages: [],
  };
}

function emptyStore(userId: string): UserSessionStore {
  const conversation = emptyConversation();
  return {
    version: 1,
    userId,
    activeConversationId: conversation.id,
    conversations: [conversation],
  };
}

function titleFromMessages(messages: StoredUiMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return "New chat";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function getOrCreateClientUserId(): string {
  if (!canUseStorage()) return newId();
  const existing = localStorage.getItem(USER_ID_KEY)?.trim();
  if (existing) return existing;
  const userId = newId();
  localStorage.setItem(USER_ID_KEY, userId);
  return userId;
}

/** Creates a brand-new anonymous identity (previous chats stay under old key, unused). */
export function resetClientUserIdentity(): string {
  if (!canUseStorage()) return newId();
  const userId = newId();
  localStorage.setItem(USER_ID_KEY, userId);
  const store = emptyStore(userId);
  localStorage.setItem(storeKey(userId), JSON.stringify(store));
  return userId;
}

export function loadUserStore(userId: string): UserSessionStore {
  if (!canUseStorage()) return emptyStore(userId);
  try {
    const raw = localStorage.getItem(storeKey(userId));
    if (!raw) {
      const store = emptyStore(userId);
      localStorage.setItem(storeKey(userId), JSON.stringify(store));
      return store;
    }
    const parsed = JSON.parse(raw) as UserSessionStore;
    if (
      parsed?.version !== 1 ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.conversations)
    ) {
      const store = emptyStore(userId);
      localStorage.setItem(storeKey(userId), JSON.stringify(store));
      return store;
    }
    if (parsed.conversations.length === 0) {
      const store = emptyStore(userId);
      localStorage.setItem(storeKey(userId), JSON.stringify(store));
      return store;
    }
    if (
      !parsed.conversations.some((c) => c.id === parsed.activeConversationId)
    ) {
      parsed.activeConversationId = parsed.conversations[0]!.id;
    }
    return parsed;
  } catch {
    const store = emptyStore(userId);
    localStorage.setItem(storeKey(userId), JSON.stringify(store));
    return store;
  }
}

export function saveUserStore(store: UserSessionStore): void {
  if (!canUseStorage()) return;
  const trimmed: UserSessionStore = {
    ...store,
    conversations: store.conversations
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS)
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
      })),
  };
  if (
    !trimmed.conversations.some((c) => c.id === trimmed.activeConversationId)
  ) {
    trimmed.activeConversationId = trimmed.conversations[0]?.id ?? newId();
  }
  localStorage.setItem(storeKey(store.userId), JSON.stringify(trimmed));
}

export function getActiveConversation(
  store: UserSessionStore,
): StoredConversation {
  return (
    store.conversations.find((c) => c.id === store.activeConversationId) ??
    store.conversations[0] ??
    emptyConversation()
  );
}

export function persistActiveMessages(
  userId: string,
  conversationId: string,
  messages: StoredUiMessage[],
): UserSessionStore {
  const store = loadUserStore(userId);
  const existing = store.conversations.find((c) => c.id === conversationId);
  const conversation: StoredConversation = {
    id: conversationId,
    title: titleFromMessages(messages),
    updatedAt: Date.now(),
    messages,
  };
  const conversations = existing
    ? store.conversations.map((c) =>
        c.id === conversationId ? conversation : c,
      )
    : [conversation, ...store.conversations];
  const next: UserSessionStore = {
    ...store,
    activeConversationId: conversationId,
    conversations,
  };
  saveUserStore(next);
  return next;
}

export function startNewConversation(userId: string): UserSessionStore {
  const store = loadUserStore(userId);
  const conversation = emptyConversation();
  const next: UserSessionStore = {
    ...store,
    activeConversationId: conversation.id,
    conversations: [conversation, ...store.conversations],
  };
  saveUserStore(next);
  return next;
}

export function switchConversation(
  userId: string,
  conversationId: string,
): UserSessionStore {
  const store = loadUserStore(userId);
  if (!store.conversations.some((c) => c.id === conversationId)) {
    return store;
  }
  const next = { ...store, activeConversationId: conversationId };
  saveUserStore(next);
  return next;
}

export function setPreferredLanguage(
  userId: string,
  bcp47: string,
): UserSessionStore {
  const store = loadUserStore(userId);
  const next = { ...store, preferredLanguage: bcp47 };
  saveUserStore(next);
  return next;
}
