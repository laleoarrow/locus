import { useEffect, useState } from 'react';
import { getPrefs } from '@/db/repo';
import type { Prefs, UpdateInfo } from '@/domain/types';
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
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [update, setUpdate] = useState<{ current: string; info: UpdateInfo | null; hasUpdate: boolean } | null>(null);

  useEffect(() => {
    void getPrefs().then(setPrefs);
    void requestBg({ type: 'update:status' }).then((status) => {
      if (status) setUpdate(status);
    });
  }, []);

  const disabled = !!(tab?.origin && prefs?.disabledSites.includes(tab.origin));

  const toggleSite = async () => {
    if (!tab?.origin) return;
    const result = await requestBg({
      type: 'prefs:toggle-site',
      origin: tab.origin,
      disabled: !disabled,
    });
    if (result) setPrefs(result.prefs);
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
      {update?.hasUpdate && update.info && (
        <button
          className="action update"
          onClick={() => void chrome.tabs.create({ url: update.info?.releaseUrl ?? '' })}
        >
          ↑ Update available: v{update.info.latestVersion} — download
        </button>
      )}
      {tab?.origin ? (
        <>
          <div className="origin">{tab.origin}</div>
          <button className={`action${disabled ? ' primary' : ''}`} onClick={() => void toggleSite()}>
            {disabled ? 'Enable on this site' : 'Disable on this site'}
          </button>
          {!disabled && <p className="hint">Select text on the page to highlight it.</p>}
          <button className="action" onClick={() => void openSidePanel()}>
            Open annotation panel
          </button>
        </>
      ) : (
        <p className="hint">This page cannot be annotated.</p>
      )}
      <p className="version">
        v{update?.current ?? chrome.runtime.getManifest().version}
        {update && !update.hasUpdate ? ' · up to date' : ''}
      </p>
    </div>
  );
}
