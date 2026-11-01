# Locus / 文迹 0.9.5

## Select from blank space

- Card checkboxes now sit fully inside the upper-right corner, with space reserved so long titles never overlap them.
- Click a card’s blank area to select or deselect its matching annotations, including collapsed rows.
- Click an annotation’s blank area to toggle that annotation only. Selection starts directly without opening a menu.
- Titles, quote navigation, links, editing controls and text selection keep their existing behavior. Existing batch previews and safeguards remain in place.

Update the existing extension in place to retain notes and settings.

## Validation

- Typecheck and all 287 unit tests passed.
- All 74 browser cases verified. After correcting the busy-state test to send an actual mouse click to the intentionally inert UI, all seven editing cases passed again.
- Checked right-side containment, title separation, card/row selection boundaries, navigation, editing and text dragging at wide and narrow viewport sizes.
- Chrome and Edge production archive contents match; the keyless Edge store package passed verification.
