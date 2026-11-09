import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, Initiative, Ticket } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

export interface SidebarWorkBoard {
  readonly environmentId: EnvironmentId;
  readonly initiatives: readonly Initiative[];
  readonly tickets: readonly Ticket[];
}

/**
 * Only the primary environment's board. Tickets name Threads by id alone, so a
 * board can only be read against the environment that owns it.
 */
const workTrackingBoardAtom = Atom.make((get): SidebarWorkBoard | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const board = AsyncResult.getOrElse(
    get(serverEnvironment.workTrackingBoardLive({ environmentId, input: {} })),
    () => null,
  );
  return board === null
    ? null
    : { environmentId, initiatives: board.initiatives, tickets: board.tickets };
}).pipe(Atom.withLabel("work-tracking:board:primary"));

export function useWorkTrackingBoard() {
  return useAtomValue(workTrackingBoardAtom);
}
