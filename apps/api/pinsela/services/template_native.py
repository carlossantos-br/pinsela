from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class NativeModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class NativeCanvas(NativeModel):
    width: int = Field(ge=64, le=8192)
    height: int = Field(ge=64, le=8192)
    background: Any | None = None


class NativeNodeGeometry(NativeModel):
    x: float = 0
    y: float = 0
    width: float = Field(default=0, ge=0)
    height: float = Field(default=0, ge=0)
    rotation: float = 0
    corner_radius: float = 0
    clip: bool = False
    z_index: int = 0
    transform_matrix: dict[str, float] | None = None


class NativeNodeLayout(NativeModel):
    direction: Literal["none", "horizontal", "vertical"] = "none"
    gap: float = 0
    padding_top: float = 0
    padding_right: float = 0
    padding_bottom: float = 0
    padding_left: float = 0
    align_main: Literal["start", "center", "end", "space_between"] = "start"
    align_cross: Literal["start", "center", "end", "stretch"] = "start"
    sizing_mode: Literal["fixed", "hug", "fill"] = "fixed"
    wrap: bool = False
    wrap_mode: Literal["flow", "grid"] | None = None
    grid_columns: int | None = None
    grid_rows: int | None = None


class NativeNodeConstraints(NativeModel):
    x: Literal["min", "max", "center", "stretch", "scale"] = "min"
    y: Literal["min", "max", "center", "stretch", "scale"] = "min"
    width: Literal["fixed", "stretch", "scale"] = "fixed"
    height: Literal["fixed", "stretch", "scale"] = "fixed"


class NativeNodeStyle(NativeModel):
    visible: bool = True
    locked: bool = False
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    blend_mode: str = "normal"
    shape_type: str | None = None
    shape_sides: int | None = None
    star_points: int | None = None
    star_inner_ratio: float | None = None
    fill: Any | None = None
    strokes: list[dict[str, Any]] | None = None
    stroke: Any | None = None
    effects: list[dict[str, Any]] = Field(default_factory=list)
    image_fit: Literal["fill", "fit", "crop"] = "fill"
    image_crop: dict[str, float] | None = None
    image_duotone: Any | None = None
    image_fade: Any | None = None
    image_brush_settings: Any | None = None
    image_brush_strokes: list[dict[str, Any]] | None = None
    image_trim: bool | None = None
    image_scale: float | None = None
    image_align_x: str | None = None
    image_align_y: str | None = None
    mask: bool = False


class NativeTextStyle(NativeModel):
    family: str | None = None
    postscript: str | None = None
    style: str | None = None
    size: float | None = None
    line_height: float | None = None
    line_height_unit: Literal["px", "percent"] = "percent"
    letter_spacing: float | None = None
    text_align: Literal["left", "center", "right", "justify"] = "left"
    vertical_align: Literal["top", "center", "bottom"] = "top"
    baseline_shift: float | None = None
    line_height_scale: float | None = None
    underline: bool | None = None
    color: Any | None = None


class NativeTextPath(NativeModel):
    type: Literal["arc", "bezier"] = "arc"
    radius: float | None = Field(default=None, gt=0)
    start_angle: float = -90
    sweep_angle: float = 180
    clockwise: bool = True
    start_offset: float = 0
    reverse: bool = False
    anchor: Literal["start", "center", "end"] = "start"
    baseline_shift: float = 0
    points: list[dict[str, float]] = Field(default_factory=list)


class NativeComponentInstance(NativeModel):
    component_id: str = Field(min_length=1, max_length=128)
    source_node_id: str = Field(min_length=1, max_length=128)
    override_keys: list[str] = Field(default_factory=list, max_length=64)


class NativeComponentDefinition(NativeModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=256)
    source_node_ids: list[str] = Field(default_factory=list, min_length=1, max_length=256)
    created_at: str | None = None


class NativeComponentsMetadata(NativeModel):
    definitions: list[NativeComponentDefinition] = Field(default_factory=list)


class NativeMetadata(NativeModel):
    source: str | None = None
    components: NativeComponentsMetadata = Field(default_factory=NativeComponentsMetadata)


class NativeNode(NativeModel):
    id: str = Field(min_length=1, max_length=128)
    parent_id: str | None = None
    children_ids: list[str] = Field(default_factory=list)
    name: str = Field(default="")
    kind: Literal["frame", "group", "rect", "text", "image", "line", "path"] = "group"
    geometry: NativeNodeGeometry = Field(default_factory=NativeNodeGeometry)
    layout: NativeNodeLayout = Field(default_factory=NativeNodeLayout)
    constraints: NativeNodeConstraints = Field(default_factory=NativeNodeConstraints)
    style: NativeNodeStyle = Field(default_factory=NativeNodeStyle)
    text: str | None = None
    text_style: NativeTextStyle = Field(default_factory=NativeTextStyle)
    text_runs: list[dict[str, Any]] = Field(default_factory=list)
    text_path: NativeTextPath | None = None
    path_data: dict[str, Any] | None = None
    image_src: str | None = None
    image_asset_id: str | None = None
    editable: bool = False
    component_instance: NativeComponentInstance | None = None


class NativeTextFitRule(NativeModel):
    start_size: float | None = None
    min_size: float | None = None
    max_lines: int | None = None
    min_lines: int | None = None
    truncate_mode: Literal["none", "cut", "ellipsis"] = "none"


class NativeTextBinding(NativeModel):
    node_id: str = Field(min_length=1, max_length=128)
    required: bool = False
    max_length: int | None = Field(default=None, ge=1, le=4000)
    fit: NativeTextFitRule = Field(default_factory=NativeTextFitRule)
    font: NativeTextStyle = Field(default_factory=NativeTextStyle)
    label: str | None = None


class NativeImageBindingSingle(NativeModel):
    node_id: str = Field(min_length=1, max_length=128)
    required: bool = False
    label: str | None = None


class NativeImageBindingArray(NativeModel):
    node_ids: list[str] = Field(default_factory=list, min_length=1, max_length=64)
    required: bool = False
    hide_empty: bool = True
    per_product_input: bool = False
    slot_product_index_map: list[int] = Field(default_factory=list)
    label: str | None = None


class NativeProductFramesBinding(NativeModel):
    node_ids: list[str] = Field(default_factory=list, min_length=1, max_length=128)
    hide_empty: bool = True


class NativeBindings(NativeModel):
    text: dict[str, NativeTextBinding] = Field(default_factory=dict)
    images_single: dict[str, NativeImageBindingSingle] = Field(default_factory=dict)
    images_array: dict[str, NativeImageBindingArray] = Field(default_factory=dict)
    product_frames: NativeProductFramesBinding | None = None


class NativeDynamicRule(NativeModel):
    id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=64)
    container_id: str | None = None
    item_ids: list[str] = Field(default_factory=list)
    gap: float = 0
    align: Literal["start", "center", "end"] = "center"
    preserve_order: bool = True
    binding_key: str | None = None
    recenter_on_children_visible: bool = True
    reflow_direction: Literal["vertical", "horizontal"] = "vertical"
    collapse_spacing_when_hidden: bool = True


class PinselaTemplateDocV1(NativeModel):
    version: Literal[1] = 1
    template_kind: str | None = None
    canvas: NativeCanvas
    root_id: str = Field(min_length=1, max_length=128)
    nodes: list[NativeNode] = Field(default_factory=list)
    bindings: NativeBindings = Field(default_factory=NativeBindings)
    dynamic_rules: list[NativeDynamicRule] = Field(default_factory=list)
    metadata: NativeMetadata = Field(default_factory=NativeMetadata)


def validate_native_doc(raw: dict[str, Any]) -> dict[str, Any]:
    doc = PinselaTemplateDocV1.model_validate(raw or {})
    node_ids = {n.id for n in doc.nodes}
    if doc.root_id not in node_ids:
        raise ValueError("invalid native doc: root_id not found in nodes.")
    for n in doc.nodes:
        if n.parent_id and n.parent_id not in node_ids:
            raise ValueError(f"invalid native doc: parent_id missing ({n.id} -> {n.parent_id}).")
        for c in n.children_ids:
            if c not in node_ids:
                raise ValueError(f"invalid native doc: children_ids missing ({n.id} -> {c}).")
    return doc.model_dump(mode="json")


def build_schema_from_native_doc(doc: dict[str, Any]) -> dict[str, Any]:
    raw_bindings = doc.get("bindings") if isinstance(doc.get("bindings"), dict) else {}
    text_bindings = raw_bindings.get("text") if isinstance(raw_bindings.get("text"), dict) else {}
    image_single = raw_bindings.get("images_single") if isinstance(raw_bindings.get("images_single"), dict) else {}
    image_array = raw_bindings.get("images_array") if isinstance(raw_bindings.get("images_array"), dict) else {}

    fields: dict[str, Any] = {}
    arrays: dict[str, Any] = {}
    content_fields: list[str] = []
    image_fields: list[str] = []
    image_arrays: list[str] = []

    for key, raw in text_bindings.items():
        if not isinstance(raw, dict):
            continue
        fit = raw.get("fit") if isinstance(raw.get("fit"), dict) else {}
        max_lines = fit.get("max_lines")
        widget = "textarea" if isinstance(max_lines, int) and max_lines >= 2 else "text"
        max_len = raw.get("max_length")
        spec: dict[str, Any] = {
            "type": "string",
            "required": bool(raw.get("required", False)),
            "label": str(raw.get("label") or key),
            "ui": {"widget": widget},
        }
        if isinstance(max_len, int) and max_len > 0:
            spec["maxLength"] = max_len
        fields[key] = spec
        content_fields.append(key)

    for key, raw in image_single.items():
        if not isinstance(raw, dict):
            continue
        fields[key] = {
            "type": "string",
            "required": bool(raw.get("required", False)),
            "label": str(raw.get("label") or key),
            "ui": {"widget": "image"},
        }
        image_fields.append(key)

    for key, raw in image_array.items():
        if not isinstance(raw, dict):
            continue
        node_ids = raw.get("node_ids") if isinstance(raw.get("node_ids"), list) else []
        max_items = len([x for x in node_ids if str(x).strip()])
        if max_items <= 0:
            continue
        arrays[key] = {
            "type": "image[]",
            "required": bool(raw.get("required", False)),
            "maxItems": max_items,
            "label": str(raw.get("label") or key),
            "ui": {"widget": "image"},
        }
        image_arrays.append(key)

    groups: list[dict[str, Any]] = []
    if content_fields:
        groups.append({"id": "content", "title": "Content", "fields": content_fields, "arrays": []})
    if image_fields or image_arrays:
        groups.append({"id": "images", "title": "Images", "fields": image_fields, "arrays": image_arrays})

    out: dict[str, Any] = {"version": 2, "fields": fields, "arrays": arrays}
    if groups:
        out["ui"] = {"groups": groups}
    return out


def build_mapping_from_native_doc(doc: dict[str, Any]) -> dict[str, Any]:
    raw_bindings = doc.get("bindings") if isinstance(doc.get("bindings"), dict) else {}
    text_bindings = raw_bindings.get("text") if isinstance(raw_bindings.get("text"), dict) else {}
    image_single = raw_bindings.get("images_single") if isinstance(raw_bindings.get("images_single"), dict) else {}
    image_array = raw_bindings.get("images_array") if isinstance(raw_bindings.get("images_array"), dict) else {}

    mapping: dict[str, Any] = {
        "template_kind": str(doc.get("template_kind") or "").strip().lower() or None,
        "engine_type": "pinsela_native_v1",
        "text_nodes": {},
        "text_rules": {},
    }
    if mapping["template_kind"] is None:
        mapping.pop("template_kind")

    for key, raw in text_bindings.items():
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("node_id") or "").strip()
        if not node_id:
            continue
        mapping["text_nodes"][key] = {"by": "node_id", "value": node_id}
        fit = raw.get("fit") if isinstance(raw.get("fit"), dict) else {}
        font = raw.get("font") if isinstance(raw.get("font"), dict) else {}
        text_rule: dict[str, Any] = {}
        for src, dst in (
            ("start_size", "start_size"),
            ("min_size", "min_size"),
            ("max_lines", "max_lines"),
            ("min_lines", "min_lines"),
            ("truncate_mode", "truncate_mode"),
        ):
            if src in fit:
                text_rule[dst] = fit[src]
        if font.get("family"):
            text_rule["font_family"] = font["family"]
        if font.get("style"):
            text_rule["font_style"] = font["style"]
        if font.get("postscript"):
            text_rule["font_postscript"] = font["postscript"]
        if text_rule:
            mapping["text_rules"][key] = text_rule

    for key, raw in image_single.items():
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("node_id") or "").strip()
        if not node_id:
            continue
        mapping[key] = {"by": "node_id", "value": node_id}

    for key, raw in image_array.items():
        if not isinstance(raw, dict):
            continue
        node_ids = [str(x).strip() for x in (raw.get("node_ids") or []) if str(x).strip()]
        if not node_ids:
            continue
        block = {
            "slots": [{"by": "node_id", "value": nid} for nid in node_ids],
            "hide_empty": bool(raw.get("hide_empty", True)),
            "per_product_input": bool(raw.get("per_product_input", False)),
        }
        slot_map = [int(x) for x in (raw.get("slot_product_index_map") or []) if str(x).strip().isdigit()]
        if slot_map and len(slot_map) == len(node_ids):
            block["slot_product_index_map"] = slot_map
        mapping[key] = block

    product_frames = raw_bindings.get("product_frames") if isinstance(raw_bindings.get("product_frames"), dict) else None
    if isinstance(product_frames, dict):
        node_ids = [str(x).strip() for x in (product_frames.get("node_ids") or []) if str(x).strip()]
        if node_ids:
            mapping["product_frames"] = {
                "slots": [{"by": "node_id", "value": nid} for nid in node_ids],
                "hide_empty": bool(product_frames.get("hide_empty", True)),
            }

    return mapping
