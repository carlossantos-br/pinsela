// useLiveDoc (spec 2026-06-22 §5, Task 6): subscribes to the local SSE channel and
// notifies the editor when the live version of the open artwork changes (to
// reload + flash) and when the agent is working on it ("agent working" badge).
//
// Decoupled from the editor: takes the key and a callback; the editor decides how
// to reload/apply/flash. Auto-reconnects if the connection drops.
import { useEffect, useRef, useState } from "react";

import { API_BASE } from "../../../lib/api";

export interface LivePresence {
  state: "working";
  label: string | null;
}

interface LiveMessage {
  type?: string;
  key?: string;
  updated_at?: string;
  state?: string;
  label?: string | null;
  presence?: Record<string, { state?: string; label?: string | null }>;
}

export function useLiveDoc(
  projectKey: string | null | undefined,
  onRemoteChange: (updatedAt: string) => void,
): { presence: LivePresence | null } {
  const [presence, setPresence] = useState<LivePresence | null>(null);
  const cbRef = useRef(onRemoteChange);
  cbRef.current = onRemoteChange;

  useEffect(() => {
    if (!projectKey) {
      setPresence(null);
      return;
    }
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const applyPresence = (state: string | undefined, label: string | null | undefined) => {
      setPresence(state === "working" ? { state: "working", label: label ?? null } : null);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`${API_BASE}/agent/events`);
      es.onmessage = (ev) => {
        let msg: LiveMessage;
        try {
          msg = JSON.parse(ev.data) as LiveMessage;
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "doc-changed" && msg.key === projectKey) {
          cbRef.current(String(msg.updated_at || ""));
        } else if (msg.type === "presence" && msg.key === projectKey) {
          applyPresence(msg.state, msg.label);
        } else if (msg.type === "hello" && msg.presence) {
          const p = msg.presence[projectKey];
          if (p) applyPresence(p.state, p.label);
        }
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          retry = setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (es) es.close();
      setPresence(null);
    };
  }, [projectKey]);

  return { presence };
}
