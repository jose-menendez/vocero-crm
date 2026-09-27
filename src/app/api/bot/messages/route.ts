import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
  /**
   * Idempotencia del cerebro externo. Para WhatsApp usamos el ID del mensaje
   * entrante que originó esta respuesta. Si Meta/n8n entrega el mismo evento
   * varias veces en paralelo, solo el primer request toca Graph.
   */
  idempotencyKey: z.string().min(1).max(255).optional(),
});

type Delivery = { messageId: string };

type DeliveryClaim = {
  expiresAt: number;
  promise: Promise<Delivery>;
};

const globalClaims = globalThis as typeof globalThis & {
  __voceroBotDeliveryClaims?: Map<string, DeliveryClaim>;
};

const deliveryClaims =
  globalClaims.__voceroBotDeliveryClaims ??
  (globalClaims.__voceroBotDeliveryClaims = new Map<string, DeliveryClaim>());

const CLAIM_TTL_MS = 15 * 60_000;

function pruneClaims(now: number) {
  for (const [key, claim] of deliveryClaims) {
    if (claim.expiresAt <= now) deliveryClaims.delete(key);
  }
}

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación) · window_closed ·
 * sandbox_violation.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
  // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
  // (segundos de un LLM) el dueño pudo haber tomado la conversación.
  const db = getDb();
  const convs = await db
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  try {
    const deliver = () =>
      sendText({
        conversationId: body.data.conversationId,
        organizationId,
        text: body.data.text,
        aiGenerated: true,
      });

    if (!body.data.idempotencyKey) {
      const result = await deliver();
      return Response.json({ messageId: result.messageId, deduplicated: false });
    }

    const now = Date.now();
    pruneClaims(now);
    const claimKey =
      organizationId + ":" + body.data.conversationId + ":" + body.data.idempotencyKey;

    const existing = deliveryClaims.get(claimKey);
    if (existing && existing.expiresAt > now) {
      const result = await existing.promise;
      return Response.json({ messageId: result.messageId, deduplicated: true });
    }

    const promise = deliver().catch((err) => {
      // Un fallo real puede reintentarse manualmente; no quemamos la clave.
      deliveryClaims.delete(claimKey);
      throw err;
    });
    deliveryClaims.set(claimKey, {
      expiresAt: now + CLAIM_TTL_MS,
      promise,
    });

    const result = await promise;
    return Response.json({ messageId: result.messageId, deduplicated: false });
  } catch (err) {
    if (err instanceof SendError) {
      if (err.code === "window_closed") {
        return apiError(409, "window_closed", err.message);
      }
      if (err.code === "sandbox_violation") {
        return apiError(409, "sandbox_violation", err.message);
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}
