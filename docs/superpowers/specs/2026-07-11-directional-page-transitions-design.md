# Directional page transitions (#172)

## Goal

Make the existing route transition **directional**: a distinct entrance when
navigating forward (clicking a new page) versus back (returning to the previous
one). Today `.route-fade` plays one uniform fade + 4px rise on every navigation.

## Motion

Vertical and subtle, reusing the app's `translateY` vocabulary:

- **forward** — fade in, rising from ~8px below (`translateY(8px) → 0`)
- **back** — fade in, settling from ~8px above (`translateY(-8px) → 0`)

Both settle at `opacity:1; transform:none` (the "cancelled animation can never
hide content" invariant already used by the shared keyframes). Duration/easing
unchanged (`--dur-3`, `--ease-settle`).

## Direction detection

react-router v7 maintains a monotonic `idx` in `window.history.state`. A pure
helper decides direction from the previous idx, next idx, and navigation type:

```
navDirection(prevIdx, nextIdx, navType) -> 'forward' | 'back'
```

- `nextIdx < prevIdx` → `back`
- `nextIdx > prevIdx` → `forward`
- equal / missing idx / first render / `PUSH` / `REPLACE` → `forward` (neutral default)

`useNavDirection()` is a thin hook: reads `history.state?.idx` and `useNavigationType()`
on each `location` change, holds the previous idx in a ref, returns the current
direction.

## Wiring

`App.tsx` already wraps routes in `<div className="route-fade" key={location.pathname}>`.
The `key` remount restarts the CSS animation — kept as-is. Add `data-nav={dir}`:

```jsx
<div className="route-fade" data-nav={dir} key={location.pathname}>
```

CSS selects the keyframe by `[data-nav="forward"]` / `[data-nav="back"]`.

## Reduced motion

Already handled globally (`index.css` `prefers-reduced-motion` block neutralizes
all animation durations) — both directions collapse to an instant swap. No extra
work.

## Testing

- Unit-test the pure `navDirection()` across a sequence of idx values (increase →
  forward, decrease → back, first/equal/missing → forward).
- CSS verified live in the browser (forward vs back nav).

## Files

- `src/navDirection.ts` — new: pure `navDirection()` + `useNavDirection()` hook
- `src/navDirection.test.ts` — new
- `src/App.tsx` — wire `data-nav`
- `src/index.css` — split `route-fade-in` into forward/back keyframes
