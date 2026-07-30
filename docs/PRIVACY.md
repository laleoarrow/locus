# Privacy Policy — Locus / 文迹

_Last updated: 2026-07-30_

## Short version

Locus has no server and no account system. Your annotations are stored in your
own browser. Nothing about the pages you read is sent anywhere.

## What Locus stores, and where

Highlights, notes, colours and preferences are written to your browser's local
IndexedDB database, on your device. Locus reads page text only to work out where
a highlight belongs, and that text never leaves the browser except as part of
your own annotation (the highlighted phrase and a short surrounding snippet are
saved locally so the highlight can be found again after the page changes).

## Data we collect

**None.** There is no analytics, no telemetry, no crash reporting, no
advertising or tracking of any kind, and no identifier of you or your device is
created or transmitted.

## The only two network features, both optional and off by default

**WebDAV sync.** If you enter WebDAV credentials, Locus uploads and downloads a
single JSON file containing your annotations, to and from the server *you*
specify (for example Nutstore/坚果云 or your own Nextcloud). Locus is only the
client: the operator of that server is you or your chosen provider, and their
privacy terms apply to the stored file. Your credentials are kept in the
browser's local extension storage, are sent only to the server you configured,
and are deliberately excluded from exported backup files. Sync stops entirely
when you turn it off.

**Update check.** If enabled, Locus periodically requests public release
information from the GitHub API (`api.github.com`) to tell you when a newer
version is available. This request contains no information about you, your
browsing, or your annotations. GitHub will see the request as it would any
anonymous web request; see GitHub's privacy statement for their practices. This
can be switched off in the side panel.

## Data you export

The side panel can export your library to a JSON file that you choose where to
save. That file contains your annotations and preferences, and never your sync
credentials. What happens to it afterwards is up to you.

## Permissions

Locus requests access to web pages so that annotation can work on whichever
article you choose to read. You can disable Locus on any individual site, and
disabled sites are left completely untouched.

## Deleting your data

Removing the extension deletes its local database. Deleting the annotation file
from your WebDAV folder removes the synced copy. Exported backup files are yours
to delete.

## Contact

Questions or concerns: open an issue at
<https://github.com/laleoarrow/locus/issues>.
