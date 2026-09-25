# Midday Reel idea rotation audit — 2026-09-25

Scope: the 27 Nick's Tire & Auto faceless Reel concepts from the recent midday batches, reconciled against current `main` **after** the evening import in PR #2655.

## Result

- **27 source concepts**
- **11 distinct lessons appended**
- **16 semantic duplicates already covered** by the existing or evening rotation
- Machine-readable map: `MIDDAY-IMPORT-2026-09-25.json`
- Cursor safety: append-only; no existing rotation entry is reordered.

Two older reviewed packs are normalized and made reachable instead of cloned: `2026-09-06-nitrogen-vs-air-tire-fill` and `2026-08-27-foggy-windshield-recirculate-trick`.

The pre-spend gate caught one content issue during reconciliation: the UTQG draft used the blocked social-copy terms “warranty” / “guarantee.” The mechanic truth was preserved while the wording was changed to “manufacturer tread-life coverage” / “mileage promise”; the safety gate was not weakened.

The other apparent overlap from the earlier branch was resolved against newer `main`, not duplicated. Examples include rotor surface rust, oil-life versus oil-pressure, TPMS flash-versus-steady, two-new-tires-on-rear, impact-gun versus final torque, XL Extra Load, puncture repair zone, battery-light charging system, and directional/asymmetric mounting.

## Evidence boundary

A rotating pack is a reviewed production input that is builder-loadable and must clear `runReelPreflight` before paid generation. This audit does **not** claim any of these ideas were rendered, published, deployed, or production-proven.
