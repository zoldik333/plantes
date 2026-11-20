import { z } from "zod";

export const ChatInput = z.object({
  message: z.string().trim().min(1, "Écris ta question").max(2000),
});
export type ChatInput = z.infer<typeof ChatInput>;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Prénom de la personne qui a posé la question ; null pour l'IA ou si son compte a été supprimé. */
  userName: string | null;
  createdAt: string;
}

/** `GET /api/plants/:id/chat` : tout l'historique, du plus ancien au plus récent. */
export interface ChatHistory {
  messages: ChatMessage[];
}

/** `POST /api/plants/:id/chat` : la question enregistrée et la réponse de l'IA. */
export interface ChatReply {
  user: ChatMessage;
  assistant: ChatMessage;
}
