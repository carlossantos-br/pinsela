import type { PinselaTemplateDocV1 } from "../core/types";
import {
  fetchNativeProjectByKey,
  fetchNativeProjectDraftByKey,
  publishNativeProjectByKey,
  saveNativeProjectDraftByKey,
} from "../platform/api/pinselaNativeApi";

export function createManagedProjectKey(): string {
  return `proj_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Creates a brand-new project from a doc (deep-cloned) and returns its key. */
export async function createProjectFromDoc(params: {
  name: string;
  doc: PinselaTemplateDocV1;
  source: string;
}): Promise<string> {
  const key = createManagedProjectKey();
  const doc = JSON.parse(JSON.stringify(params.doc)) as PinselaTemplateDocV1;
  await publishNativeProjectByKey(key, {
    project_name: params.name,
    doc_json: doc,
    preview_png_b64: "",
    source: params.source,
  });
  await saveNativeProjectDraftByKey(key, { doc_json: doc, source: params.source });
  return key;
}

export async function loadProjectDoc(projectKey: string): Promise<PinselaTemplateDocV1> {
  try {
    return (await fetchNativeProjectDraftByKey(projectKey)).doc_json;
  } catch {
    return (await fetchNativeProjectByKey(projectKey)).doc_json;
  }
}

/** "Use as template": duplicates a project into a NEW one (the original is never opened/edited). */
export async function duplicateProjectAsNew(projectKey: string, name: string): Promise<string> {
  const doc = await loadProjectDoc(projectKey);
  return createProjectFromDoc({ name, doc, source: `projects:template:${projectKey}` });
}
