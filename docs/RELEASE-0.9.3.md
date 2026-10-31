# Locus / 文迹 0.9.3

## Summaries that compress your notes

- The default prompt now goes straight to the main point: one sentence for short material, or at most three brief points for longer notes.
- Removes introductions, repeated quotations and generic explanations about missing information. Key numbers, negations and uncertainty remain part of the summary.
- Each request targets roughly half the source length, up to 200 characters. Generated text cannot exceed the combined length of the supplied quotes and notes; titles and page URLs do not increase that allowance.
- Overlong responses are rejected without truncation, repeated API calls or replacing a saved summary. Manual edits remain unrestricted by this generation limit.
- An unchanged old default automatically uses the new prompt. Custom prompts, API settings and saved summaries are preserved.

Includes scheduled sync and the compact connection panel from 0.9.2. Update the existing extension in place to retain your library and settings.

## Validation

TypeScript checks, 287 unit tests and all 70 browser cases passed. Tests cover short and note-only inputs, title/URL exclusion, Unicode/whitespace counting, exact length boundaries, custom prompt preservation and overlong replies leaving existing summaries untouched. Chrome/Edge packages and the production Edge store package were verified.
