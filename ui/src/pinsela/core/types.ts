export type PinselaNodeKind = "frame" | "group" | "rect" | "text" | "image" | "line" | "path";

export type PinselaTextModel = "legacy" | "rich";

export type PinselaPoint = {
  x: number;
  y: number;
};

export type PinselaGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  corner_radius: number;
  clip: boolean;
  z_index: number;
  transform_matrix?: Record<string, number> | null;
};

export type PinselaLayout = {
  direction: "none" | "horizontal" | "vertical";
  gap: number;
  padding_top: number;
  padding_right: number;
  padding_bottom: number;
  padding_left: number;
  align_main: "start" | "center" | "end" | "space_between";
  align_cross: "start" | "center" | "end" | "stretch";
  sizing_mode: "fixed" | "hug" | "fill";
  wrap: boolean;
  wrap_mode?: "flow" | "grid";
  grid_columns?: number;
  grid_rows?: number;
};

export type PinselaConstraints = {
  x: "min" | "max" | "center" | "stretch" | "scale";
  y: "min" | "max" | "center" | "stretch" | "scale";
  width: "fixed" | "stretch" | "scale";
  height: "fixed" | "stretch" | "scale";
};

export type PinselaStyle = {
  visible: boolean;
  locked?: boolean;
  opacity: number;
  blend_mode: string;
  shape_type?: "rect" | "ellipse" | "polygon" | "star";
  shape_sides?: number;
  star_points?: number;
  star_inner_ratio?: number;
  fill?: any;
  strokes?: PinselaStrokeStackItem[] | null;
  stroke?: any;
  effects?: PinselaLayerEffect[];
  image_fit?: "fill" | "fit" | "crop";
  image_crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  image_duotone?: PinselaImageDuotoneSettings | null;
  image_fade?: PinselaImageFadeSettings | null;
  image_brush_settings?: PinselaImageBrushSettings | null;
  image_brush_strokes?: PinselaImageBrushStroke[] | null;
  mask?: boolean;
};

export type PinselaImageFadeSettings = {
  enabled?: boolean;
  /** Extra easing applied to every ramp, 0..1. */
  softness?: number;
  /** Directional fade: opaque until `start`, transparent at `end`, along `angle` deg. */
  linear?: { angle?: number; start?: number; end?: number } | null;
  /** Radial fade: sharp until `inner` fraction of radius, transparent at `outer`. */
  radial?: { cx?: number; cy?: number; inner?: number; outer?: number } | null;
  /** Per-side fade depth (0..1 fraction of the box) from each edge inward. */
  edges?: { top?: number; right?: number; bottom?: number; left?: number };
};

export type PinselaStrokeAlign = "inside" | "center" | "outside";
export type PinselaStrokeDashStyle = "solid" | "dash" | "long_dash" | "dotted";
export type PinselaStrokeWidthProfile = "uniform" | "taper_start" | "taper_end" | "taper_both";
export type PinselaStrokeJoin = "miter" | "bevel" | "round";
export type PinselaStrokeCap = "round" | "butt" | "square";
export type PinselaStrokeAdvancedMode = "basic" | "dynamic" | "brush";
export type PinselaStrokeBrushPreset = "ink" | "marker" | "chalk" | "spray";

export type PinselaStrokeSides = {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
};

export type PinselaStrokeStackItem = {
  id: string;
  enabled?: boolean;
  visible?: boolean;
  color?: any;
  opacity?: number; // 0..100
  weight?: number; // px
  align?: PinselaStrokeAlign;
  style?: PinselaStrokeDashStyle;
  width_profile?: PinselaStrokeWidthProfile;
  width_profile_flip?: boolean;
  join?: PinselaStrokeJoin;
  cap?: PinselaStrokeCap;
  miter_limit?: number;
  mode?: PinselaStrokeAdvancedMode;
  dynamic_frequency?: number; // 0..100
  dynamic_movement?: number; // 0..100
  dynamic_smooth?: number; // 0..100
  brush_preset?: PinselaStrokeBrushPreset;
  brush_flip?: boolean;
  sides?: PinselaStrokeSides;
};

export type PinselaLayerEffectType =
  | "inner_shadow"
  | "drop_shadow"
  | "layer_blur"
  | "background_blur"
  | "noise"
  | "texture"
  | "glass";

export type PinselaLayerEffect = {
  id: string;
  type: PinselaLayerEffectType;
  enabled?: boolean;
  visible?: boolean;
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  radius?: number;
  amount?: number;
  scale?: number;
  opacity?: number; // 0..100
  saturation?: number; // 0..200
  noise?: number; // 0..100
  color?: any;
  tint?: any;
  show_behind_transparent?: boolean;
};

export type PinselaImageBrushMode = "shadow" | "erase";

export type PinselaImageBrushPoint = {
  u: number; // normalized local X inside image frame (0..1)
  v: number; // normalized local Y inside image frame (0..1)
};

export type PinselaImageBrushSettings = {
  size: number; // px
  opacity: number; // 0..100
  flow: number; // 0..100
  hardness: number; // 0..100
  accumulation: number; // 0..100
  spacing: number; // 1..100 (% of brush size)
  shape: number; // 1..100 (% roundness)
  rotation: number; // deg
  color?: any;
  mode?: PinselaImageBrushMode;
};

export type PinselaImageBrushStroke = {
  id: string;
  mode: PinselaImageBrushMode;
  color?: any;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  accumulation: number;
  spacing: number;
  shape: number;
  rotation: number;
  points: PinselaImageBrushPoint[];
};

export type PinselaImageDuotoneSettings = {
  enabled?: boolean;
  shadows?: any;
  highlights?: any;
  amount?: number; // 0..100
};

export type PinselaTextStyle = {
  family?: string | null;
  postscript?: string | null;
  style?: string | null;
  size?: number | null;
  line_height?: number | null;
  line_height_unit?: "px" | "percent";
  letter_spacing?: number | null;
  text_align?: "left" | "center" | "right" | "justify";
  vertical_align?: "top" | "center" | "bottom";
  underline?: boolean;
  color?: any;
};

export type PinselaTextPath = {
  type: "arc" | "bezier";
  radius?: number;
  start_angle?: number;
  sweep_angle?: number;
  clockwise?: boolean;
  start_offset?: number;
  reverse?: boolean;
  anchor?: "start" | "center" | "end";
  baseline_shift?: number;
  points?: PinselaPoint[];
};

export type PinselaPathPoint = {
  x: number;
  y: number;
  in?: PinselaPoint | null;
  out?: PinselaPoint | null;
  mode?: "corner" | "smooth";
};

export type PinselaPathFillRule = "nonzero" | "evenodd";

export type PinselaPathSubpath = {
  closed?: boolean;
  points: PinselaPathPoint[];
};

export type PinselaPathData = {
  closed?: boolean;
  points: PinselaPathPoint[];
  subpaths?: PinselaPathSubpath[];
  fill_rule?: PinselaPathFillRule;
};

export type PinselaTextRun = {
  start: number;
  end: number;
  style: Partial<PinselaTextStyle>;
};

export type PinselaComponentDefinition = {
  id: string;
  name: string;
  source_node_ids: string[];
  created_at?: string | null;
};

export type PinselaComponentInstance = {
  component_id: string;
  source_node_id: string;
  override_keys: string[];
};

export type PinselaNode = {
  id: string;
  parent_id: string | null;
  children_ids: string[];
  name: string;
  kind: PinselaNodeKind;
  geometry: PinselaGeometry;
  layout: PinselaLayout;
  constraints: PinselaConstraints;
  style: PinselaStyle;
  text?: string | null;
  text_model?: PinselaTextModel;
  text_style?: PinselaTextStyle;
  text_runs?: PinselaTextRun[];
  text_path?: PinselaTextPath | null;
  fit?: PinselaTextFitRule | null;
  path_data?: PinselaPathData | null;
  image_src?: string | null;
  image_asset_id?: string | null;
  editable?: boolean;
  component_instance?: PinselaComponentInstance | null;
};

export type PinselaTextFitRule = {
  start_size?: number | null;
  min_size?: number | null;
  max_lines?: number | null;
  min_lines?: number | null;
  truncate_mode?: "none" | "cut" | "ellipsis";
};

export type PinselaTextBinding = {
  node_id: string;
  required?: boolean;
  max_length?: number;
  fit?: PinselaTextFitRule;
  font?: PinselaTextStyle;
  label?: string;
};

export type PinselaImageBindingSingle = {
  node_id: string;
  required?: boolean;
  label?: string;
};

export type PinselaImageBindingArray = {
  node_ids: string[];
  required?: boolean;
  hide_empty?: boolean;
  per_product_input?: boolean;
  slot_product_index_map?: number[];
  label?: string;
};

export type PinselaBindings = {
  text: Record<string, PinselaTextBinding>;
  images_single: Record<string, PinselaImageBindingSingle>;
  images_array: Record<string, PinselaImageBindingArray>;
  product_frames?: { node_ids: string[]; hide_empty?: boolean } | null;
};

export type PinselaDynamicRule = {
  id: string;
  type:
    | "product_visibility_reflow"
    | "auto_layout_reflow"
    | "hide_when_empty"
    | "collapse_spacing_when_hidden"
    | "auto_layout_content_limit";
  container_id?: string | null;
  item_ids?: string[];
  gap?: number;
  align?: "start" | "center" | "end";
  preserve_order?: boolean;
  binding_key?: string | null;
  recenter_on_children_visible?: boolean;
  reflow_direction?: "vertical" | "horizontal";
  collapse_spacing_when_hidden?: boolean;
  enabled?: boolean;
  max_chars?: number;
  start_font_size?: number;
  min_font_size?: number;
  shrink_step?: number;
  truncate_mode?: "none" | "cut" | "ellipsis";
};

export type PinselaTemplateDocV1 = {
  version: 1;
  template_kind?: string | null;
  canvas: {
    width: number;
    height: number;
    background?: unknown | null;
  };
  root_id: string;
  nodes: PinselaNode[];
  bindings: PinselaBindings;
  dynamic_rules: PinselaDynamicRule[];
  metadata?: {
    source?: string;
    components?: {
      definitions?: PinselaComponentDefinition[];
    };
    [key: string]: any;
  };
};
