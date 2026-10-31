# Privacy Policy — Locus / 文迹

_Last updated: 2026-10-31_

## Short version

Locus has no hosted server, account system or telemetry. Your annotations and
page summaries are stored in your own browser. Optional WebDAV sync sends your
library to storage you configure. Optional AI organisation sends the chosen
page's saved material to an API you configure only when you request generation.

## What Locus stores, and where

Highlights, annotation notes, page-level “主要内容” summaries, colours and
preferences are written to your browser's local IndexedDB database. The
highlighted phrase and a short surrounding snippet are saved so a highlight can
be found again after the page changes. AI connection settings and API keys,
like WebDAV credentials, are stored separately in local extension storage and
are excluded from library backups and sync.

## Data we collect

Locus operates no data-collection service. There is no analytics, telemetry,
crash reporting, advertising or tracking. The optional services described below
receive the requests you enable, under the terms of the provider you choose.

## Three optional, user-controlled network features

**WebDAV sync.** If you enter WebDAV credentials, Locus uploads and downloads a
single JSON file containing your annotations and saved page summaries, to and
from the server *you* specify (for example Nutstore/坚果云 or your own Nextcloud).
Locus is only the
client: the operator of that server is you or your chosen provider, and their
privacy terms apply to the stored file. Your credentials are kept in the
browser's local extension storage, are sent only to the server you configured,
and are deliberately excluded from exported backup files. Sync stops entirely
when you turn it off.

**Update check.** Locus enables update checking by default so sideloaded users
can learn when a newer version is available. It periodically requests public
release information from the GitHub API (`api.github.com`). This request
contains no information about you, your browsing, or your annotations. GitHub
will see the request as it would any anonymous web request; see GitHub's privacy
statement for their practices. Update checking can be switched off at any time
in the side panel.

**AI organisation.** This feature is off by default. You can configure an
OpenAI-compatible API address, model, API key and prompt. Enabling or saving
these settings does not generate a summary. When you explicitly request
generation, Locus sends the chosen page's title and URL, its live saved excerpts
and annotation notes, your prompt and model name to the configured API endpoint.
It does not fetch the full article for this request. Your API key authenticates
that request to the configured endpoint. Generated text is an editable draft;
it is stored as page content only after you save it. Your API provider's
processing, retention and billing terms apply. You can disable the feature or
clear the saved API key at any time.

## Data you export

The side panel can export your library to a JSON file that you choose where to
save. That file contains your annotations, saved page summaries and portable
preferences, and excludes sync credentials and AI API keys/configuration.
What happens to it afterwards is up to you.

## Permissions

Locus requests access to web pages so that annotation can work on whichever
article you choose to read. You can disable Locus on any individual site, and
disabled sites are left completely untouched.

## Deleting your data

Deleting annotations keeps local tombstones so the deletion can sync and be
undone. Clearing a page summary retains an empty record with its update time so
an older backup cannot restore its old text. Removing the extension deletes its
local database and settings. Deleting the library file from your WebDAV folder
removes the synced copy. Exported backup files are yours to delete.

## Contact

Questions or concerns: open an issue at
<https://github.com/laleoarrow/locus/issues>.
