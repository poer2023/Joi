"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const TOKEN_KEY = "joi_admin_token";

export function AuthGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY) ?? "";
    setToken(stored);
    setDraft(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const shouldAttach = url.startsWith(API_BASE) || url.startsWith("/api/");
      if (!shouldAttach) {
        return originalFetch(input, init);
      }
      const headers = new Headers(init.headers ?? {});
      headers.set("X-Admin-Token", token);
      return originalFetch(input, { ...init, headers });
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [ready, token]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    window.localStorage.setItem(TOKEN_KEY, value);
    setToken(value);
  }

  function clear() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setDraft("");
  }

  if (!ready) {
    return null;
  }

  if (!token) {
    return (
      <main className="authShell">
        <form className="authPanel" onSubmit={save}>
          <h1>Joi Console</h1>
          <p>输入 ADMIN_TOKEN 后继续访问管理页面。</p>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} type="password" placeholder="ADMIN_TOKEN" autoFocus />
          <button type="submit" disabled={!draft.trim()}>
            Continue
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="authBar">
        <span>Admin session active</span>
        <button type="button" onClick={clear}>
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}
