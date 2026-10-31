# Locus / 文迹 0.9.0

## Upload only what changed

- WebDAV sync now stores annotated pages separately, with a small index. Editing one page uploads that page and the index; unchanged checks make **zero upload requests**.
- Pages visited without annotations or saved main content are excluded from the sync payload. Deletion records, cleared summaries and anchors remain available so other devices cannot resurrect removed notes.
- Stable page identities and content hashes prevent visit timestamps, export timestamps or differences between local database IDs from causing uploads. Unchanged remote page files are reused from the local cache.
- Concurrent devices use conditional writes and merge conflicts before retrying. A failure before the index commit leaves the previous remote library intact; invalid page files or missing concurrency protection stop the write.

## See usage and failures clearly

- The connection panel shows the payload bytes sent during the last sync, including failed attempts. A no-change pass displays **0 B**. Provider quota accounting may differ from request-body bytes.
- Exhausted upload quota is reported as a quota problem. Automatic uploads pause instead of repeatedly sending the full library. Use an explicit sync retry after quota becomes available.
- WebDAV connection tests only read the server; they do not create folders or upload test files.

## Upgrade all syncing devices

This release introduces WebDAV sync format v4. **Update every device sharing the folder to 0.9.0 or later.** Older clients reject the new index rather than overwriting it. The first successful sync migrates the existing library after its new page files have been written, and retains the previous snapshot in the local transfer cache.

Manual JSON backups remain format v3 and continue importing v1/v2. Update the existing extension in place to retain its ID, annotations, API settings and WebDAV credentials.

Batch annotation editing, page-level main content, optional LLM organisation and the improved Auto toolbar positioning from 0.8 remain included.

## Validation

TypeScript checks, 257 unit tests and all 64 browser regression cases passed. The sync tests use a local WebDAV simulator with byte counters, quota failures and forced concurrent commits. They verify zero PUTs for unchanged data, one changed page plus the index for a note edit, safe migration, independent colour/note merges and pause/retry behaviour.
