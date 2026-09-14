/** Deterministic routing only; callers supply server-authorized candidates. */
export function selectEmailCampaign(
  campaigns: Array<{ id: string; name: string; slug: string }>,
  requestedName?: string,
): { campaignId: string | null; reason: "selected" | "ambiguous" | "unavailable" } {
  const requested = requestedName?.trim().toLowerCase();
  const candidates = requested
    ? campaigns.filter((campaign) => campaign.name.toLowerCase() === requested || campaign.slug.toLowerCase() === requested)
    : campaigns;
  return candidates.length === 1
    ? { campaignId: candidates[0].id, reason: "selected" }
    : { campaignId: null, reason: candidates.length ? "ambiguous" : "unavailable" };
}

export function selectEmailRevisionTarget(jobs: Array<{ status: string; scenarioCode: string | null }>) {
  const codes = [...new Set(jobs.filter((job) => job.status === "ready" && job.scenarioCode).map((job) => job.scenarioCode!))];
  return { scenarioCode: codes.length === 1 ? codes[0] : null, reason: codes.length > 1 ? "ambiguous" : codes.length ? "selected" : "no_ready_encounter" };
}
