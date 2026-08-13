import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAssistantReply,
  clearMessagePending,
  findPendingRetries,
  loadUserStore,
  persistConversationMessages,
  startNewConversation,
} from "../src/lib/chat/sessionStore";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key() {
      return null;
    },
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

describe("sessionStore pending reply routing", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("applies assistant reply to a non-active conversation without switching active", () => {
    const first = loadUserStore(USER_ID);
    const conversationA = first.activeConversationId;
    const withPending = persistConversationMessages(
      USER_ID,
      conversationA,
      [
        {
          id: "u1",
          role: "user",
          content: "Compare LAX and SNA",
          pending: true,
        },
      ],
      { setActive: true },
    );
    expect(withPending.activeConversationId).toBe(conversationA);

    const next = startNewConversation(USER_ID);
    const conversationB = next.activeConversationId;
    expect(conversationB).not.toBe(conversationA);

    const afterReply = applyAssistantReply({
      userId: USER_ID,
      conversationId: conversationA,
      userMessageId: "u1",
      assistant: {
        id: "a1",
        role: "assistant",
        content: "LAX is more congested than SNA.",
      },
    });

    expect(afterReply.activeConversationId).toBe(conversationB);
    const restoredA = afterReply.conversations.find((c) => c.id === conversationA);
    expect(restoredA?.messages).toEqual([
      {
        id: "u1",
        role: "user",
        content: "Compare LAX and SNA",
      },
      {
        id: "a1",
        role: "assistant",
        content: "LAX is more congested than SNA.",
      },
    ]);
    expect(restoredA?.messages[0]?.pending).toBeUndefined();
  });

  it("finds pending retries after an interrupted turn", () => {
    const store = loadUserStore(USER_ID);
    const conversationId = store.activeConversationId;
    persistConversationMessages(USER_ID, conversationId, [
      { id: "h1", role: "user", content: "Earlier question" },
      { id: "h2", role: "assistant", content: "Earlier answer" },
      {
        id: "u2",
        role: "user",
        content: "Compare LAX and SNA",
        pending: true,
      },
    ]);

    const retries = findPendingRetries(loadUserStore(USER_ID));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      conversationId,
      userMessage: {
        id: "u2",
        content: "Compare LAX and SNA",
        pending: true,
      },
      history: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
      ],
    });
  });

  it("does not retry once pending is cleared or a reply exists", () => {
    const store = loadUserStore(USER_ID);
    const conversationId = store.activeConversationId;
    persistConversationMessages(USER_ID, conversationId, [
      {
        id: "u1",
        role: "user",
        content: "Q",
        pending: true,
      },
    ]);

    clearMessagePending(USER_ID, conversationId, "u1");
    expect(findPendingRetries(loadUserStore(USER_ID))).toHaveLength(0);

    persistConversationMessages(USER_ID, conversationId, [
      { id: "u2", role: "user", content: "Q2", pending: true },
      { id: "a2", role: "assistant", content: "A2" },
    ]);
    expect(findPendingRetries(loadUserStore(USER_ID))).toHaveLength(0);
  });

  it("keeps a background reply when another conversation is persisted later", () => {
    const first = loadUserStore(USER_ID);
    const conversationA = first.activeConversationId;
    persistConversationMessages(
      USER_ID,
      conversationA,
      [
        {
          id: "u1",
          role: "user",
          content: "Compare LAX and SNA",
          pending: true,
        },
      ],
      { setActive: true },
    );

    const next = startNewConversation(USER_ID);
    const conversationB = next.activeConversationId;

    applyAssistantReply({
      userId: USER_ID,
      conversationId: conversationA,
      userMessageId: "u1",
      assistant: {
        id: "a1",
        role: "assistant",
        content: "LAX is more congested than SNA.",
      },
    });

    // Active chat B writes its own transcript — must not clobber A's stored reply.
    persistConversationMessages(
      USER_ID,
      conversationB,
      [{ id: "uB", role: "user", content: "Hello from B", pending: true }],
      { setActive: true },
    );

    const store = loadUserStore(USER_ID);
    expect(store.activeConversationId).toBe(conversationB);
    const restoredA = store.conversations.find((c) => c.id === conversationA);
    expect(restoredA?.messages).toEqual([
      {
        id: "u1",
        role: "user",
        content: "Compare LAX and SNA",
      },
      {
        id: "a1",
        role: "assistant",
        content: "LAX is more congested than SNA.",
      },
    ]);
  });

  it("applyAssistantReply is idempotent once an assistant already follows the user turn", () => {
    const store = loadUserStore(USER_ID);
    const conversationId = store.activeConversationId;
    persistConversationMessages(USER_ID, conversationId, [
      { id: "u1", role: "user", content: "Q", pending: true },
    ]);

    applyAssistantReply({
      userId: USER_ID,
      conversationId,
      userMessageId: "u1",
      assistant: {
        id: "a1",
        role: "assistant",
        content: "First answer",
      },
    });

    applyAssistantReply({
      userId: USER_ID,
      conversationId,
      userMessageId: "u1",
      assistant: {
        id: "a2",
        role: "assistant",
        content: "Duplicate final",
      },
    });

    const messages = loadUserStore(USER_ID).conversations.find(
      (c) => c.id === conversationId,
    )?.messages;
    expect(messages).toEqual([
      { id: "u1", role: "user", content: "Q" },
      { id: "a1", role: "assistant", content: "First answer" },
    ]);
  });
});
