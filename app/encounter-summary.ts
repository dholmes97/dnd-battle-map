export type EncounterSummary = {
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updatedAt: number;
};
