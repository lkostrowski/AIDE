import { TICKET_STATUSES, type Ticket, type TicketStatus } from "@t3tools/contracts";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "To do",
  doing: "Doing",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export type TicketColumns = ReadonlyArray<{
  readonly status: TicketStatus;
  readonly tickets: ReadonlyArray<Ticket>;
}>;

/** Every column is present even when empty, so the board does not reflow as work moves. */
export function ticketColumns(
  tickets: ReadonlyArray<Ticket>,
  initiativeId: string | null,
): TicketColumns {
  const scoped =
    initiativeId === null
      ? tickets
      : tickets.filter((ticket) => ticket.initiativeId === initiativeId);
  return TICKET_STATUSES.map((status) => ({
    status,
    tickets: scoped.filter((ticket) => ticket.status === status),
  }));
}
