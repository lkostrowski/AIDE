import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  Artifact,
  EnvironmentId,
  Initiative,
  InitiativeId,
  ProjectId,
  Ticket,
  TicketStatus,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { PlayIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentProjects } from "../../state/projects";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { TICKET_STATUS_LABELS, ticketColumns } from "./workBoard";

const STATUS_BADGE: Record<TicketStatus, "secondary" | "destructive" | "outline" | "default"> = {
  todo: "outline",
  doing: "default",
  blocked: "destructive",
  review: "secondary",
  done: "secondary",
};

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: String(squashAtomCommandFailure(result)),
    }),
  );
}

export function WorkPage() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2">
        <h1 className="text-sm font-medium">Work</h1>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <WorkspacePageContainer width="expanded">
          {environmentId === null ? (
            <p className="text-sm text-muted-foreground">
              Connect an environment to track initiatives and tickets.
            </p>
          ) : (
            <WorkBoard environmentId={environmentId} />
          )}
        </WorkspacePageContainer>
      </ScrollArea>
    </div>
  );
}

function WorkBoard({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const query = useAtomValue(serverEnvironment.workTrackingBoardLive({ environmentId, input: {} }));
  const board = AsyncResult.getOrElse(query, () => null);
  const canOperate = useAtomValue(serverEnvironment.upsertTicket.permissionAtom(environmentId));
  // The sidebar links straight to an Initiative, so the URL owns the selection.
  const { initiative: selectedId } = useSearch({ from: "/_chat/work" });
  const navigate = useNavigate();
  const selectInitiative = (initiativeId: InitiativeId | undefined) =>
    void navigate({
      to: "/work",
      search: initiativeId === undefined ? {} : { initiative: initiativeId },
    });
  const [initiativeDraft, setInitiativeDraft] = useState<Initiative | "new" | null>(null);
  const [ticketDraft, setTicketDraft] = useState<{
    readonly ticket: Ticket | null;
    readonly status?: TicketStatus;
  } | null>(null);

  const deleteInitiative = useAtomCommand(serverEnvironment.deleteInitiative, {
    label: "initiative delete",
  });

  const initiatives = board?.initiatives ?? [];
  const selected =
    initiatives.find((initiative) => initiative.id === selectedId) ?? initiatives[0] ?? null;
  const columns = ticketColumns(board?.tickets ?? [], selected?.id ?? null);

  const removeInitiative = async (initiative: Initiative) => {
    const hasTickets = (board?.tickets ?? []).some(
      (ticket) => ticket.initiativeId === initiative.id,
    );
    const result = await deleteInitiative({
      environmentId,
      input: { id: initiative.id, ...(hasTickets ? { force: true } : {}) },
    });
    reportFailure("Could not delete initiative", result);
    if (result._tag === "Success") selectInitiative(undefined);
  };

  return (
    <div className="flex flex-col gap-6">
      {query._tag === "Failure" ? (
        <p className="text-sm text-destructive">{formatEnvironmentQueryError(query.cause)}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {initiatives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {board === null ? "Loading work…" : "No initiatives yet."}
          </p>
        ) : (
          <Select
            value={selected?.id ?? ""}
            onValueChange={(value) => {
              if (value !== null) selectInitiative(String(value) as InitiativeId);
            }}
          >
            <SelectTrigger aria-label="Initiative" className="w-64" size="sm">
              <SelectValue>{selected?.title}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {initiatives.map((initiative) => (
                <SelectItem key={initiative.id} value={initiative.id}>
                  {initiative.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        <Button disabled={!canOperate} onClick={() => setInitiativeDraft("new")} size="sm">
          <PlusIcon /> Initiative
        </Button>
        {selected === null ? null : (
          <>
            <Button
              disabled={!canOperate}
              onClick={() => setInitiativeDraft(selected)}
              size="sm"
              variant="outline"
            >
              Edit
            </Button>
            <Button
              aria-label="Delete initiative"
              disabled={!canOperate}
              onClick={() => void removeInitiative(selected)}
              size="sm"
              variant="outline"
            >
              <Trash2Icon />
            </Button>
            <Button
              disabled={!canOperate}
              onClick={() => setTicketDraft({ ticket: null })}
              size="sm"
            >
              <PlusIcon /> Ticket
            </Button>
          </>
        )}
      </div>

      {selected === null ? null : (
        <>
          {selected.description === "" ? null : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {selected.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Artifacts land in <code>{selected.initiativeRoot}</code>
          </p>
          <div className="grid gap-3 md:grid-cols-5">
            {columns.map((column) => (
              <section className="flex min-w-0 flex-col gap-2" key={column.status}>
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {TICKET_STATUS_LABELS[column.status]} · {column.tickets.length}
                </h2>
                {column.tickets.map((ticket) => (
                  <TicketCard
                    artifacts={(board?.artifacts ?? []).filter(
                      (artifact) => artifact.ticketId === ticket.id,
                    )}
                    canOperate={canOperate}
                    environmentId={environmentId}
                    initiative={selected}
                    key={ticket.id}
                    onEdit={(status) => setTicketDraft({ ticket, ...(status ? { status } : {}) })}
                    ticket={ticket}
                  />
                ))}
              </section>
            ))}
          </div>
          <InitiativeArtifacts
            artifacts={(board?.artifacts ?? []).filter(
              (artifact) => artifact.initiativeId === selected.id && artifact.ticketId === null,
            )}
            canOperate={canOperate}
            environmentId={environmentId}
            initiative={selected}
          />
        </>
      )}

      {initiativeDraft === null ? null : (
        <InitiativeDialog
          environmentId={environmentId}
          initiative={initiativeDraft === "new" ? null : initiativeDraft}
          onClose={() => setInitiativeDraft(null)}
        />
      )}
      {ticketDraft === null || selected === null ? null : (
        <TicketDialog
          environmentId={environmentId}
          initiativeId={selected.id}
          onClose={() => setTicketDraft(null)}
          ticket={ticketDraft.ticket}
          {...(ticketDraft.status ? { initialStatus: ticketDraft.status } : {})}
        />
      )}
    </div>
  );
}

function TicketCard({
  artifacts,
  canOperate,
  environmentId,
  initiative,
  onEdit,
  ticket,
}: {
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly canOperate: boolean;
  readonly environmentId: EnvironmentId;
  readonly initiative: Initiative;
  readonly onEdit: (status?: TicketStatus) => void;
  readonly ticket: Ticket;
}) {
  const navigate = useNavigate();
  const threads = useAtomValue(environmentThreadShells.environmentThreadsAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertTicket, { label: "ticket status" });
  const remove = useAtomCommand(serverEnvironment.deleteTicket, { label: "ticket delete" });
  const start = useAtomCommand(serverEnvironment.startTicket, { label: "ticket start" });
  const unlink = useAtomCommand(serverEnvironment.unlinkTicketThread, {
    label: "ticket unlink thread",
  });
  const [starting, setStarting] = useState(false);
  const [projectChoice, setProjectChoice] = useState(false);
  const threadTitle = (threadId: ThreadId) =>
    threads.find((thread) => thread.id === threadId)?.title ?? threadId;

  const startTicket = async (projectId?: ProjectId) => {
    setStarting(true);
    const result = await start({
      environmentId,
      input: { ticketId: ticket.id, ...(projectId ? { projectId } : {}) },
    });
    setStarting(false);
    reportFailure("Could not start ticket", result);
    if (result._tag !== "Success") return;
    setProjectChoice(false);
    // The agent is already running; land the user where the work is.
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: result.value.threadId },
    });
  };

  const setStatus = async (status: TicketStatus) => {
    // Blocked needs a reason the board can show; the dialog is where one is written.
    if (status === "blocked" && (ticket.blockedReason ?? "") === "") {
      onEdit("blocked");
      return;
    }
    reportFailure(
      "Could not move ticket",
      await upsert({ environmentId, input: { id: ticket.id, status } }),
    );
  };

  return (
    <article className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <button className="text-start text-sm font-medium" onClick={() => onEdit()} type="button">
        {ticket.title}
      </button>
      {ticket.description === "" ? null : (
        <p className="line-clamp-3 text-xs text-muted-foreground">{ticket.description}</p>
      )}
      {ticket.status === "blocked" && ticket.blockedReason !== null ? (
        <p className="text-xs text-destructive">{ticket.blockedReason}</p>
      ) : null}
      {ticket.reviewLinks.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {ticket.reviewLinks.map((reviewLink) => (
            <li className="truncate text-xs" key={reviewLink}>
              <a href={reviewLink} rel="noreferrer" target="_blank">
                {reviewLink}
              </a>
            </li>
          ))}
        </ul>
      )}
      {ticket.threadIds.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1">
          {ticket.threadIds.map((threadId) => (
            <li key={threadId}>
              <Badge variant="outline">
                <span className="max-w-32 truncate">{threadTitle(threadId)}</span>
                <button
                  aria-label={`Unlink ${threadTitle(threadId)}`}
                  disabled={!canOperate}
                  onClick={() =>
                    void unlink({ environmentId, input: { ticketId: ticket.id, threadId } }).then(
                      (result) => reportFailure("Could not unlink thread", result),
                    )
                  }
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {artifacts.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {artifacts.map((artifact) => (
            <li className="truncate text-xs text-muted-foreground" key={artifact.id}>
              {artifact.title} · {artifact.fileName}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Select
          value={ticket.status}
          disabled={!canOperate}
          onValueChange={(value) => {
            if (value !== null) void setStatus(value as TicketStatus);
          }}
        >
          <SelectTrigger aria-label={`Status of ${ticket.title}`} className="w-28" size="sm">
            <SelectValue>
              <Badge variant={STATUS_BADGE[ticket.status]}>
                {TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {Object.entries(TICKET_STATUS_LABELS).map(([status, label]) => (
              <SelectItem key={status} value={status}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          disabled={!canOperate || starting}
          onClick={() => setProjectChoice(true)}
          size="sm"
          title="New thread in its own worktree, running this ticket."
          variant="outline"
        >
          <PlayIcon />
          {starting ? "Starting" : "Start"}
        </Button>
        <Button
          aria-label={`Delete ${ticket.title}`}
          disabled={!canOperate}
          onClick={() =>
            void remove({ environmentId, input: { id: ticket.id } }).then((result) =>
              reportFailure("Could not delete ticket", result),
            )
          }
          size="sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      {projectChoice ? (
        <StartProjectDialog
          environmentId={environmentId}
          initiative={initiative}
          onClose={() => setProjectChoice(false)}
          onStart={startTicket}
          ticket={ticket}
        />
      ) : null}
    </article>
  );
}

function StartProjectDialog({
  environmentId,
  initiative,
  onClose,
  onStart,
  ticket,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: Initiative;
  readonly onClose: () => void;
  readonly onStart: (projectId: ProjectId) => Promise<void>;
  readonly ticket: Ticket;
}) {
  const projects = useAtomValue(environmentProjects.environmentProjectsAtom(environmentId));
  // An Initiative with no project yet picks from everything here, and adopts the choice.
  const options =
    initiative.projectIds.length > 0
      ? initiative.projectIds
      : projects.map((project) => project.id);
  const [projectId, setProjectId] = useState<ProjectId | null>(options[0] ?? null);
  const title = (id: ProjectId) => projects.find((project) => project.id === id)?.title ?? id;

  return (
    <DraftDialog
      disabled={projectId === null}
      onClose={onClose}
      onSave={() => (projectId === null ? Promise.resolve() : onStart(projectId))}
      saveLabel="Start"
      title={`Start ${ticket.title}`}
    >
      <Label>Project</Label>
      {projectId === null ? (
        <p className="text-xs text-muted-foreground">
          This environment has no projects yet. Add one first.
        </p>
      ) : (
        <>
          <Select
            value={projectId}
            onValueChange={(value) => {
              if (value !== null) setProjectId(value as ProjectId);
            }}
          >
            <SelectTrigger aria-label="Project to start in" size="sm">
              <SelectValue>{title(projectId)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {options.map((id) => (
                <SelectItem key={id} value={id}>
                  {title(id)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {initiative.projectIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">The initiative will keep this project.</p>
          ) : null}
        </>
      )}
    </DraftDialog>
  );
}

function InitiativeArtifacts({
  artifacts,
  canOperate,
  environmentId,
  initiative,
}: {
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly canOperate: boolean;
  readonly environmentId: EnvironmentId;
  readonly initiative: Initiative;
}) {
  const [open, setOpen] = useState(false);
  const remove = useAtomCommand(serverEnvironment.deleteArtifact, { label: "artifact delete" });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Artifacts
        </h2>
        <Button disabled={!canOperate} onClick={() => setOpen(true)} size="sm" variant="outline">
          <PlusIcon /> Note
        </Button>
      </div>
      {artifacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Plans, research notes and reports a thread wrote for this initiative appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {artifacts.map((artifact) => (
            <li className="flex items-center gap-2 text-xs" key={artifact.id}>
              <span className="font-medium">{artifact.title}</span>
              <code className="truncate text-muted-foreground">{artifact.path}</code>
              <Button
                aria-label={`Delete ${artifact.title}`}
                disabled={!canOperate}
                onClick={() =>
                  void remove({
                    environmentId,
                    input: { id: artifact.id, deleteFile: true },
                  }).then((result) => reportFailure("Could not delete artifact", result))
                }
                size="sm"
                variant="ghost"
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <ArtifactDialog
          environmentId={environmentId}
          initiative={initiative}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function ArtifactDialog({
  environmentId,
  initiative,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: Initiative;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("note.md");
  const [content, setContent] = useState("");
  const write = useAtomCommand(serverEnvironment.writeArtifact, { label: "artifact write" });

  const save = async () => {
    const result = await write({
      environmentId,
      input: {
        initiativeId: initiative.id,
        title: title.trim(),
        fileName: fileName.trim(),
        content,
        createdBy: "user",
        creationSource: "web",
      },
    });
    reportFailure("Could not write artifact", result);
    if (result._tag === "Success") onClose();
  };

  return (
    <DraftDialog
      disabled={title.trim() === "" || fileName.trim() === ""}
      onClose={onClose}
      onSave={save}
      title="New artifact"
    >
      <Label htmlFor="artifact-title">Title</Label>
      <Input id="artifact-title" onChange={(e) => setTitle(e.target.value)} value={title} />
      <Label htmlFor="artifact-file">File name</Label>
      <Input id="artifact-file" onChange={(e) => setFileName(e.target.value)} value={fileName} />
      <Label htmlFor="artifact-content">Content</Label>
      <Textarea
        id="artifact-content"
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        value={content}
      />
    </DraftDialog>
  );
}

function InitiativeDialog({
  environmentId,
  initiative,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: Initiative | null;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [description, setDescription] = useState(initiative?.description ?? "");
  const [projectIds, setProjectIds] = useState<ReadonlyArray<ProjectId>>(
    initiative?.projectIds ?? [],
  );
  const projects = useAtomValue(environmentProjects.environmentProjectsAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertInitiative, { label: "initiative save" });

  const save = async () => {
    const result = await upsert({
      environmentId,
      input: {
        ...(initiative === null ? {} : { id: initiative.id }),
        title: title.trim(),
        description,
        projectIds,
        createdBy: "user",
        creationSource: "web",
      },
    });
    reportFailure("Could not save initiative", result);
    if (result._tag === "Success") onClose();
  };

  return (
    <DraftDialog
      disabled={title.trim() === ""}
      onClose={onClose}
      onSave={save}
      title={initiative === null ? "New initiative" : "Edit initiative"}
    >
      <Label htmlFor="initiative-title">Title</Label>
      <Input id="initiative-title" onChange={(e) => setTitle(e.target.value)} value={title} />
      <Label htmlFor="initiative-description">Description</Label>
      <Textarea
        id="initiative-description"
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        value={description}
      />
      <Label>Projects</Label>
      <p className="text-xs text-muted-foreground">
        Where its tickets start their work. Start offers these; with none it offers them all.
      </p>
      <div className="flex flex-col gap-1">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">This environment has no projects yet.</p>
        ) : (
          projects.map((project) => (
            <label className="flex items-center gap-2 text-sm" key={project.id}>
              <Checkbox
                checked={projectIds.includes(project.id)}
                onCheckedChange={(checked) =>
                  setProjectIds((current) =>
                    checked ? [...current, project.id] : current.filter((id) => id !== project.id),
                  )
                }
              />
              {project.title}
            </label>
          ))
        )}
      </div>
    </DraftDialog>
  );
}

function TicketDialog({
  environmentId,
  initialStatus,
  initiativeId,
  onClose,
  ticket,
}: {
  readonly environmentId: EnvironmentId;
  /** The status the board asked for, when a move needed a field the card cannot edit. */
  readonly initialStatus?: TicketStatus;
  readonly initiativeId: string;
  readonly onClose: () => void;
  readonly ticket: Ticket | null;
}) {
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [status, setStatus] = useState<TicketStatus>(initialStatus ?? ticket?.status ?? "todo");
  const [blockedReason, setBlockedReason] = useState(ticket?.blockedReason ?? "");
  const [reviewLinks, setReviewLinks] = useState((ticket?.reviewLinks ?? []).join("\n"));
  const upsert = useAtomCommand(serverEnvironment.upsertTicket, { label: "ticket save" });

  const save = async () => {
    const result = await upsert({
      environmentId,
      input: {
        ...(ticket === null
          ? { initiativeId: initiativeId as Initiative["id"] }
          : { id: ticket.id }),
        title: title.trim(),
        description,
        status,
        blockedReason: blockedReason.trim() === "" ? null : blockedReason.trim(),
        reviewLinks: reviewLinks
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        createdBy: "user",
        creationSource: "web",
      },
    });
    reportFailure("Could not save ticket", result);
    if (result._tag === "Success") onClose();
  };

  return (
    <DraftDialog
      disabled={title.trim() === "" || (status === "blocked" && blockedReason.trim() === "")}
      onClose={onClose}
      onSave={save}
      title={ticket === null ? "New ticket" : "Edit ticket"}
    >
      <Label htmlFor="ticket-title">Title</Label>
      <Input id="ticket-title" onChange={(e) => setTitle(e.target.value)} value={title} />
      <Label htmlFor="ticket-description">Description</Label>
      <Textarea
        id="ticket-description"
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        value={description}
      />
      <Label>Status</Label>
      <Select
        value={status}
        onValueChange={(value) => {
          if (value !== null) setStatus(value as TicketStatus);
        }}
      >
        <SelectTrigger aria-label="Status" size="sm">
          <SelectValue>{TICKET_STATUS_LABELS[status]}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {status === "blocked" ? (
        <>
          <Label htmlFor="ticket-blocked">Blocked reason</Label>
          <Input
            id="ticket-blocked"
            onChange={(e) => setBlockedReason(e.target.value)}
            value={blockedReason}
          />
        </>
      ) : null}
      <Label htmlFor="ticket-review-links">Review links, one per line</Label>
      <Textarea
        id="ticket-review-links"
        onChange={(e) => setReviewLinks(e.target.value)}
        rows={3}
        value={reviewLinks}
      />
    </DraftDialog>
  );
}

function DraftDialog({
  children,
  disabled,
  onClose,
  onSave,
  saveLabel = "Save",
  title,
}: {
  readonly children: React.ReactNode;
  readonly disabled: boolean;
  readonly onClose: () => void;
  readonly onSave: () => Promise<void>;
  readonly saveLabel?: string;
  readonly title: string;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">{children}</div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={disabled || saving}
            onClick={() => {
              setSaving(true);
              void onSave().finally(() => setSaving(false));
            }}
            size="sm"
          >
            {saving ? "Working" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
