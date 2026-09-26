import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey } from "@/server/bot/auth";
import type { WebhookPayload } from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.any()).optional(),
}).passthrough();

/**
 * Entrada autenticada para un cerebro externo/proxy (por ejemplo n8n).
 *
 * Meta puede seguir apuntando al webhook de n8n. n8n reenvía el payload
 * parseado aquí usando X-API-Key, y Vocero lo ingiere por el mismo camino que
 * su webhook público: bandeja, contactos, pipeline, estados y coexistence.
 *
 * A diferencia del webhook público, esta ruta no usa x-hub-signature-256:
 * la autenticación es BOT_API_KEY y está pensada exclusivamente para tráfico
 * servidor-a-servidor.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const payload = body.data as WebhookPayload;

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (!change.value) continue;
        if (change.field === "messages") {
          await processMessagesValue(change.value);
        } else if (change.field === "smb_message_echoes") {
          await processEchoesValue(change.value);
        } else if (change.field === "message_template_status_update") {
          await processTemplateStatusValue(entry.id ?? null, change.value);
        }
      }
    }
  } catch (err) {
    console.error("[bot/inbound] error procesando payload:", err);
    return apiError(500, "ingest_failed", "No se pudo procesar el evento");
  }

  return Response.json({ received: true });
}
