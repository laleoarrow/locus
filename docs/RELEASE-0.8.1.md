# Locus / 文迹 0.8.1

## Connection status at a glance

- The Library now shows compact LLM and cloud-sync status lights inspired by Wattson. Text labels distinguish unconfigured, disabled, untested, checking, verified and failed states; a configured service is never presented as verified automatically.
- Open the status panel to see the most recent verification time, configure either service, test the connection or run WebDAV sync. The last successful sync has its own timestamp, separate from a connection check.
- LLM connection tests use a small synthetic sample with the configured model and key. They do not send saved notes or the user's summary prompt. Normal generation also updates the last observed connection result.
- Results update across Library windows. Changing settings invalidates old verification; old responses cannot turn a new configuration green. Stale WebDAV settings forms cannot overwrite a newer configuration.

## Included from 0.8.0

Selected batch editing, editable page-level main content, optional LLM organisation with a customisable prompt, and improved Auto toolbar avoidance are all included. AI remains off by default; generation is requested explicitly and its draft is saved only after review.

Update the existing extension in place to preserve its ID and notes. Devices sharing a WebDAV library should all use 0.8.0 or later for backup format v3.

## Validation

TypeScript checks, 226 unit tests and all 59 browser regression cases passed. Chrome/Edge production archives and the keyless Edge store package passed manifest and archive checks. The production extension also verified a real local LLM service and WebDAV connection in an isolated browser profile; LLM testing used synthetic text, and WebDAV testing did not synchronise the library.
