# Finance Finder User Personas

> These personas drive testing and UX decisions. Reference by name in specs and
> tests. Filled 2026-09-21 with Milestone 4, the first user-facing milestone
> (`docs/milestone-4-execution.md` P0-U2). The product is single-owner by
> posture (ARCHITECTURE §4.7, §4.9): the primary persona is the one person who
> runs an instance; the secondary is the person who extends the software, not
> a second user of it.

## Primary Personas

### Marina — the self-hosting investor

**Profile**:
- **Role**: Salaried professional in São Paulo who invests her own savings
  through one or two brokers; no advisor, no fund manager
- **Age range**: 30–45
- **Tech comfort**: Medium — can follow a README to run `pnpm` once and paste
  keys into a dashboard; will not debug a stack trace
- **Language**: Brazilian Portuguese first; reads English fine, prefers her
  own language on a screen she looks at every day
- **Context**: Checks on her phone in the evening, after the market closes
  and the nightly ingest has run; a laptop once a month to import a broker
  statement and to export a backup

**Holdings** (what her ledger looks like, and what the golden fixture and
the synthetic ledger are shaped after): Tesouro Selic and one IPCA+ bond,
two or three CDBs (one prefixado, one % do CDI, one IPCA+), an LCI, five
FIIs, a handful of ações and one BDR, a Nubank account she treats as
external cash flows. Base currency BRL. Everything quoted in BRL.

**Goals**:
1. One honest number: what the whole portfolio is worth tonight, in reais,
   with anything stale or unpriced marked as such rather than folded in
2. Know whether she is beating the CDI and inflation — not in a spreadsheet
   she rebuilds twice a year, but every evening
3. Know when her fixed income matures so she can plan the next aporte, and
   catch a CDB that matured and was never redeemed

**Pain Points**:
- Broker apps show each account alone; her spreadsheet shows the total but
  she stopped updating the prices in March
- Every tool she tried wanted her broker password, an app-store account, or
  sent her data to somebody's analytics
- A stale price shown as a confident total once made her think she had
  lost money on a holiday when nothing had traded

**Typical Day**:
> 21:45. Marina opens the app on her phone after dinner. The headline is
> tonight's total; the day change is green with an arrow. She scrolls to
> see which FII moved. Her partner is on the sofa next to her, so she taps
> the privacy toggle before turning the screen. Once a month, on the laptop,
> she downloads the broker's CSV, imports it, glances at the preview for
> duplicates, commits, and exports a backup because the strip reminded her.

**Key Scenarios**:

#### Scenario 1: Evening check on the phone
```
Context: 400 px viewport, dark theme, pt-BR, after the nightly ingest
Action: Opens /
Expectation: Headline total, day change with sign and arrow, sparkline,
             donut, top movers — every number in "R$ 1.234,56" form
Success: Answers "how much and which way" in under five seconds with no
         horizontal scrolling; a stale holding is marked, not summed
```

#### Scenario 2: Import a broker CSV after switching brokers
```
Context: Laptop; a CSV whose headers differ from the canonical ones; some
         tickers she does not hold yet; some rows already in the ledger
Action: Upload → map columns once → preview → create the unknown assets
        inline → commit
Expectation: Every row's status visible before anything is written;
             duplicates skipped by default; the mapping remembered
Success: Commit writes exactly the new rows; re-importing the same file
         inserts nothing; snapshots rebuild without her doing anything
```

#### Scenario 3: Show the screen to a partner
```
Context: Phone, someone looking over her shoulder
Action: Taps the privacy toggle
Expectation: Every amount and quantity becomes •••; names, percentages and
             returns stay readable so the conversation still works
Success: The mask survives navigation and reload on this device; nothing
         about it is sent to the server
```

#### Scenario 4: Notice a matured CDB
```
Context: A CDB matured last month; the broker credited the account but she
         never recorded the sell
Action: Opens /maturities
Expectation: The row is marked "matured — record the redemption", not
             valued as if still accruing without saying so
Success: She records the redemption from the link; Contribution and the
         headline stop counting money that is no longer invested
```

---

### Tomás — the pack contributor

**Profile**:
- **Role**: Software developer in another market (Lisbon, London, Buenos
  Aires) who wants the same tool for his own country
- **Age range**: 25–40
- **Tech comfort**: High — comfortable with TypeScript, zod and a pull
  request; not a financial engineer and does not want to be
- **Language**: English for code and docs; expects to add his own language
  as a dictionary, not a fork
- **Context**: Evenings and weekends; wants a contribution he can finish in
  a few sessions with an objective gate telling him when it is done

**Goals**:
1. Add his market as data — instruments, series, sources, a calendar —
   without touching a valuation formula
2. See his instrument kinds appear in the asset form, his benchmarks in the
   Performance toggles, and his fixed income on Maturities with no UI change
3. Know exactly which kernel assumptions his market will test (`PACKS.md`
   §16) before he starts

**Pain Points**:
- Projects where "add a country" means editing an enum in six files
- Golden numbers that were tuned to the implementation rather than derived
  independently, so a mismatch tells him nothing
- A UI that hard-codes the first market's currency in a fallback he finds
  by accident in production

**Typical Day**:
> Tomás reads `PACKS.md` §1 and §16, copies the shape of `packs/br`, writes
> one instrument kind and one series with a source adapter against
> `ctx.http`, records fixtures, derives a small golden portfolio by hand,
> and runs `pnpm test:packs` until it is green. He enables his pack in
> Settings on a local instance and sees his kind in the asset form without
> having opened `app/`.

**Key Scenarios**:

#### Scenario 1: Read the seam before writing code
```
Context: PACKS.md §16 lists what the second pack will meet
Action: Reads the list, maps each item to his market
Expectation: Every kernel assumption is written down with the decision that
             made it; none is a surprise he finds in a test failure
Success: He knows which items are pack work and which would be a
         PACK_API_VERSION discussion before writing a line
```

#### Scenario 2: Conformance is the review
```
Context: A draft pack with fixtures and a golden portfolio
Action: pnpm test:packs
Expectation: Manifest, hygiene, fixture replay, golden reproduction to 1e-8
             and the neutrality test all run; a failure names the file and
             the rule
Success: Green means mergeable as a pack PR; nothing in lib/ or app/ had to
         change
```

#### Scenario 3: The form and the toggles just work
```
Context: His pack enabled on a local instance
Action: Opens /assets, /performance, /maturities
Expectation: His kinds in the pack → kind selectors with fields generated
             from his metadataSchema; his benchmark-role series in the
             toggles; his kind with maturity metadata on the ladder
Success: No screen names his pack; the neutrality test still passes
```

---

## Anti-Personas

People we are **NOT** designing for (to maintain focus):

### The tax filer
- **Why not**: Tax and fiscal reporting are excluded permanently
  (ARCHITECTURE §2); per-jurisdiction liability multiplies faster than any
  feature
- **Implication**: No cost basis for tax, no darf, no capital-gains report,
  no "export for my accountant" — ever. Contribution is a performance
  figure, not a fiscal one.

### The day trader
- **Why not**: Daily snapshots, nightly ingest, no order execution and no
  broker credentials (ARCHITECTURE §2)
- **Implication**: No intraday prices, no order book, no alerts, no
  real-time anything. Refresh is a catch-up control, not a ticker.

### The multi-tenant SaaS operator
- **Why not**: Single owner by posture; the schema is multi-user-ready but
  signups are a deliberate configuration change (ARCHITECTURE §4.7, §4.9)
- **Implication**: No admin screens, no billing, no per-tenant branding, no
  analytics. Opening signup is one toggle the operator owns, not a product
  surface.

---

## Persona Usage Guide

When implementing features, ask:
1. Which persona does this serve? (Marina for every screen; Tomás for
   every contract the registry or the conformance suite exposes)
2. How would Marina discover this on her phone in the evening?
3. Does the copy read naturally in pt-BR *and* English, at her tech comfort?
4. Does it fit the evening check / monthly import rhythm, or does it demand
   attention she will not give?

When testing:
1. Walk through each relevant persona's scenarios (the Milestone 4 e2e
   journeys are Marina's scenarios in order)
2. Use her language patterns in test inputs (broker CSV headers in
   Portuguese; "aporte", "resgate")
3. Verify a stale or unpriced number is marked, never confident — her
   pain point 3 is the product's defining rule (SPEC §11)
