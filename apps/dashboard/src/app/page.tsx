import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top">
            Overlap
          </a>
          <div className="nav-links">
            <a href="#problem">Problem</a>
            <a href="#how">How it works</a>
            <a href="#radar">Live radar</a>
            <a href="https://github.com/subheeksh5599/overlap">GitHub</a>
            <a className="nav-cta" href="#radar">
              Open the radar
            </a>
          </div>
        </div>
      </nav>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <h1>Collision radar for parallel agent fleets.</h1>
            <p className="sub">
              Overlap watches every agent session running under Agent Orchestrator, computes
              what each worktree is changing, and flags two agents editing the same file
              before the merge breaks. Deterministic git analysis — no LLM in the core.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#radar">
                See the live radar
              </a>
              <a className="btn btn-secondary" href="https://github.com/subheeksh5599/overlap">
                Read the source
              </a>
            </div>
            <div className="proof-row">
              <div className="proof">
                <div className="num">3</div>
                <div className="label">parallel agents in one build</div>
              </div>
              <div className="proof">
                <div className="num">1</div>
                <div className="label">collision caught before merge</div>
              </div>
              <div className="proof">
                <div className="num">2</div>
                <div className="label">PRs merged, reviewer-confirmed</div>
              </div>
              <div className="proof">
                <div className="num">11/11</div>
                <div className="label">engine tests passing</div>
              </div>
            </div>
          </div>
        </section>

        <section id="problem">
          <div className="wrap">
            <div className="section-head">
              <p className="kicker">The problem</p>
              <h2>Parallel agents collide. You find out at merge time.</h2>
              <p>
                Agent Orchestrator gives every session an isolated worktree — but isolation
                at the branch level does not stop two agents editing the same file.
              </p>
            </div>
            <div className="problem-grid">
              <div className="problem-card">
                <h3>No visibility</h3>
                <p>Nothing tells you which sessions are touching the same paths until a PR arrives with a conflict.</p>
              </div>
              <div className="problem-card">
                <h3>Merge order matters</h3>
                <p>Merging the wrong PR first turns a clean sequence into a conflict cascade across every shared file.</p>
              </div>
              <div className="problem-card">
                <h3>No post-mortem</h3>
                <p>After a collision you cannot say which sessions collided, on what, or why — so the next plan repeats it.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="how">
          <div className="wrap">
            <div className="section-head">
              <p className="kicker">How it works</p>
              <h2>Read, diff, detect, plan.</h2>
            </div>
            <div className="steps">
              <div className="step">
                <div className="step-num">01</div>
                <h3>Read sessions</h3>
                <p>Pulls active sessions and projects from the AO daemon over loopback.</p>
                <span className="path">GET /api/v1/sessions?active=true</span>
              </div>
              <div className="step">
                <div className="step-num">02</div>
                <h3>Diff worktrees</h3>
                <p>Computes each session's changed-file set against the merge base — committed and uncommitted.</p>
                <span className="path">~/.ao/data/worktrees/&lt;project&gt;/&lt;session&gt;</span>
              </div>
              <div className="step">
                <div className="step-num">03</div>
                <h3>Detect overlap</h3>
                <p>Same file = high, same directory = medium, same module = low. Deterministic rules, stable ordering.</p>
                <span className="path">engine.detectOverlaps()</span>
              </div>
              <div className="step">
                <div className="step-num">04</div>
                <h3>Plan merge order</h3>
                <p>Orders the ready PRs so shared-file merges happen last, minimizing live conflicts.</p>
                <span className="path">engine.planMergeOrder()</span>
              </div>
            </div>
          </div>
        </section>

        <section className="radar-section" id="radar">
          <div className="wrap">
            <span className="live-tag">
              <span className="dot" aria-hidden="true" /> Live — reads the AO daemon on this machine
            </span>
            <div className="section-head">
              <p className="kicker">The radar</p>
              <h2>Sessions, file sets, alerts, merge order.</h2>
            </div>
            <Dashboard />
            <p className="note">
              <strong>Honest by design:</strong> the radar renders only real daemon state. When the
              daemon is unreachable it says so — it never fabricates sessions or alerts. The core is
              deterministic git analysis; no LLM runs anywhere in the pipeline.
            </p>
          </div>
        </section>

        <section>
          <div className="wrap">
            <div className="section-head">
              <p className="kicker">Built with Agent Orchestrator</p>
              <h2>Three parallel sessions built this, on this machine.</h2>
            </div>
            <div className="steps">
              <div className="step">
                <div className="step-num">01</div>
                <h3>engine-cli</h3>
                <p>Added the report command. Its PR merged first, per the radar's advised order.</p>
              </div>
              <div className="step">
                <div className="step-num">02</div>
                <h3>dash-json</h3>
                <p>Added --json output and merge-order context. Its PR collided on the same file — exactly as predicted.</p>
              </div>
              <div className="step">
                <div className="step-num">03</div>
                <h3>reviewer</h3>
                <p>Reviewed both PRs and independently confirmed the collision the radar flagged.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span>Overlap — Apache-2.0. Built for The Orchestra, Agent Orchestrator's first online hackathon.</span>
          <a href="https://github.com/subheeksh5599/overlap">github.com/subheeksh5599/overlap</a>
        </div>
      </footer>
    </>
  );
}
