import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overlap — collision radar for parallel agent fleets",
  description:
    "Detects cross-session file overlap in Agent Orchestrator worktrees, advises merge order, and reports post-merge collisions. Deterministic git analysis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
