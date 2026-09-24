# Accessibility

US-013 AC-013.5, walked and written down (Milestone 4 P7-U2). The contrast
half is enforced on every run by `lib/testing/contrast.test.ts`, which reads
the tokens out of `app/globals.css` — change a colour and the test checks the
new one. The rest of this page is a walk: what was looked at, on what date,
and what it showed.

**Walked 2026-09-24**, on the tree at Milestone 4 Phase 7, in Chromium at
1280 px and at 400 px, signed in as an owner holding the golden portfolio.

## The checklist

| Item                      | How it is met                                                                                                                | Enforced by                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Landmarks**             | One `<main>` per page, `<nav>` in the shell, each additional `<nav>` (pagination, period, filter) carries its own name       | the walk below                 |
| **Skip link**             | `a.skip-link` to `#main`, first in the tab order, visible on focus (`app/(app)/layout.tsx`, `app/login/layout.tsx`)          | the walk below                 |
| **Labels**                | Every control is wrapped in a `<label>` or carries `aria-label`; the generated asset fields label from the pack's own schema | the walk below                 |
| **Focus order**           | DOM order is reading order; no `tabindex` above 0 anywhere                                                                   | the walk below                 |
| **Focus visible**         | `:focus-visible` → 2 px `--accent` outline, 2 px offset, on inputs, selects, textareas, buttons, links and `summary`         | `globals.css:210`              |
| **Contrast**              | Every text-on-background pair meets AA in both themes                                                                        | `lib/testing/contrast.test.ts` |
| **Reduced motion**        | `prefers-reduced-motion: reduce` collapses every animation, transition and smooth scroll                                     | `globals.css:343`              |
| **400 px**                | Every route fits with no horizontal overflow; the nav collapses to a `<details>` menu that works without JavaScript          | `e2e/08-phone.spec.ts`         |
| **`aria-live`**           | The status strip is `role="status"`/`aria-live="polite"`, so a change in liveness is announced without stealing focus        | the walk below                 |
| **Error copy**            | Field errors mark the field (`aria-invalid`) and say what to do; page-level failures use `role="alert"`                      | `e2e/10-instance.spec.ts`      |
| **Colour is never alone** | `--pos`/`--neg` always accompany a sign and an arrow                                                                         | `SPEC §10`, `<Change>`         |

## The walk

Every route, signed in, at both widths. `h1` is the count of level-one
headings, `main` of main landmarks, `skip` of skip links, `live` of live
regions; `unlabelled` counts form controls with no accessible name, computed
the way a screen reader computes it (`aria-label`, `aria-labelledby`,
`label[for]`, then an ancestor `<label>`).

| Route                  |  h1 | main | skip | live | unlabelled controls | img without alt | unnamed nav |
| ---------------------- | --: | ---: | ---: | ---: | ------------------- | --------------: | ----------- |
| `/`                    |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/performance`         |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/allocation`          |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/contribution`        |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/maturities`          |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/assets`              |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/transactions`        |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/transactions/import` |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/cash-flows`          |   1 |    1 |    1 |    1 | none                |               0 | none        |
| `/settings`            |   1 |    1 |    1 |    1 | none                |               0 | none        |

Identical at 1280 px and 400 px. No fix was needed: the walk found nothing to
correct, which is what the §10 tokens and the shell were built for.

### The two surfaces the spec-gap units added

- **The Assets table at 400 px** stacks into cards (`table.stack`, under
  640 px): the header row is removed from view and each cell carries its
  column name in `data-label`, rendered before the value. 42 cells carry one
  over the golden portfolio, so the paired figures — average cost under
  quantity, unrealised under value — keep their labels when the table becomes
  a list. The journey that would catch a regression is `08-phone`.
- **The Transactions filter** is a `<form aria-label>` whose every control
  (asset, type, from, to) sits inside its own `<label>`, with a Clear link
  beside the submit. Verified present at both widths.

### One observation, not a defect

During streaming, a page briefly carries **two** `<main>` elements: the
Suspense fallback in `app/(app)/loading.tsx` and the page arriving to replace
it. It resolves to one as soon as the content lands, and only the slowest two
reads (`/` and `/assets`, which value the portfolio in the kernel — see
`docs/performance-budgets.md`) hold it long enough to observe. It is worth
knowing when the blocked accrual budget is addressed: making those reads fast
closes the window entirely.

## Re-running it

```
pnpm test               # includes the contrast test
pnpm test:e2e           # includes 08-phone, the 400 px sweep
```

The walk itself was a throwaway Playwright probe over `APP_ROUTES`; the
findings are the table above. Re-walk when a screen gains a new control type,
and update the date.
