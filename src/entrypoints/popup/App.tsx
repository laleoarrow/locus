import { useEffect, useState } from 'react';
import { originPattern } from '@/domain/url';
import { requestBg } from '@/messaging/protocol';

interface TabInfo {
  tabId: number | null;
  origin: string | null;
}

function useActiveTab(): TabInfo | null {
  const [info, setInfo] = useState<TabInfo | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      let origin: string | null = null;
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
        } catch {
          origin = null;
        }
      }
      setInfo({ tabId: tab?.id ?? null, origin });
    });
  }, []);
  return info;
}

export function App() {
  const tab = useActiveTab();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tab?.origin) return;
    void chrome.permissions
      .contains({ origins: [originPattern(tab.origin)] })
      .then(setGranted);
  }, [tab?.origin]);

  const enable = async () => {
    if (!tab?.origin) return;
    setBusy(true);
    try {
      // permissions.request must run here: it needs the popup's user gesture.
      const ok = await chrome.permissions.request({ origins: [originPattern(tab.origin)] });
      if (ok) {
        await requestBg({ type: 'site:enable', origin: tab.origin, tabId: tab.tabId ?? undefined });
        setGranted(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!tab?.origin) return;
    setBusy(true);
    try {
      await chrome.permissions.remove({ origins: [originPattern(tab.origin)] });
      setGranted(false);
    } finally {
      setBusy(false);
    }
  };

  const openSidePanel = async () => {
    if (tab?.tabId) {
      await chrome.sidePanel.open({ tabId: tab.tabId });
      window.close();
    }
  };

  return (
    <div className="popup">
      <h1>Locus · 文迹</h1>
      <p className="tagline">Local-first annotations for academic reading.</p>
      {tab?.origin ? (
        <>
          <div className="origin">{tab.origin}</div>
          {granted ? (
            <>
              <button className="action" onClick={() => void disable()} disabled={busy}>
                Disable on this site
              </button>
              <p className="hint">Select text on the page to highlight it.</p>
            </>
          ) : (
            <button className="action primary" onClick={() => void enable()} disabled={busy}>
              Enable on this site
            </button>
          )}
          <button className="action" onClick={() => void openSidePanel()}>
            Open annotation panel
          </button>
        </>
      ) : (
        <p className="hint">This page cannot be annotated.</p>
      )}
    </div>
  );
}
