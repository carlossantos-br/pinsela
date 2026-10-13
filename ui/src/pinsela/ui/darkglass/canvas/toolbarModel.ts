import type { SelectionSummary } from "./selectionSummary";

export type ToolbarCanvasMode =
  | "select"
  | "text_edit"
  | "crop"
  | "path_edit"
  | "transform"
  | "pan"
  | "view_only";

export type ToolbarActionId =
  | "tool_select"
  | "tool_pan"
  | "toggle_snap"
  | "toggle_grid"
  | "zoom_menu"
  | "fit_view"
  | "reset_zoom"
  | "group"
  | "ungroup"
  | "toggle_lock"
  | "toggle_visibility"
  | "edit_menu"
  | "arrange_backward"
  | "arrange_forward"
  | "arrange_back"
  | "arrange_front"
  | "align_left"
  | "align_center"
  | "align_right"
  | "align_justify"
  | "align_top"
  | "align_middle"
  | "align_bottom"
  | "distribute_h"
  | "distribute_v"
  | "shape_fill"
  | "shape_stroke"
  | "artboard_fill"
  | "shape_radius"
  | "shape_sides"
  | "shape_points"
  | "line_color"
  | "line_weight"
  | "line_style"
  | "line_opacity"
  | "element_opacity"
  | "text_font"
  | "text_fit_mode"
  | "text_align_menu"
  | "text_spacing_menu"
  | "text_path_menu"
  | "text_size"
  | "text_color"
  | "text_bold"
  | "text_italic"
  | "text_underline"
  | "text_line_height"
  | "text_tracking"
  | "text_path_toggle"
  | "convert_to_curves"
  | "image_fit"
  | "image_fill"
  | "image_crop"
  | "image_remove_background"
  | "image_duotone"
  | "image_fade"
  | "image_brush"
  | "image_trace"
  | "vectorize_image"
  | "perspective_warp"
  | "effects_menu"
  | "image_replace"
  | "component_go_source"
  | "component_sync"
  | "component_merge"
  | "component_reset"
  | "component_highlight"
  | "style_menu"
  | "text_style_menu"
  | "images_menu"
  | "mode_confirm"
  | "mode_cancel"
  | "mode_reset_crop"
  | "path_exit"
  | "path_reset"
  | "path_add"
  | "path_remove"
  | "path_smooth"
  | "path_corner"
  | "path_radius"
  | "path_start_angle"
  | "path_sweep_angle"
  | "text_exit";

export interface ToolbarAction {
  id: ToolbarActionId;
  disabled?: boolean;
}

export interface ToolbarGroup {
  id: "GroupActions" | "ArrangeActions" | "AlignDistributeActions" | "TypeSpecificQuickActions" | "ModeActions";
  actions: ToolbarAction[];
}

export interface ToolbarModel {
  groups: ToolbarGroup[];
}

interface BuildToolbarModelParams {
  canvasMode: ToolbarCanvasMode;
  selection: SelectionSummary;
}

const GROUP_DEFAULT: ToolbarAction[] = [
  { id: "group" },
  { id: "ungroup" },
];

const ARRANGE_DEFAULT: ToolbarAction[] = [
  { id: "arrange_backward" },
  { id: "arrange_forward" },
  { id: "arrange_back" },
  { id: "arrange_front" },
];

const ALIGN_DEFAULT: ToolbarAction[] = [
  { id: "align_left" },
  { id: "align_center" },
  { id: "align_right" },
  { id: "align_top" },
  { id: "align_middle" },
  { id: "align_bottom" },
  { id: "distribute_h" },
  { id: "distribute_v" },
];

function withDistributeDisabled(actions: ToolbarAction[], disabled: boolean): ToolbarAction[] {
  return actions.map((action) => {
    if (action.id === "distribute_h" || action.id === "distribute_v") {
      return { ...action, disabled };
    }
    return action;
  });
}

function pushIfAny(groups: ToolbarGroup[], group: ToolbarGroup) {
  if (group.actions.length > 0) groups.push(group);
}

function resolveToolbarShapeType(selection: SelectionSummary): SelectionSummary["shapeType"] {
  if (selection.shapeType) return selection.shapeType;
  if (selection.primaryType === "line") return "line";
  if (selection.primaryType === "path") return "path";
  if (selection.primaryType === "rect") return "rect";
  return undefined;
}

export function buildToolbarModel({ canvasMode, selection }: BuildToolbarModelParams): ToolbarModel {
  if (canvasMode === "view_only") {
    return {
      groups: [
        {
          id: "ModeActions",
          actions: [{ id: "fit_view" }, { id: "reset_zoom" }],
        },
      ],
    };
  }

  if (selection.kind === "none") {
    if (canvasMode === "select" || canvasMode === "pan" || canvasMode === "transform") {
      return {
        groups: [
          { id: "ModeActions", actions: [{ id: "tool_select" }, { id: "artboard_fill" }] },
        ],
      };
    }
    if (canvasMode === "text_edit") {
      return {
        groups: [
          {
            id: "TypeSpecificQuickActions",
            actions: [{ id: "text_font" }, { id: "text_fit_mode" }, { id: "text_size" }, { id: "text_color" }, { id: "text_bold" }, { id: "text_italic" }, { id: "text_underline" }, { id: "text_align_menu" }, { id: "text_spacing_menu" }],
          },
          { id: "ModeActions", actions: [{ id: "text_exit" }] },
        ],
      };
    }
    if (canvasMode === "path_edit") {
      const pathModeActions: ToolbarAction[] = [
        { id: "path_exit" },
        { id: "path_reset" },
        { id: "path_add" },
        { id: "path_remove" },
        { id: "path_smooth" },
        { id: "path_corner" },
      ];
      return {
        groups: [
          {
            id: "ModeActions",
            actions: pathModeActions,
          },
        ],
      };
    }
    if (canvasMode === "crop") {
      return {
        groups: [
          {
            id: "ModeActions",
            actions: [{ id: "mode_confirm" }, { id: "mode_cancel" }, { id: "mode_reset_crop" }],
          },
        ],
      };
    }
    return { groups: [] };
  }

  const groups: ToolbarGroup[] = [];
  const disableDistribute = selection.count <= 1;
  const isVirtualSelection = selection.count > 0 && selection.selectedIds.length === 0;
  const shapeType = resolveToolbarShapeType(selection);

  const toContextGroupActions = (actions: ToolbarAction[]): ToolbarAction[] =>
    actions
      .filter((action) => {
        if (action.id === "group") {
          return selection.count >= 2;
        }
        if (action.id === "ungroup") {
          return selection.kind === "single_group";
        }
        return true;
      });

  const addUniversal = (_opts?: { hideGroup?: boolean; alignFirst?: boolean; groupActions?: ToolbarAction[] }) => {
    if (_opts?.hideGroup) return;
    const sourceActions = _opts?.groupActions || GROUP_DEFAULT;
    pushIfAny(groups, {
      id: "GroupActions",
      actions: toContextGroupActions(sourceActions),
    });
    // Surface align/distribute on any multi-object selection (Canva parity).
    // The handlers + ContextToolbar icons/labels already exist; this group was
    // simply never emitted before. Distribute needs 3+ objects.
    if (selection.count >= 2) {
      pushIfAny(groups, {
        id: "AlignDistributeActions",
        actions: withDistributeDisabled(ALIGN_DEFAULT, selection.count < 3),
      });
    }
    void disableDistribute;
  };

  switch (selection.kind) {
    case "single_shape":
      if (!isVirtualSelection) {
        addUniversal({ groupActions: withDistributeDisabled(GROUP_DEFAULT, selection.count <= 1) });
      }
      if (shapeType === "line") {
        pushIfAny(groups, {
          id: "TypeSpecificQuickActions",
          actions: [
            { id: "line_color" },
            { id: "line_weight" },
            { id: "line_style" },
            { id: "element_opacity" },
            { id: "convert_to_curves" },
          ],
        });
        break;
      }
      if (shapeType === "path") {
        pushIfAny(groups, {
          id: "TypeSpecificQuickActions",
          actions: [{ id: "shape_fill" }, { id: "shape_stroke" }, { id: "element_opacity" }],
        });
        break;
      }
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [
          { id: "shape_fill" },
          { id: "shape_stroke" },
          ...(shapeType === "polygon" ? [{ id: "shape_sides" } as const] : []),
          ...(shapeType === "star" ? [{ id: "shape_points" } as const] : []),
          { id: "shape_radius" },
          { id: "element_opacity" },
          { id: "edit_menu" },
          ...(selection.primaryType === "path" ? [] : [{ id: "convert_to_curves" } as const]),
        ],
      });
      break;

    case "single_frame":
      if (!isVirtualSelection) {
        addUniversal({ groupActions: withDistributeDisabled(GROUP_DEFAULT, selection.count <= 1) });
      }
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: isVirtualSelection
          ? [{ id: "shape_radius" }, { id: "element_opacity" }]
          : [{ id: "shape_radius" }, { id: "element_opacity" }, { id: "image_fit" }, { id: "image_fill" }, { id: "edit_menu" }],
      });
      break;

    case "single_group":
      addUniversal({ groupActions: [{ id: "ungroup" }] });
      if (selection.primaryType === "line") {
        pushIfAny(groups, {
          id: "TypeSpecificQuickActions",
          actions: [{ id: "element_opacity" }, { id: "convert_to_curves" }],
        });
        break;
      }
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [{ id: "shape_fill" }, { id: "shape_radius" }, { id: "element_opacity" }, { id: "edit_menu" }],
      });
      break;

    case "single_text":
      if (!isVirtualSelection) {
        addUniversal({ groupActions: withDistributeDisabled(GROUP_DEFAULT, selection.count <= 1) });
      }
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [
          { id: "text_font" },
          { id: "text_fit_mode" },
          { id: "text_size" },
          { id: "text_color" },
          { id: "element_opacity" },
          { id: "text_bold" },
          { id: "text_italic" },
          { id: "text_underline" },
          { id: "text_align_menu" },
          { id: "text_spacing_menu" },
          { id: "text_path_menu" },
          { id: "convert_to_curves" },
        ],
      });
      break;

    case "single_image":
      if (!isVirtualSelection) {
        addUniversal({ groupActions: withDistributeDisabled(GROUP_DEFAULT, selection.count <= 1) });
      }
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [
          { id: "shape_radius" },
          { id: "image_fit" },
          { id: "image_fill" },
          { id: "element_opacity" },
          { id: "image_crop" },
          { id: "image_remove_background" },
          { id: "edit_menu" },
          { id: "image_replace" },
        ],
      });
      break;

    case "single_component_instance":
      addUniversal({ groupActions: [] });
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [
          { id: "component_go_source" },
          { id: "component_sync" },
          { id: "component_merge" },
          { id: "component_reset" },
          { id: "component_highlight" },
          { id: "element_opacity" },
        ],
      });
      break;

    case "multi_homogeneous_shape":
      addUniversal({ alignFirst: true });
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [
          ...(shapeType === "line" || shapeType === "path" ? [] : [{ id: "shape_radius" } as const]),
          { id: "edit_menu" },
          { id: "element_opacity" },
        ],
      });
      break;

    case "multi_homogeneous_text":
      addUniversal();
      pushIfAny(groups, { id: "TypeSpecificQuickActions", actions: [{ id: "text_fit_mode" }, { id: "edit_menu" }, { id: "element_opacity" }] });
      break;

    case "multi_homogeneous_image":
      addUniversal();
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [{ id: "shape_radius" }, { id: "image_fit" }, { id: "image_fill" }, { id: "edit_menu" }, { id: "element_opacity" }],
      });
      break;

    case "multi_mixed":
      addUniversal();
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [{ id: "edit_menu" }, { id: "element_opacity" }],
      });
      break;

    case "single_component_source":
      addUniversal();
      pushIfAny(groups, {
        id: "TypeSpecificQuickActions",
        actions: [{ id: "element_opacity" }],
      });
      break;

    default:
      break;
  }

  if (canvasMode === "crop") {
    pushIfAny(groups, {
      id: "ModeActions",
      actions: [{ id: "mode_confirm" }, { id: "mode_cancel" }, { id: "mode_reset_crop" }],
    });
  }

  if (canvasMode === "path_edit") {
    const pathModeActions: ToolbarAction[] = [
      { id: "path_exit" },
      { id: "path_reset" },
      { id: "path_add" },
      { id: "path_remove" },
      { id: "path_smooth" },
      { id: "path_corner" },
    ];
    if (selection.kind === "single_text") {
      pathModeActions.push({ id: "text_path_menu" });
    }
    pushIfAny(groups, {
      id: "ModeActions",
      actions: pathModeActions,
    });
  }

  if (canvasMode === "text_edit") {
    pushIfAny(groups, {
      id: "ModeActions",
      actions: [{ id: "text_exit" }],
    });
  }

  return { groups };
}
