# 0.9.7 package verification

Date: 2026-11-01. ZIP CRC checks pass; all manifest versions are 0.9.7. Chrome and Edge sideload file contents are identical and retain fixed ID `dfmekdplmdbjbefchginloeehjonjlan`. The Edge store candidate differs only by removal of the manifest key. The production store verifier passed.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| locus-0.9.7-chrome.zip | 252676 | `71dcebd38ac779267cb20c0900d1db9d2c6a982016dfc02e69482c47675d7def` |
| locus-0.9.7-edge.zip | 252676 | `ae3ebdba3f59fd508ee16467d6aa1ae929cfefdd864d658047e4c7af2260e870` |
| locus-0.9.7-edge-store.zip | 252331 | `da80e609b7e158c9ca5aa56b30d0d5358bdf429a54a2d483b2e8a98a3d9626ad` |

The live installation directory and user browser profiles were not modified. GitHub Latest is [v0.9.7](https://github.com/laleoarrow/locus/releases/tag/v0.9.7), published (not a draft/prerelease) from commit `7cd1962798574e939f1760ca24ff3b03b8db9fd2`. Both uploaded sideload ZIPs were independently downloaded and their SHA-256 values match this table. The store candidate remains local and was not submitted.
