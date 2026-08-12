"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiState {
  daemon: string;
  projects: { id: string; name: string; path: string }[];
  sessions: {
    sessionId: string;
    name: string;
    worktreeDir: string;
    branch: string;
    files: string[];
    harness?: string;
    status?: string;
  }[];
  alerts: {
    sessionIds: string[];
    file: string;
    severity: "high" | "medium" | "low";
    kind: string;
  }[];
  mergeOrder: string[];
  generatedAt: string;
  error: string | null;
}

const SEV_LABEL: Record<string, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const KIND_LABEL: Record<string, string> = {
  "same-file": "SAME FILE",
  "same-dir": "SAME DIRECTORY",
  "same-module": "SAME MODULE",
};

export default function Dashboard() {
  const [state, setState] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/state");
      const data = (await resp.json()) as ApiState;
      setState(data);
    } catch {
      setState({
        daemon: "",
        projects: [],
        sessions: [],
        alerts: [],
        mergeOrder: [],
        generatedAt: new Date().toISOString(),
        error: "failed to reach /api/state",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="dashboard">
      <h2>Radar</h2>
      <p className="meta">
        {state ? `daemon: ${state.daemon || "unset"}` : "loading..."} · generated at{" "}
        {state ? new Date(state.generatedAt).toLocaleTimeString() : "—"}
      </p>
      <div className="toolbar">
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "refreshing…" : "refresh"}
        </button>
        <span className="meta">
          {state ? `${state.sessions.length} active session(s) · ${state.projects.length} project(s)` : ""}
        </span>
      </div>

      {state?.error && <div className="error">daemon unreachable: {state.error}</div>}

      {state && !state.error && (
        <>
          <div className="card">
            <h3>Sessions</h3>
            {state.sessions.length === 0 ? (
              <p className="empty">No active sessions with worktrees.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>session</th>
                    <th>harness</th>
                    <th>status</th>
                    <th>branch</th>
                    <th>files</th>
                  </tr>
                </thead>
                <tbody>
                  {state.sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="mono">{s.sessionId}</div>
                      </td>
                      <td>{s.harness || "—"}</td>
                      <td>{s.status || "—"}</td>
                      <td className="mono">{s.branch}</td>
                      <td>
                        <div className="filelist">{s.files.length ? s.files.join("\n") : "(none)"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Overlap alerts</h3>
            {state.alerts.length === 0 ? (
              <p className="empty">No cross-session file overlap detected.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>severity</th>
                    <th>kind</th>
                    <th>file / dir / module</th>
                    <th>sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.alerts.map((a, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`badge ${a.severity}`}>{SEV_LABEL[a.severity]}</span>
                      </td>
                      <td>{KIND_LABEL[a.kind] || a.kind}</td>
                      <td className="mono">{a.file}</td>
                      <td className="mono">{a.sessionIds.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Suggested merge order</h3>
            {state.mergeOrder.length === 0 ? (
              <p className="empty">Need at least two sessions with worktrees to plan a merge order.</p>
            ) : (
              <ol className="order">
                {state.mergeOrder.map((sessionId, i) => {
                  const session = state.sessions.find((s) => s.sessionId === sessionId);
                  if (!session) {
                    return (
                      <li key={sessionId} className="mono">
                        {sessionId}
                      </li>
                    );
                  }
                  // Count files from this session that also appear in any later session
                  let sharedCount = 0;
                  for (let j = i + 1; j < state.mergeOrder.length; j++) {
                    const laterSession = state.sessions.find(
                      (s) => s.sessionId === state.mergeOrder[j],
                    );
                    if (!laterSession) continue;
                    const currentFileSet = new Set(session.files);
                    for (const f of laterSession.files) {
                      if (currentFileSet.has(f)) {
                        sharedCount++;
                        currentFileSet.delete(f);
                      }
                    }
                  }
                  return (
                    <li key={sessionId} className="mono">
                      {session.name} ({sharedCount} shared)
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
