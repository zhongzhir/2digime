import React, { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Stamp = {
  ok?: boolean;
  gitHead?: string | null;
  builtAt?: string;
  apiVersion?: number;
};

type EntryState = {
  preferredEntry?: string;
  effectiveEntry?: string;
  fallbackLatched?: boolean;
  navigationGeneration?: number;
};

type RuntimeFacade = {
  getStamp: () => Promise<Stamp>;
  getRendererEntry: () => Promise<{ ok: boolean } & EntryState>;
  requestRendererEntry: (entry: string, reason?: string) => Promise<{ ok: boolean; code?: string }>;
  signalReady: (generation?: number) => Promise<{ ok: boolean; code?: string }>;
  getBoundGeneration: () => Promise<{ ok: boolean; generation: number | null }>;
  failReadyEnabled?: boolean;
  injectErrorBoundary?: boolean;
};

declare global {
  interface Window {
    digitalMe?: {
      runtime?: RuntimeFacade;
      getRuntimeStamp?: () => Promise<Stamp>;
    };
  }
}

class ShellErrorBoundary extends Component<
  { children: ReactNode; injectFail?: boolean },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidMount() {
    if (this.props.injectFail) {
      this.setState({ error: new Error("injected_shell_error") });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="shell-error" data-testid="shell-error">
          <h1>界面暂时无法显示</h1>
          <p>请返回经典界面后重试。</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function PlaceholderShell() {
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [readyCode, setReadyCode] = useState<string>("pending");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const runtime = window.digitalMe?.runtime;
      if (!runtime) {
        setMessage("运行时接口不可用");
        return;
      }

      const stampResult = await runtime.getStamp();
      const entryResult = await runtime.getRendererEntry();
      if (cancelled) return;
      setStamp(stampResult || null);
      setEntry(entryResult || null);

      if (runtime.failReadyEnabled) {
        setReadyCode("fail_injected");
        return;
      }

      const bound = await runtime.getBoundGeneration();
      const generation = bound?.generation ?? undefined;
      const ready = await runtime.signalReady(generation ?? undefined);
      if (cancelled) return;
      setReadyCode(ready?.ok ? "ok" : ready?.code || "failed");
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onReturnLegacy() {
    const runtime = window.digitalMe?.runtime;
    if (!runtime) return;
    const result = await runtime.requestRendererEntry("legacy", "user_return");
    setMessage(result?.ok ? "正在返回经典界面" : `无法返回：${result?.code || "unknown"}`);
  }

  const stampText = stamp?.gitHead
    ? String(stamp.gitHead).slice(0, 12)
    : stamp?.builtAt
      ? String(stamp.builtAt)
      : "未提供";

  return (
    <div className="shell" data-testid="renderer-next-shell">
      <header className="shell-header">
        <div className="brand">Digital Me</div>
        <span className="status-tag" data-testid="capability-status">
          预览
        </span>
      </header>
      <main className="shell-main">
        <h1>界面预览</h1>
        <p className="lead">此页面用于验证新界面技术组合，不包含业务功能。</p>
        <dl className="meta" data-testid="runtime-stamp">
          <div>
            <dt>运行标识</dt>
            <dd data-testid="runtime-stamp-value">{stampText}</dd>
          </div>
          <div>
            <dt>当前入口</dt>
            <dd data-testid="effective-entry">{entry?.effectiveEntry || "—"}</dd>
          </div>
          <div>
            <dt>就绪状态</dt>
            <dd data-testid="ready-status">{readyCode}</dd>
          </div>
        </dl>
        {message ? <p className="message">{message}</p> : null}
        <button type="button" data-testid="return-legacy" onClick={() => void onReturnLegacy()}>
          返回经典界面
        </button>
      </main>
    </div>
  );
}

export function AppShell() {
  const injectFail = Boolean(window.digitalMe?.runtime?.injectErrorBoundary);
  return (
    <ShellErrorBoundary injectFail={injectFail}>
      <PlaceholderShell />
    </ShellErrorBoundary>
  );
}
