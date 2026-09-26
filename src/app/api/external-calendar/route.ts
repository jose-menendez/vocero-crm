import { apiError, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

type RawEvent = {
  id?: unknown;
  summary?: unknown;
  title?: unknown;
  start?: unknown;
  end?: unknown;
  htmlLink?: unknown;
  description?: unknown;
  status?: unknown;
};

function iso(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidate = obj.dateTime ?? obj.date;
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

function normalize(raw: unknown) {
  const source =
    Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { appointments?: unknown }).appointments)
        ? (raw as { appointments: unknown[] }).appointments
        : raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
          ? (raw as { events: unknown[] }).events
          : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
            ? (raw as { data: unknown[] }).data
            : [];

  return source
    .map((item, index) => {
      const event = (item ?? {}) as RawEvent;
      const start = iso(event.start);
      const end = iso(event.end);
      if (!start || !end) return null;
      return {
        id: typeof event.id === "string" ? event.id : `event-${index}-${start}`,
        title:
          typeof event.summary === "string"
            ? event.summary
            : typeof event.title === "string"
              ? event.title
              : "Cita",
        start,
        end,
        htmlLink: typeof event.htmlLink === "string" ? event.htmlLink : null,
        description: typeof event.description === "string" ? event.description : null,
        status: typeof event.status === "string" ? event.status : null,
      };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .filter((event) => event.status !== "cancelled")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export const GET = withAuth(async () => {
  const url = process.env.N8N_CALENDAR_FEED_URL?.trim();
  if (!url) {
    return apiError(
      503,
      "calendar_not_configured",
      "La vista de citas todavía no tiene configurado su feed de n8n."
    );
  }

  const token = process.env.N8N_CALENDAR_FEED_TOKEN?.trim();
  const headers: HeadersInit = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const now = new Date();
  const until = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const feedUrl = new URL(url);
  feedUrl.searchParams.set("from", now.toISOString());
  feedUrl.searchParams.set("to", until.toISOString());

  const res = await fetch(feedUrl, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res?.ok) {
    return apiError(
      502,
      "calendar_feed_unavailable",
      "n8n no respondió correctamente al consultar Google Calendar."
    );
  }

  const raw = await res.json().catch(() => null);
  if (raw === null) {
    return apiError(502, "calendar_feed_invalid", "n8n devolvió una respuesta inválida.");
  }

  return Response.json({
    appointments: normalize(raw),
    timezone: process.env.EXTERNAL_CALENDAR_TIMEZONE?.trim() || "America/New_York",
  });
});
