import type { PinselaComponentDefinition, PinselaComponentInstance, PinselaNode, PinselaTemplateDocV1 } from "../../core/types";

export type ComponentsMetaState = {
  definitions: PinselaComponentDefinition[];
};

export function readComponentsMeta(doc: PinselaTemplateDocV1): ComponentsMetaState {
  const defsRaw = doc.metadata?.components?.definitions;
  if (!Array.isArray(defsRaw)) return { definitions: [] };
  const definitions = defsRaw
    .map((raw) => {
      const id = String(raw?.id || "").trim();
      if (!id) return null;
      const name = String(raw?.name || id).trim() || id;
      const source_node_ids = Array.isArray(raw?.source_node_ids)
        ? raw.source_node_ids.map((x: string) => String(x).trim()).filter(Boolean)
        : [];
      if (!source_node_ids.length) return null;
      const created_at = raw?.created_at ? String(raw.created_at) : null;
      return { id, name, source_node_ids, created_at };
    })
    .filter(Boolean) as PinselaComponentDefinition[];
  return { definitions };
}

export function writeComponentsMeta(doc: PinselaTemplateDocV1, defs: PinselaComponentDefinition[]): PinselaTemplateDocV1 {
  return {
    ...doc,
    metadata: {
      ...(doc.metadata || {}),
      components: {
        ...(doc.metadata?.components || {}),
        definitions: defs,
      },
    },
  };
}

export function mergeOverrideKeys(instance: PinselaComponentInstance | null | undefined, nextKeys: string[]): PinselaComponentInstance | null {
  if (!instance) return null;
  const merged = Array.from(new Set([...(instance.override_keys || []), ...nextKeys])).sort();
  return { ...instance, override_keys: merged };
}

export function detectOverrideKeys(before: PinselaNode, after: PinselaNode): string[] {
  const keys: Array<keyof PinselaNode> = [
    "name",
    "text",
    "text_style",
    "text_runs",
    "text_path",
    "fit",
    "path_data",
    "style",
    "layout",
    "constraints",
    "geometry",
    "image_src",
  ];
  const out: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out.push(String(key));
  }
  return out;
}
