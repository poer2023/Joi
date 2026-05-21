import "./globals.css";
import type { ReactNode } from "react";
import { AuthGate } from "./auth-gate";

export const metadata = {
  title: "Agent OS Console",
  description: "Local-first Personal Agent OS console"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="nav">
          <a href="/">Chat</a>
          <a href="/agents">Agents</a>
          <a href="/memories">Memories</a>
          <a href="/capabilities">Capabilities</a>
          <a href="/prompt-cache">Prompt Cache</a>
          <a href="/nodes">Nodes</a>
          <a href="/confirmations">Confirmations</a>
          <a href="/system-health">System Health</a>
        </nav>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
