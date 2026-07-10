# Lore Codex — `leaflet-draw` Succession Plan

**Status:** spike complete, **no action now**. `leaflet-draw` stays. Successor pre-chosen (`@geoman-io/leaflet-geoman-free`), migration pre-costed (~2 hours, 3 call sites), triggers defined below. · **Written:** 2026-07-10 · **Issue:** #189 (Audit D1)
**Scope:** inventory the `leaflet-draw` API surface Lore Codex actually uses, evaluate `leaflet-geoman` as a drop-in replacement, and turn a future forced migration into a plan rather than an emergency.

---

## 1. Executive summary

**Keep `leaflet-draw`. Do not migrate now.** The audit filed this as "the risk is being stranded on a Leaflet 2.x migration." That premise does not survive contact with the evidence: **`leaflet-geoman` is stranded on Leaflet 2.x in exactly the same way `leaflet-draw` is.** Its npm `peerDependencies` pin `leaflet@^1.2.0`, and its shipped bundle patches the Leaflet 1.x global `L` via `addInitHook` — the precise pattern Leaflet 2.0 removes when it drops the `L` global and replaces factories with constructors. Swapping today buys **zero** Leaflet 2 readiness and costs **≈ +61 KB gzip** for two features we use out of the dozens geoman ships.

Meanwhile the deadline everyone was bracing for has slipped indefinitely. Leaflet 2.0 was announced to plugin maintainers with a **stable target of November 2025**; as of July 2026 the newest artifact is `2.0.0-alpha.1`, published **2025-08-16 — eleven months ago**, with no alpha since. There is no migration to be stranded by yet.

What *is* true is the maintenance asymmetry, and it is stark:

| | `leaflet-draw` | `@geoman-io/leaflet-geoman-free` |
|---|---|---|
| Latest release | **1.0.4 — 2018-10-24** (7.7 years) | **2.20.0 — 2026-06-23** (3 weeks) |
| Last repo push | 2024-07-09 | 2026-07-06 |
| Open issues | 467 | 29 |
| License | MIT | MIT |
| Bundled TS types | ✗ (needs `@types/leaflet-draw`) | ✓ |
| Leaflet 2 support | ✗ (no maintainer response) | ✗ (no maintainer response) |

So geoman is the right *successor* — just not the right *migration today*. The migration is small enough (**3 call sites in one file**) that buying it early is worse than buying it on demand: we would pay 61 KB and a behavioural regression risk now, to save two hours later.

**Recommendation: pre-commit to geoman, migrate on a trigger** (§5), and land the missing `MapView` draw/edit test *before* the swap, not during it (§6).

---

## 2. Inventory: what we actually use

Verified by grep across `src/`. The entire `leaflet-draw` coupling lives in **`src/components/MapView.tsx`** — 3 call sites. `MapRoute.tsx` never touches the library; its 7 `Draw` matches are all its own `drawMode` boolean state, which it passes down as a prop.

| # | Usage | Site |
|---|---|---|
| 1 | `import 'leaflet-draw'` (side-effect; augments `L`) | `MapView.tsx:4` |
| 2 | `import 'leaflet-draw/dist/leaflet.draw.css'` | `MapView.tsx:5` |
| 3 | `new L.Draw.Polygon(lmap as L.DrawMap, { allowIntersection: true, shapeOptions: { color, weight } })` | `MapView.tsx:284` |
| 4 | `drawer.enable()` / `drawer.disable()` | `MapView.tsx:288,297` |
| 5 | `L.Draw.Event.CREATED` → `e.layer.getLatLngs()[0]` | `MapView.tsx:289–298` |
| 6 | `polygon.editing.enable() / .disable() / .enabled()` | `MapView.tsx:117,309–319` |
| 7 | Local `EditablePolygon` narrowing, because `@types/leaflet-draw` does not surface the per-layer `editing` handle | `MapView.tsx:9–14` |

**What we do *not* use is most of the library:** `L.Control.Draw` (the toolbar — the bulk of `leaflet-draw`), the edit/delete toolbars, `FeatureGroup` draw layers, and every shape other than polygon (rectangle, circle, marker, polyline, circlemarker).

That matters twice over. It is why the migration is cheap — and it is why geoman's 61 KB is poor value: we would import a full-featured geometry-editing suite (with Turf.js, lodash and `polyclip-ts` bundled in) to drive a polygon drawer and a vertex handle.

## 3. Drop-in assessment: `leaflet-geoman-free`

Verified against the shipped type definitions of `@geoman-io/leaflet-geoman-free@2.20.0` (`dist/leaflet-geoman.d.ts`). Every call site has a direct equivalent:

| Our usage | geoman equivalent | Note |
|---|---|---|
| `new L.Draw.Polygon(map, opts)` + `.enable()` | `map.pm.enableDraw('Polygon', opts)` | `'Polygon'` ∈ `SUPPORTED_SHAPES` |
| `drawer.disable()` | `map.pm.disableDraw('Polygon')` | |
| `L.Draw.Event.CREATED` → `e.layer` | `map.on('pm:create', e => e.layer)` | `CreateEventHandler` payload is `{ shape, layer }` |
| `allowIntersection: true` | `allowSelfIntersection: true` | geoman's default is already `true` |
| `shapeOptions: { color, weight }` | `pathOptions` (+ `templineStyle` / `hintlineStyle` for the in-progress rubber band) | geoman splits finished vs in-progress styling |
| `poly.editing.enable() / .disable() / .enabled()` | `poly.pm.enable(opts) / .disable() / .enabled()` | same three-method shape |
| `EditablePolygon` local narrowing + `@types/leaflet-draw` devDep | *(delete both)* | geoman augments `L.Map.pm` and `L.Layer.pm` in its own `.d.ts` |

**Net:** the swap deletes the type hack *and* a devDependency. It is a genuine drop-in at the API level.

### 3.1 The one real gotcha

`MapView` renders polygons **from React state, not from the draw layer** — the comment at `MapView.tsx:278–280` says so explicitly: *"the new polygon is rendered from state (not added here), so there's no duplicate layer."* `leaflet-draw` cooperates: `Draw.Event.CREATED` hands you a layer that is **not** on the map.

**geoman does the opposite — `pm:create` adds the created layer to the map.** Ported naïvely, every drawn region would render twice: once from geoman's layer, once from our state.

Mitigation is available and documented in the type defs (`GlobalOptions.layerGroup`, line 1340: *"Add the created layers to a layergroup instead to the map"*). Either point `layerGroup` at a throwaway `L.LayerGroup` that is never added to the map, or call `e.layer.remove()` inside the `pm:create` handler. **This is the single behavioural difference that a migration must handle, and the single thing a regression test must pin.**

Vertex-edit persistence is unaffected: `MapView` persists on *deselect*, reading `getLatLngs()` off the polygon, which works identically under `poly.pm`. geoman additionally fires `pm:edit` / `pm:update` / `pm:vertexadded` if we ever want live persistence.

## 4. Cost

Minified `main` entry vs minified `main` entry, gzipped:

| | gzip | raw |
|---|---|---|
| `leaflet-draw` → `dist/leaflet.draw.js` | **14.4 KB** | 67.5 KB |
| `leaflet-geoman-free` → `dist/leaflet-geoman.min.js` | **75.2 KB** | 287.4 KB |
| CSS | 1.2 KB → 6.6 KB | |
| **Delta** | **≈ +61 KB gzip** (+5.3 KB CSS) | |

The weight is not incidental and **will not tree-shake away**. geoman's bundler entry (`main` = `module` = `dist/leaflet-geoman.js`) is a **prebuilt IIFE**, not ESM: it inlines `@turf/boolean-contains`, `@turf/kinks`, `@turf/line-intersect`, `@turf/line-split`, `lodash` and `polyclip-ts` (its declared `dependencies` resolve to nothing external — the only `require()` in the bundle is Node's `util`). Vite cannot drop the geometry-boolean machinery we never call.

Mildly in geoman's favour: because the entry is a side-effect IIFE keyed on the global `L`, it sits behind the same lazy-loaded map chunk `leaflet-draw` already occupies (`App.tsx:21`), so the cost lands on the `/map` route rather than first paint.

## 5. Migration triggers

Do nothing until one of these fires. Each names the destination, so the decision is already made when it does.

1. **`leaflet-draw` breaks against a Leaflet 1.9.x patch we need.** → Migrate to geoman. This is the likeliest trigger and the reason the plan exists.
2. **Leaflet 2.0 ships stable *and* geoman ships a Leaflet-2-compatible major.** → Take both together as one upgrade. Watch [geoman #1593](https://github.com/geoman-io/leaflet-geoman/issues/1593); it is currently an unanswered broadcast from the Leaflet team.
3. **We need a second shape, snapping, or cut/split** (e.g. #180 map layers, #118 high-res maps). → Migrate to geoman; the 61 KB starts paying for itself, and hand-rolling stops being credible.
4. **Leaflet 2.0 ships stable and geoman does *not* follow within ~2 of its releases.** → **Hand-roll.** Our surface is a polygon drawer plus draggable vertex handles — roughly 200–300 lines against core Leaflet (`L.Polyline`, `L.Marker`, map click/drag events), with zero plugin dependency and no global-`L` coupling. Given both plugins are equally stranded, this is the only option that is *actually* Leaflet-2-safe, and our tiny surface is what makes it viable.

Until then, the audit's own standing advice holds: **do not build more on `leaflet-draw`'s API surface than `MapView` already does.** Every new call site is migration debt against a 2018 library. Three is cheap; ten is not.

## 6. Pre-flight (do this *before* any swap, not during)

`src/components/MapView.tsx` (404 lines) has **no test file**. The draw and vertex-edit paths — the exact code any migration rewrites — are entirely uncovered. Swapping libraries under zero coverage would be an unforced error, particularly given the duplicate-layer difference in §3.1.

Land first, against the *current* `leaflet-draw`, so it is a true regression net:

- drawing a polygon calls `onRegionCreate` once, with ≥3 points, and leaves **exactly one** layer on the map (this is the §3.1 canary);
- a polygon with <3 points is rejected;
- selecting a region enables vertex editing; deselecting it disables editing and calls `onRegionEdit` with the updated ring;
- leaving draw mode disables the drawer and detaches the `CREATED` listener.

This overlaps #144's spirit (coverage for the untested seams) and is worth doing on its own merits regardless of whether the migration ever happens.

---

## Appendix — verification method

All figures gathered 2026-07-10 from primary sources, not documentation prose:

- **Versions, dates, licenses, peer deps:** npm registry (`registry.npmjs.org/{leaflet,leaflet-draw,@geoman-io/leaflet-geoman-free}`).
- **Repo health:** GitHub API (`/repos/Leaflet/Leaflet.draw`, `/repos/geoman-io/leaflet-geoman`).
- **Leaflet 2.0 status:** GitHub releases for `Leaflet/Leaflet` — `v2.0.0-alpha` (2025-05-18), `v2.0.0-alpha.1` (2025-08-16), nothing since; `v1.9.4` (2023-05-18) remains `dist-tags.latest`.
- **API equivalence:** `dist/leaflet-geoman.d.ts` @ 2.20.0, read directly.
- **Bundle sizes:** `dist` artifacts from unpkg, `gzip -c | wc -c`.
- **Global-`L` coupling:** both bundles call `L.Map.addInitHook` / `L.Polygon.addInitHook` with `L` as a free variable; neither imports `leaflet` as a module.
- **Our surface:** grep of `src/` for `leaflet-draw|L.Draw|editing`.
