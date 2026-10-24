import { DEFAULT_BUSINESS_NAME, DEFAULT_BUSINESS_INSTRUCTIONS } from "./product";
export type DateOrder = "DMY" | "MDY";
export type Stage = "New lead" | "In conversation" | "Follow-up" | "Client";
export interface Settings {
  businessName: string;
  businessInstructions: string;
  model: string;
  autoSend: boolean;
  autoDraft: boolean;
  allChats: boolean;
  dateOrder: DateOrder;
}
export interface Knowledge {
  id: string;
  name: string;
  text: string;
  addedAt: number;
}
export interface Message {
  id: string;
  text: string;
  direction: "in" | "out";
  images?: string[];
  at: number | null;
}
export interface ChatContext {
  chatId: string;
  name: string;
  isGroup: boolean;
  messages: Message[];
  lastIncomingAt: number | null;
  lastIncomingId: string | null;
  composerEmpty: boolean;
  atBottom: boolean;
  observedAt: number;
}
export interface Client {
  chatId: string;
  name: string;
  stage: Stage;
  notes: string;
  human: boolean;
  lastIncomingAt: number | null;
  lastIncomingId: string | null;
  lastSeen: number;
  messageIds?: string[];
}
export interface FollowUp {
  id: string;
  chatId: string;
  name: string;
  message: string;
  dueAt: number;
  mode: "review" | "automatic";
  status: "pending" | "ready" | "completed" | "cancelled" | "sending";
  createdAt: number;
  detail?: string;
}
export interface Draft {
  reply: string;
  needsHuman: boolean;
  reason: string;
  sources: string[];
  chatId: string;
  incomingId: string | null;
  createdAt: number;
  placement?: string;
}
export interface ReplyTiming {
  chatId: string;
  incomingId: string | null;
  dueAt: number;
  phase: "quiet" | "send";
}
export interface InboxItem {
  key: string;
  name: string;
  preview: string;
  fingerprint: string;
  previewExact?: boolean;
  observedAt: number;
  dueAt: number;
  chatId?: string;
  incomingId?: string;
  status: "waiting" | "replying" | "review" | "sent" | "skipped";
  detail?: string;
}
export interface InboxState {
  enabled: boolean;
  status: string;
  busyKey: string | null;
  items: InboxItem[];
  updatedAt: number;
  observedChats: number;
}
export interface DeskState {
  settings: Settings;
  knowledge: Knowledge[];
  clients: Record<string, Client>;
  followUps: FollowUp[];
  hasKey: boolean;
  models: string[];
  context: ChatContext | null;
  draft: Draft | null;
  activity: string;
  replyTiming: ReplyTiming | null;
  inbox: InboxState | null;
}
export interface PendingReply {
  tabId: number;
  chatId: string;
  incomingId: string;
  dueAt: number;
  outgoingIds: string[];
}
export const LEGACY_BUSINESS_INSTRUCTIONS =
  "Be warm, professional and concise. Use the customer’s language. Ask one useful question at a time. Use only the supplied business knowledge for facts, prices and timelines. If something is unclear, ask a human colleague.";

export const DEFAULT_SETTINGS: Settings = {
  businessName: DEFAULT_BUSINESS_NAME,
  businessInstructions: DEFAULT_BUSINESS_INSTRUCTIONS,
  model: "gpt-5-mini",
  autoSend: false,
  autoDraft: false,
  allChats: false,
  dateOrder: "MDY",
};
