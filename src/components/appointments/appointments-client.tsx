"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Appointment = {
  id: string;
  title: string;
  start: string;
  end: string;
  htmlLink?: string | null;
  description?: string | null;
  status?: string | null;
};

type ApiPayload = {
  appointments: Appointment[];
  timezone: string;
};

function dayKey(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("es-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("es-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function AppointmentsClient({
  timezone,
  googleCalendarUrl,
}: {
  timezone: string;
  googleCalendarUrl: string;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/external-calendar", { cache: "no-store" }).catch(
      () => null
    );
    const data = res
      ? ((await res.json().catch(() => null)) as
          | ApiPayload
          | { error?: { message?: string } }
          | null)
      : null;
    if (!res?.ok || !data || !("appointments" in data)) {
      setError(
        data && "error" in data
          ? data.error?.message || "No se pudieron cargar las citas."
          : "No se pudieron cargar las citas."
      );
      setAppointments([]);
      setLoading(false);
      return;
    }
    setAppointments(data.appointments);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const key = dayKey(appointment.start, timezone);
      const list = map.get(key) ?? [];
      list.push(appointment);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [appointments, timezone]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold tracking-tight">Citas</h2>
          <p className="mt-0.5 text-xs text-text-3">
            Google Calendar es la fuente de verdad · {timezone}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={"h-4 w-4" + (loading ? " animate-spin" : "")} />
          Actualizar
        </Button>
        <a href={googleCalendarUrl} target="_blank" rel="noreferrer">
          <Button size="sm">
            <ExternalLink className="h-4 w-4" />
            Abrir Google Calendar
          </Button>
        </a>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Próximas citas</CardTitle>
            <CardDescription>
              Vista de solo lectura del mismo calendario que usa la automatización.
              Reprogramar o cancelar se sigue haciendo manualmente en Google Calendar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && (
              <p className="text-sm text-text-3">Cargando citas…</p>
            )}

            {!loading && error && (
              <div className="rounded-md border border-border-strong bg-subtle p-4">
                <p className="text-sm font-semibold">No se pudo leer el calendario</p>
                <p className="mt-1 text-sm text-text-3">{error}</p>
              </div>
            )}

            {!loading && !error && appointments.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarDays className="mb-3 h-8 w-8 text-text-3" strokeWidth={1.5} />
                <p className="font-semibold">No hay citas próximas</p>
                <p className="mt-1 text-sm text-text-3">
                  Las citas creadas por n8n aparecerán aquí.
                </p>
              </div>
            )}

            {!loading && !error && groups.length > 0 && (
              <div className="space-y-6">
                {groups.map(([day, items]) => (
                  <section key={day}>
                    <h3 className="mb-2 text-sm font-bold capitalize">
                      {dayLabel(items[0].start, timezone)}
                    </h3>
                    <div className="divide-y divide-border rounded-md border border-border">
                      {items.map((appointment) => (
                        <div
                          key={appointment.id}
                          className="flex flex-wrap items-center gap-3 px-4 py-3"
                        >
                          <div className="w-28 shrink-0 text-sm font-semibold">
                            {timeLabel(appointment.start, timezone)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {appointment.title || "Cita"}
                            </p>
                            <p className="text-xs text-text-3">
                              {timeLabel(appointment.start, timezone)} –{" "}
                              {timeLabel(appointment.end, timezone)}
                            </p>
                          </div>
                          {(appointment.htmlLink || googleCalendarUrl) && (
                            <a
                              href={appointment.htmlLink || googleCalendarUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold text-brand-text hover:underline"
                            >
                              Abrir
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
