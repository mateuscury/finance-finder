# lib/settings

`defaults.ts` exists so that "multi-country ready" is enforceable rather than
asserted: it is the one file in `app/` and `lib/` allowed to name a pack id,
a currency code or a locale (`MILESTONES.md` §4 decision 42), and
`packs/conformance/kernel-neutrality.test.ts` fails the build on any other
occurrence. Locale literals are also allowed in `lib/copy/index.ts`, which
names the languages the instance ships (decision 34).

Adding a second literal site is a decision, not a convenience. A screen that
needs a default reads it from here or from `user_settings`.
