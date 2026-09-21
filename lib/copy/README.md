# lib/copy — one type, two dictionaries

`types.ts` is the shape of every string a person reads; `en.ts` and
`pt-BR.ts` each implement it in full, so a key missing from one language is
a type error, and `copy.test.ts` proves the two key sets identical at
runtime (MILESTONES.md §4 decision 34).

A leaf is a string, or a function of **named** parameters when a count or a
name is interpolated — `commit: ({ n }) => \`Commit ${n} rows\``— never a
template a screen glues together from fragments, because the two languages
order their words differently. A line SPEC.md quotes is verbatim in`en`and
translated in`pt-BR`; its backticks stay in the string and the screen
renders them as `<code>`.

Strings that cross into a Client Component travel as props, so a group
handed to one (`screens.settings.security.enrol`) holds strings only.
`copyFor(locale)` picks the dictionary; `LOCALES` here and
`lib/settings/defaults.ts` are the only two places under `app/` and `lib/`
that may name a locale (`packs/conformance/kernel-neutrality.test.ts`).
