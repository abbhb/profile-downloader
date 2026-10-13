# Changelog

This project follows Semantic Versioning. Tags use the `vMAJOR.MINOR.PATCH` form.

## 1.2.0 — 2026-10-13

- Add JSON syntax highlighting in Response and a collapsible object / array tree in Preview.
- Render tree children on demand in groups of 100, with a copy action for each value.
- Add one-click original-response and formatted-JSON copying, including on-demand retrieval of complete text within the copy limit.
- Keep bounded previews, explicit truncated / invalid / binary states, safe DOM rendering and the existing 22 px single-line request density.
- Document clipboard export, copy failures and response-size limits without adding extension permissions.

## 1.1.1 — 2026-10-13

- Use 22 px single-line request rows so more endpoints fit in the panel.
- Show the endpoint name in each row; keep the full URL available on hover and in Headers.
- Tighten column widths and adapt narrow lists by hiding Waterfall / Type as needed while retaining full request details.

## 1.1.0 — 2026-10-13

First public release. The earlier 1.0.0 manifest belonged to a local prototype and was not a public release.

- Replace request cards with a compact Network-style request table, sorting, filters and request detail tabs.
- Add a request-row context menu inside Profile to select an endpoint and open its profiling action.
- Preserve GET / POST replay with query parameters, complete text bodies, current login state and settable request headers.
- Document browser API boundaries, backend requirements, request privacy and safe local validation.
- Add source checks, synthetic tests, sensitive-data checks and versioned release ZIPs with SHA-256 checksums.
- Publish the source under the MIT license and define the tag / GitHub Release workflow.
