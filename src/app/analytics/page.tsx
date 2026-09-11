import { redirect } from "next/navigation";
import { requireUser } from "@/lib/require-user";
import AnalyticsView from "./analytics-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics — Tweet Voice Cloner",
};

export default async function AnalyticsPage() {
  const user = await requireUser();
  if (!user) redirect("/login");
  return <AnalyticsView />;
}
