import { describe, expect, it } from "@effect/vitest";

import { ticketBranchName, ticketPrompt } from "./TicketLaunchService.ts";

describe("ticketBranchName", () => {
  // git rejects spaces, '..', leading/trailing dashes and most punctuation in a ref.
  it.each([
    { title: "Ship custom taxes", expected: "ticket/ship-custom-taxes-abcd1234" },
    { title: "Fix: rates/VAT (EU)!", expected: "ticket/fix-rates-vat-eu-abcd1234" },
    { title: "   ", expected: "ticket/work-abcd1234" },
    { title: "日本語", expected: "ticket/work-abcd1234" },
    // The 40-char cut lands on a separator here, which must not survive it.
    {
      title: "Ship custom taxes across core dashboard and docs",
      expected: "ticket/ship-custom-taxes-across-core-dashboard-abcd1234",
    },
    {
      title: "A very long ticket title that keeps going well past any sane branch length",
      expected: "ticket/a-very-long-ticket-title-that-keeps-goin-abcd1234",
    },
  ])("turns $title into a usable branch", ({ title, expected }) => {
    const branch = ticketBranchName(title, "ticket:abcd1234-0000-0000-0000-000000000000");
    expect(branch).toBe(expected);
    expect(branch).toMatch(/^ticket\/[a-z0-9][a-z0-9-]*$/u);
    expect(branch).not.toContain("--");
  });
});

it("sends the ticket's description with its title, and the title alone without one", () => {
  expect(ticketPrompt({ title: "Ship taxes", description: "  Rates table.  " })).toBe(
    "Ship taxes\n\nRates table.",
  );
  expect(ticketPrompt({ title: "Ship taxes", description: "   " })).toBe("Ship taxes");
});
