# 0012 — React-PDF behind a `DocumentRenderer` port

**Status:** Accepted · 2026-08-12

## Context

M06 produces nineteen document types in Phase 1, each numbered, timestamped, attributed to the
printing user, and reproducible years later. Documents must render in English **and Amharic**, which
requires correct Ethiopic script shaping and an embedded font. Labels and hanging tags go to thermal
printers at defined physical sizes. Rendering runs in a container on a modest VM.

## Decision

`@react-pdf/renderer`, behind a `DocumentRenderer` port.

- Shared primitives — `Letterhead`, `Footer` (number + timestamp + printed-by), `SignatureBlock`,
  `DataTable`, `WatermarkDuplicate`, `QrBlock` — so every document is visually consistent and the
  mandatory footer cannot be forgotten.
- Noto Sans Ethiopic and a Latin family embedded in the image.
- Rendering happens **outside business transactions**, driven by the outbox.
- Every render writes a `printed_document` row including a `payload_snapshot`, so a reprint
  reproduces the original figures rather than today's master data.

## Consequences

**Positive**

- No browser binary in the container: image is ~200 MB rather than ~1 GB, memory is predictable, and
  there is no Chromium CVE stream to track.
- Layout is declarative React, so document templates are reviewable by the same people who review the
  UI.
- Deterministic output makes golden-file tests (render → extract text → snapshot) practical, which
  catches the "gate pass lost its number" class of bug.
- Exact physical sizing for thermal labels.

**Negative**

- React-PDF's layout engine is a subset of CSS — complex layouts need more care than HTML would.
- Ethiopic shaping must be verified per document, not assumed. Explicit task in roadmap Step 24.
- Charts and rich HTML are awkward. Phase 1 documents do not need them; M21's Phase 2 report exports
  may, which is exactly what the port is for.

## Alternatives rejected

- **Headless Chromium (Puppeteer/Playwright) HTML → PDF.** Best fidelity and full CSS, and the
  templates could share code with the UI. Rejected for Phase 1 on operational cost: a browser in the
  production image, high per-render memory, slow cold starts, and a continuous patching burden — for
  documents that are mostly tables and headers. The port keeps this reversible; if M21 needs
  chart-heavy exports, add a second adapter for those documents only.
- **`pdfmake` / `pdf-lib`.** Lower level; would mean building the layout system this gives us.
- **A reporting server (JasperReports).** A JVM component to operate, and template authoring outside
  the team's toolchain.
- **Browser-side printing (`window.print`).** No numbering control, no server-side record of what was
  printed, no snapshot — it fails the M06 key control outright.
