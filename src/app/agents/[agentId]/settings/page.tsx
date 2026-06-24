import { redirect } from "next/navigation";

import { buildSettingsRouteHref } from "@/features/agents/operations/settingsRouteWorkflow";
import { resolveServerStudioBasePath, withStudioBasePath } from "@/lib/studio/base-path";

export default async function AgentSettingsPage({
  params,
}: {
  params: Promise<{ agentId?: string }> | { agentId?: string };
}) {
  const resolvedParams = await params;
  const agentId = (resolvedParams?.agentId ?? "").trim();
  const studioBasePath = resolveServerStudioBasePath();
  if (!agentId) {
    redirect(withStudioBasePath("/", studioBasePath));
  }
  redirect(buildSettingsRouteHref(agentId, studioBasePath));
}
