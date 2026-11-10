import type { EnvironmentId, ThreadTodo } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
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
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Opens straight away and fills in when the writer returns, so a slow or failed
 * model still leaves an editable draft rather than a dead button.
 */
export function ThreadTodoTicketDialog({
  environmentId,
  todo,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly todo: ThreadTodo;
  readonly onClose: () => void;
}) {
  const draftTicket = useAtomCommand(serverEnvironment.draftThreadTodoTicket, {
    label: "todo draft issue",
  });
  const createTicket = useAtomCommand(serverEnvironment.createThreadTodoTicket, {
    label: "todo create issue",
  });
  const [title, setTitle] = useState(todo.text);
  const [description, setDescription] = useState("");
  const [initiativeTitle, setInitiativeTitle] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // useAtomCommand returns a fresh closure each render, so the call cannot be a dependency:
  // it would spend a model call on every re-render.
  const runDraft = useEffectEvent(
    (apply: (result: Awaited<ReturnType<typeof draftTicket>>) => void) =>
      void draftTicket({ environmentId, input: { id: todo.id } }).then(apply),
  );

  // Drafting runs a model on the server; the dialog cannot derive it in render.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the one-shot issue writer once when the dialog opens
  useEffect(() => {
    let cancelled = false;
    runDraft((result) => {
      if (cancelled) return;
      setDrafting(false);
      if (result._tag !== "Success") {
        setError("Could not write the issue. Edit it here, or change the model.");
        return;
      }
      setTitle(result.value.title);
      setDescription(result.value.description);
      setInitiativeTitle(result.value.initiativeTitle);
      setError(result.value.generationError);
    });
    return () => {
      cancelled = true;
    };
    // The dialog mounts per todo and unmounts on close, so this runs exactly once.
  }, []);

  const save = async () => {
    setSaving(true);
    const result = await createTicket({
      environmentId,
      input: { id: todo.id, title: title.trim(), description },
    });
    setSaving(false);
    if (result._tag !== "Success") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not create issue",
          description: String(result),
        }),
      );
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            {initiativeTitle === null ? null : (
              <p className="text-xs text-muted-foreground">Files into {initiativeTitle}.</p>
            )}
            {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
            <Label htmlFor="todo-issue-title">Title</Label>
            <Input
              id="todo-issue-title"
              value={title}
              disabled={drafting}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Label htmlFor="todo-issue-description">Description</Label>
            <Textarea
              id="todo-issue-description"
              value={description}
              rows={10}
              disabled={drafting}
              placeholder={drafting ? "Writing the issue from this thread…" : ""}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" variant="outline" />}>Cancel</DialogClose>
          <Button disabled={drafting || saving || title.trim() === ""} onClick={save} size="sm">
            {saving ? "Working" : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
