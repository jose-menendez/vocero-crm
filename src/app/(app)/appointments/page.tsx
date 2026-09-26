import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { AppointmentsClient } from "@/components/appointments/appointments-client";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");

  return (
    <AppointmentsClient
      timezone={process.env.EXTERNAL_CALENDAR_TIMEZONE?.trim() || "America/New_York"}
      googleCalendarUrl={
        process.env.GOOGLE_CALENDAR_WEB_URL?.trim() ||
        "https://calendar.google.com/calendar/u/0/r"
      }
    />
  );
}
