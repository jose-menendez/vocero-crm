import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * Reactiva SOLO la IA de una conversación tras un handoff.
 *
 * A diferencia de /api/bot/reset, no toca pipeline, lead ni historial.
 * Sirve para "Resume AI" desde un cerebro externo o panel de respaldo.
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

  const db = getDb();
  const rows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);

  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  await db
    .update(schema.conversation)
    .set({
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conv.id));

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id } },
  });

  return Response.json({ ok: true });
}
