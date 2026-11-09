import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  InitiativeId,
  ProjectId,
  ThreadId,
  TicketId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useWorkTrackingBoard } from "../../state/workTracking";
import { makeThreadFixture } from "../../test-fixtures";
import type { Project } from "../../types";
import Sidebar from "../Sidebar";
import { SidebarProvider } from "../ui/sidebar";

vi.mock("../../state/entities", { spy: true });
vi.mock("../../state/environments", { spy: true });
vi.mock("../../state/workTracking", { spy: true });
vi.mock("../../hooks/useHandleNewThread", { spy: true });
vi.mock("../SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("t3code");

function setup() {
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS });
  const project: Project = {
    id: projectId,
    environmentId,
    title: "t3code",
    workspaceRoot: "/projects/t3code",
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
  const thread = (id: string, title: string) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, projectId, title });
  vi.mocked(useProjects).mockReturnValue([project]);
  vi.mocked(usePrimaryEnvironmentId).mockReturnValue(environmentId);
  vi.mocked(useQuietThreadShells).mockReturnValue([
    thread("ticket-thread", "Ticket work"),
    thread("loose-thread", "Loose work"),
  ]);
  vi.mocked(useWorkTrackingBoard).mockReturnValue({
    environmentId,
    initiatives: [
      {
        id: InitiativeId.make("initiative-search"),
        title: "Search revamp",
        description: "",
        projectIds: [projectId],
        initiativeRoot: "/initiatives/search",
        createdBy: "user",
        creationSource: "web",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    tickets: [
      {
        id: TicketId.make("ticket-1"),
        initiativeId: InitiativeId.make("initiative-search"),
        title: "Rank results",
        description: "",
        status: "doing",
        blockedReason: null,
        reviewLinks: [],
        threadIds: [ThreadId.make("ticket-thread")],
        createdBy: "user",
        creationSource: "web",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: { environmentId, projectId },
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef: null,
  });
}

describe("sidebar initiatives", () => {
  it("lists initiatives above the threads and claims their threads once", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    setup();

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const initiatives = screen.getByTestId("sidebar-initiatives-header");
    const folder = screen.getByRole("button", { name: "Search revamp" });
    await expect.element(initiatives).toBeInTheDocument();
    await expect.element(folder).toBeInTheDocument();
    const rows = [...screen.container.querySelectorAll("[data-sidebar-row]")].map((row) =>
      row.getAttribute("data-sidebar-row"),
    );
    // The claimed thread sits under its initiative and not again under Active.
    expect(rows).toEqual([
      "initiatives",
      "initiative:initiative-search",
      "local:ticket-thread",
      "local:loose-thread",
      "shelf:settled",
    ]);
  });
});
