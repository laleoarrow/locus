import type { APIRequestContext } from '@playwright/test';
import type { BackupFile } from '../src/domain/backup';

export const DAV_AUTH = { authorization: `Basic ${Buffer.from('tester:app-password').toString('base64')}` };

export interface RemoteManifest {
  format: 'locus-backup';
  formatVersion: 4;
  pages: Record<string, string>;
  settings: string;
}

export async function readRemoteManifest(request: APIRequestContext, baseUrl: string): Promise<RemoteManifest> {
  const response = await request.get(`${baseUrl}locus-library.json`, { headers: DAV_AUTH });
  if (!response.ok()) throw new Error(`Remote manifest HTTP ${response.status()}`);
  return response.json() as Promise<RemoteManifest>;
}

/** Read actual referenced files, never the engine's cached or in-memory view. */
export async function readRemoteLibrary(request: APIRequestContext, baseUrl: string): Promise<BackupFile> {
  const root = await request.get(`${baseUrl}locus-library.json`, { headers: DAV_AUTH });
  if (!root.ok()) throw new Error(`Remote library HTTP ${root.status()}`);
  const manifest = await root.json() as RemoteManifest | BackupFile;
  if (manifest.formatVersion !== 4) return manifest as BackupFile;
  const index = manifest as RemoteManifest;
  const paths = [
    ...new Set(Object.values(index.pages).map((hash) => `locus-v4/page-${hash}.json`)),
    `locus-v4/settings-${index.settings}.json`,
  ];
  const parts = await Promise.all(paths.map(async (path) => {
    const response = await request.get(`${baseUrl}${path}`, { headers: DAV_AUTH });
    if (!response.ok()) throw new Error(`Remote blob HTTP ${response.status()}: ${path}`);
    return response.json() as Promise<BackupFile>;
  }));
  return {
    format: 'locus-backup', formatVersion: 3, exportedAt: 0, appVersion: 'e2e-readback',
    documents: parts.flatMap((part) => part.documents),
    sources: parts.flatMap((part) => part.sources),
    annotations: parts.flatMap((part) => part.annotations),
    anchors: parts.flatMap((part) => part.anchors),
    settings: parts.flatMap((part) => part.settings),
    pageSummaries: parts.flatMap((part) => part.pageSummaries ?? []),
  };
}

export interface DavRequest {
  method: string;
  path: string;
  status: number;
  requestBytes: number;
  responseBytes: number;
  ifMatch: string;
  ifNoneMatch: string;
}

export async function davState(request: APIRequestContext, baseUrl: string): Promise<{
  requests: DavRequest[];
  uploadBytes: number;
  downloadBytes: number;
  files: Array<{ path: string; etag: string; bytes: number }>;
}> {
  const prefix = new URL(baseUrl).pathname;
  return (await request.get(`http://localhost:8137/__dav-state?prefix=${encodeURIComponent(prefix)}`)).json();
}
