import type { Initiative } from "@t3tools/contracts";
import { ChevronDownIcon, KanbanIcon, TargetIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { sidebarInitiativeRowId } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Opens the work board, and is the section's own tree row. */
export const SidebarInitiativesHeader = memo(function SidebarInitiativesHeader(props: {
  count: number;
  onOpenBoard: () => void;
}) {
  return (
    <li className="relative list-none">
      <button
        type="button"
        data-sidebar-row="initiatives"
        data-testid="sidebar-initiatives-header"
        onClick={props.onOpenBoard}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <KanbanIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          Initiatives
        </span>
        {props.count > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {props.count}
          </span>
        ) : null}
      </button>
    </li>
  );
});

/**
 * An Initiative's folder. Its threads are the ones its Tickets claim, so the row
 * stays even with none, where it is the way onto the board.
 */
export const SidebarInitiativeFolderHeader = memo(function SidebarInitiativeFolderHeader(props: {
  initiative: Initiative;
  collapsed: boolean;
  hiddenThreadCount: number;
  onToggle: (initiative: Initiative) => void;
  onOpenBoard: (initiative: Initiative) => void;
}) {
  const { initiative, collapsed } = props;
  const rowId = sidebarInitiativeRowId(initiative.id);
  return (
    <li
      data-testid="sidebar-initiative-folder"
      className="group/initiative-folder relative list-none"
    >
      <button
        type="button"
        data-sidebar-row={rowId}
        aria-expanded={!collapsed}
        onClick={() => props.onToggle(initiative)}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) ps-5 pe-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <TargetIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground/90">
          {initiative.title}
        </span>
        {collapsed && props.hiddenThreadCount > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/initiative-folder:invisible pointer-coarse:invisible">
            {props.hiddenThreadCount}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {/* Sits over the count, which hides on hover, and left of the chevron. */}
      <span className="absolute inset-y-0 right-6 flex items-center opacity-0 focus-within:opacity-100 group-hover/initiative-folder:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                data-sidebar-action-for={rowId}
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Open ${initiative.title} on the board`}
                onClick={() => props.onOpenBoard(initiative)}
              />
            }
          >
            <KanbanIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup>Open on the board</TooltipPopup>
        </Tooltip>
      </span>
    </li>
  );
});
