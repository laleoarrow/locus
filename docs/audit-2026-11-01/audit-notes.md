# Headless baseline observations

Baseline: existing **0.9.6** E2E build, 1 November 2026. These are scratch observations for the main audit report, not a release acceptance statement.

The audit used explicitly headless Chromium with a new temporary extension profile per test. Pages were served only from `localhost:8137`; figures are embedded synthetic SVGs. The release-check alarm was cleared before each case. No CUA, visible browser, real browser profile, stable installed extension folder, LLM service or cloud storage was used.

## Numbered reading-flow evidence

| Step | Actual check | Baseline result | Screenshot |
| --- | --- | --- | --- |
| 1 | Select a phrase and expose the colour toolbar | Visible beside the selected phrase; colours and digit hints readable | [01](images/01-selection-toolbar.png) |
| 2 | Create a text highlight, click it, type a Markdown note | Textarea receives focus; preview renders bold text; Save closes the editor | [02](images/02-text-note-editor.png) |
| 3 | Drag a figure and use a colour shortcut | One ring appears around the intended image | [03](images/03-image-ring.png) |
| 4 | Drag the annotated image again | Existing image note editor reopens and receives focus | [04](images/04-image-note-reopened.png) |
| 5 | Select both library cards | All three annotations are selected across two pages; right-side checkboxes and selected borders are visible | [05](images/05-library-batch.png) |
| 6 | Open service status without credentials | Both services show unconfigured; test buttons are disabled; daily schedule is visibly not enabled | [06](images/06-service-status.png) |
| 7 | Open LLM settings, then Escape | Disabled-by-default state and compressed default prompt are visible; Escape closes the native dialog | [07](images/07-llm-settings.png) |

E83 passed in 5.8 seconds. All seven saved images were opened and visually inspected. Two non-blocking observations warrant the main reviewer’s judgement: at 1280 px, the two uneven-height library cards occupy the left column while the right half is empty (05); the LLM settings Save action starts below the visible fold and requires scrolling (07). Focus restoration after the status-to-settings transition was not asserted and should not be reported as verified.

## Adversarial baseline failures

Command: `LOCUS_AUDIT_CAPTURE=baseline pnpm exec playwright test e2e/audit.spec.ts --grep 'E84:|E85:|E86:|E87:|E88:'`.

All five cases failed on the unmodified 0.9.6 build. Failure screenshots were opened and inspected after execution.

| Case | Reproduction and measured evidence | Impact | Screenshot |
| --- | --- | --- | --- |
| E84 | Annotate `figure-b`; exchange two image elements sharing the same source but distinct alt text. The ring stays at the old location, 292 px from the intended image. The fixture exchanges the image nodes, not their captions. | Wrong figure can appear annotated after page reordering. The subsequent removal/detach assertion was not reached in this baseline run. | [E84](images/E84-baseline-failure.png) |
| E85 | Annotate an image in an overflow panel, then scroll that panel by 80 px. The ring remains 80 px behind and visibly surrounds empty space below the image. | Misleading annotation location in nested scrolling content. Clip/hidden assertions follow this check and were not reached on baseline. | [E85](images/E85-baseline-failure.png) |
| E86 | Enter a Chinese draft and dispatch an Enter keydown with `isComposing: true`. The editor is removed immediately. | IME confirmation incorrectly commits/closes the note before ordinary Enter. | [E86](images/E86-baseline-failure.png) |
| E87 | The initial probe tried to reject one annotations transaction, then observed the editor close. Later investigation found Dexie caches its transaction factory, so this probe did not reliably establish that the final write failed. | This screenshot alone does **not** prove lost persistence or a false successful save. The old early-clear behaviour has separate source/unit evidence; the final browser check below uses a counted write rejection. | [E87](images/E87-baseline-failure.png) |
| E88 | Type `1` in input, textarea and contenteditable while a palette selection is pending, then open a note at 280 × 480. All native fields retain their digit and no annotation is created by those keystrokes. The note card then extends beyond the right viewport edge and clips its Save action. | Native editing protection passes; narrow note editing does not fit the viewport. | [E88](images/E88-baseline-failure.png) |

The IME case uses a composing keyboard event in headless Chromium, not an operating-system IME session. The initial storage probe has the limitation stated above and must not be counted as an independently reproduced persistence failure. Updated production code and full regression results are owned by the main task and are not implied by these baseline observations.

The screenshot capture is opt-in with `LOCUS_AUDIT_CAPTURE=baseline`; `LOCUS_AUDIT_CAPTURE=after` writes to a separate `images/after/` directory. Ordinary subsequent E2E runs do not overwrite either set.

## Integrated candidate checks

The first integrated build passed E84, E85 and E88, including the removal/detach and clip/hidden assertions that baseline could not reach. E86 preserved the composing draft and E87 retained its draft/error UI, but successful content-note writes were rejected by the background sender policy with “Open the Locus library to use this action.” That concrete integration defect also blocked E83. The final candidate corrects the authorization for current-page single-note edits; E83, E86 and E87 now complete the actual save and reopen path.

Three additional lifecycle regressions pass on the 0.9.7 candidate:

- E92 waits once for 15.2 real seconds, then changes an annotated image source and text DOM, restores the image and replaces its node. The real wait deliberately covers the extension’s isolated-world timers without modifying the worker clock.
- E93 removes an image while its Auto palette is pending, then checks that the palette closes, a digit creates no dangling record and the page has no uncaught error.
- E94 inserts one damaged legacy anchor directly into the isolated database and reloads the page. It requires both healthy text highlights to remain visible while only the damaged entry detaches.

All nine audit cases have now passed on the 0.9.7 candidate after two harness corrections. The initial nine-case run passed seven. E92 then passed in 18.3 seconds after its bounding-box poll was made tolerant of the brief interval when a coalesced rerender removes/recreates the ring. E87 then passed in 1.9 seconds after replacing the ineffective transaction hook with a counted `IDBObjectStore.put` rejection restricted to the annotations store. The failure remains active until the visible error and intact draft are asserted; restoring the native method permits Save, and reopening verifies the persisted text. Neither harness correction changes production code. These are aggregate targeted results, not a claim that one uninterrupted nine-case run or the full suite passed; the main task runs the full regression suite separately.

`images/after/E87-after-failure.png` and `images/after/E92-after-failure.png` are retained intermediate **harness-failure artifacts**, not evidence of remaining product failures. Use the successful numbered screenshots below for the final comparison.

## Successful after-image review

All twelve successful after images were individually opened and visually inspected. Steps 01–07 repeat the baseline workflow. The note editor additionally exposes a named dialog and named, focused textarea in the browser accessibility tree.

| Evidence | Observed result | Successful screenshot |
| --- | --- | --- |
| Selection toolbar | Palette stays beside the selected phrase with readable colour and digit controls. | [01](images/after/01-selection-toolbar.png) |
| Text note | Focused draft, Markdown preview and Save/Cancel/remove actions are readable. | [02](images/after/02-text-note-editor.png) |
| Image annotation | Ring follows the intended first figure without overlapping its neighbour. | [03](images/after/03-image-ring.png) |
| Image note reopened | Existing image opens its focused editor near the image; successful save is exercised. | [04](images/after/04-image-note-reopened.png) |
| Library batch | Three selected annotations across two pages are counted correctly; cards, rows and checkboxes show selection. The left-column imbalance remains a non-blocking layout observation. | [05](images/after/05-library-batch.png) |
| Service status | Unconfigured state, unverified check, absent sync and disabled schedule are distinct; unavailable actions stay disabled. No service request occurs. | [06](images/after/06-service-status.png) |
| LLM settings | Disabled configuration and compressed prompt remain readable. Save still starts below the initial visible fold and requires scrolling. | [07](images/after/07-llm-settings.png) |
| Reordered image | Ring follows the target image node to the left slot. The fixture leaves captions stationary, so the caption is not an identity assertion. Removing that image subsequently detaches its annotation. | [08](images/after/08-image-reordered.png) |
| Nested scrolling | Ring follows the scrolled image; its top portion is clipped at the panel boundary rather than drawing around empty page space. Hiding/showing the image hides/restores the ring. | [09](images/after/09-image-scroll-clipping.png) |
| IME and dirty Escape | Composing Enter does not commit; subsequent dirty Escape leaves the Chinese draft focused and shows the unsaved-note instruction. Ordinary Enter then saves. | [10](images/after/10-ime-draft.png) |
| Failed save and retry | Real persistence rejection keeps the draft and a visible alert, with Save available for retry. The synthetic error is deliberately technical test text. Restoring persistence then saves the same draft. | [11](images/after/11-note-save-retry.png) |
| 280 px viewport | Editor fits inside all viewport edges. Actions wrap and Save remains visible and reachable. | [12](images/after/12-narrow-note.png) |

These checks use synthetic local material only. They establish the specific interactions above; they do not certify operating-system IME behaviour, screen-reader usability, status-to-settings focus restoration, or live-service compatibility.
