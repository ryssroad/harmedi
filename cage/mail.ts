// Outbound email voice via AgentMail Sprites Connector.
import { getConnector, json } from "./gateway.ts";

function configured(): { inbox: string; to: string } | null {
  const inbox = (process.env.HARMEDI_INBOX ?? "alephzero@agentmail.to").trim();
  const to = process.env.CREATOR_EMAIL?.trim();
  if (!inbox || !to) return null;
  return { inbox, to };
}

export async function sendMail(subject: string, text: string): Promise<boolean> {
  const cfg = configured();
  if (!cfg || !(await getConnector("agentmail"))) return false;
  try {
    await json("agentmail", `/v0/inboxes/${encodeURIComponent(cfg.inbox)}/messages/send`, {
      to: [cfg.to],
      subject,
      text,
    });
    return true;
  } catch (e) {
    console.warn("AgentMail send skipped:", (e as Error).message);
    return false;
  }
}

export async function replyMail(messageId: string, text: string): Promise<boolean> {
  const cfg = configured();
  if (!cfg || !messageId || !(await getConnector("agentmail"))) return false;
  try {
    await json(
      "agentmail",
      `/v0/inboxes/${encodeURIComponent(cfg.inbox)}/messages/${encodeURIComponent(messageId)}/reply`,
      { text },
    );
    return true;
  } catch (e) {
    console.warn("AgentMail reply skipped:", (e as Error).message);
    return false;
  }
}
