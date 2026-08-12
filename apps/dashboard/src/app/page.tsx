import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <main className="wrap">
      <section className="landing">
        <h1>Overlap</h1>
        <p className="tagline">Collision radar for parallel agent fleets.</p>
        <ul>
          <li>Detects cross-session file overlap in Agent Orchestrator worktrees before merge.</li>
          <li>Advises a merge order that minimizes shared-file conflicts.</li>
          <li>Reports which sessions collided and on what files after merges.</li>
        </ul>
        <p className="note">deterministic git analysis — no LLM in the core · reads the AO daemon at $AO_DAEMON_URL (default 127.0.0.1:3001)</p>
      </section>

      <Dashboard />
    </main>
  );
}
