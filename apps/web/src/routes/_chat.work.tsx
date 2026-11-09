import type { InitiativeId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { WorkPage } from "../components/work/WorkPage";

export const Route = createFileRoute("/_chat/work")({
  validateSearch: (raw: Record<string, unknown>): { initiative?: InitiativeId } =>
    typeof raw.initiative === "string" && raw.initiative
      ? { initiative: raw.initiative.slice(0, 200) as InitiativeId }
      : {},
  component: WorkPage,
});
