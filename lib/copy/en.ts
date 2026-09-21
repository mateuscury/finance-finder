import type { Copy } from "./types";

/** English. Where root SPEC.md quotes a line, this is that line. */
export const en: Copy = {
  nav: {
    skipToContent: "Skip to content",
    analysis: "Analysis",
    ledger: "Ledger",
    overview: "Overview",
    performance: "Performance",
    allocation: "Allocation",
    contribution: "Contribution",
    maturities: "Maturities",
    assets: "Assets",
    transactions: "Transactions",
    cashFlows: "Cash flows",
    settings: "Settings",
    menu: "Menu",
    signOut: "Sign out",
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    privacy: "Hide amounts",
    privacyOn: "Amounts hidden",
    privacyOff: "Amounts shown",
    amountHidden: "hidden",
  },
  status: {
    ok: "up to date",
    carriedForward: ({ date }) => `carried forward from ${date}`,
    stale: ({ date }) => `stale — last known ${date}, excluded from totals`,
    unpriced: "unpriced",
    unpricedReason: ({ reason }) => `unpriced — ${reason}`,
    accrues: "accrues",
  },
  strip: {
    label: "Status",
    unpriced: ({ n }) => (n === 1 ? "1 asset unpriced" : `${n} assets unpriced`),
    rebuilding: ({ from, through, target }) => `history rebuilding ${from} → ${through ?? "…"} of ${target}`,
    sourceDisabled: ({ sourceId, variable }) => `source ${sourceId} disabled: ${variable} not set`,
    exportNudge: ({ lastExportAt }) =>
      lastExportAt ? `last export ${lastExportAt.slice(0, 10)} — export a backup` : "no backup yet — export one",
    refresh: "Refresh",
    refreshing: "Fetching in the background; reload in a moment.",
    dismiss: "Dismiss",
  },
  firstRun: {
    title: "Set up your portfolio",
    baseCurrency: ({ currency }) =>
      `Base currency: ${currency} — change it before your first transaction; it locks after.`,
    firstAsset: "Add what you hold: pack → instrument kind → identifier.",
    firstTransaction: "Enter one by hand, or import a CSV of your history.",
    priced: "Priced — fills in automatically once a source answers.",
    pricedPending: ({ n }) =>
      n === 1
        ? "1 asset is waiting for a price. If a source is disabled or failing, the status line says so; a manual price is always possible."
        : `${n} assets are waiting for a price. If a source is disabled or failing, the status line says so; a manual price is always possible.`,
    done: "done",
  },
  empty: {
    overviewHeadline: ({ n }) => (n === 1 ? "1 asset unpriced" : `${n} assets unpriced`),
    overviewHistory: "History starts after tonight's snapshot.",
    performanceHistory: "Needs two days of history to plot a return.",
    performanceBenchmarks: "Benchmarks arrive with the nightly ingest.",
    allocation: "Nothing to allocate yet.",
    contribution: "Contribution needs history across the period.",
    maturities: "No fixed-income holdings yet. Add a Tesouro Direto, CDB, LCI…",
    assets: "Add what you hold.",
    assetsImport: "or import a CSV — unknown identifiers can be created from the preview.",
    transactions: "No transactions yet.",
    cashFlows: "Deposits and withdrawals are what separate your return from your contributions.",
    login: "Single-owner instance — the account is created with `pnpm bootstrap:user`.",
  },
  screens: {
    overview: {
      title: "Overview",
      headline: "Portfolio value today",
      dayChange: "Day change",
      periodChange: ({ from, to }) => `${from} → ${to}`,
      staleExcluded: ({ n }) => (n === 1 ? "1 stale holding excluded" : `${n} stale holdings excluded`),
      carried: ({ n }) => (n === 1 ? "1 holding carried forward" : `${n} holdings carried forward`),
      allocation: "Allocation by kind",
      movers: "Top movers",
      history: "Value over time",
    },
    performance: {
      title: "Performance",
      period: "Period",
      periods: { "1m": "1M", ytd: "YTD", "1y": "1Y", all: "All" },
      twr: "Time-weighted return",
      mwr: "Money-weighted return",
      twrHelp: "What the portfolio's holdings did, independent of when you deposited or withdrew.",
      mwrHelp: "Your own annualised return, timing of deposits and withdrawals included.",
      benchmarks: "Benchmarks",
      none: "None",
      nominal: "Nominal",
      real: "Real",
      realHelp: ({ series }) => `Deflated by ${series}.`,
      chart: "Cumulative return",
      portfolio: "Portfolio",
      skipped: ({ n }) =>
        n === 1 ? "1 sub-period skipped: no value at its start." : `${n} sub-periods skipped: no value at their start.`,
      ignored: ({ n }) =>
        n === 1
          ? "1 cash flow after the last snapshot is not counted yet."
          : `${n} cash flows after the last snapshot are not counted yet.`,
      droppedFlows: ({ n }) =>
        n === 1
          ? "1 cash flow in another currency could not be converted and is left out."
          : `${n} cash flows in another currency could not be converted and are left out.`,
      excludedDates: ({ n }) =>
        n === 1
          ? "1 day is left out: a holding was stale or unpriced on it."
          : `${n} days are left out: a holding was stale or unpriced on them.`,
      chainSpan: ({ from, to }) => `Figures cover ${from} → ${to}, the dates on which every holding had a value.`,
      mwrReason: {
        insufficient_flows: "Needs a deposit and a later value to solve for.",
        no_root: "No rate solves these flows.",
      },
      over: ({ from, to }) => `${from} → ${to}`,
    },
  },
  errors: {
    title: "Something went wrong",
    body: "This screen could not be rendered. Nothing about your data was changed.",
    retry: "Try again",
    loading: "Loading…",
  },
  saved: "Saved.",
  checkFields: ({ fields }) => ` Check: ${fields}.`,
  reasons: {
    invalid_input: "Some fields were not accepted.",
    not_found: "That row does not exist.",
    unknown_kind: "That instrument kind is not registered in this build.",
    invalid_metadata: "The metadata does not match what this instrument kind needs.",
    duplicate_asset: "You already have an asset with that identity.",
    asset_identity_locked: "This asset has transactions; its identity cannot change. Name and metadata can.",
    asset_has_transactions: "This asset has transactions and cannot be deleted.",
    base_locked:
      "The base currency is locked by your first transaction. Confirm the reset to change it and rebuild history.",
    write_failed: "The change was not saved.",
  },
  security: {
    aal2_required: "Confirm your second factor first: sign out and back in with your authenticator code.",
    invalid_input: "The passwords did not match or were too short (12+ characters).",
    wrong_password: "That password was not accepted.",
    auth_failed: "Auth refused the change.",
    no_factor: "There is no authenticator to remove.",
    code_rejected: "That code was not accepted. Try the next one.",
    factor_exists: "An authenticator is already enrolled. Remove it before enrolling another.",
  },
  restore: {
    done: "Restored.",
    no_file: "Choose a backup file first.",
    invalid_backup: "That file is not a Finance Finder backup.",
    unsupported_version: "That backup was written by a newer version of this app.",
    duplicate_asset_id: "The file lists the same asset twice.",
    foreign_asset_reference: "The file references an asset it does not contain.",
    account_not_empty:
      "Restore only works into an empty account. Delete everything first, or restore into a fresh instance.",
    asset_id_conflict: "An asset id in the file already exists.",
    invalid_rows:
      "The file has a row the database refuses (a negative price, an unknown type). Fix the export and retry.",
    not_authenticated: "Sign in again and retry.",
    write_failed: "The restore was refused.",
    warnings: ({ count, codes }) =>
      `The file has ${count} item(s) this build cannot price (${codes}); they restore as unpriced. Upload again with the box ticked to proceed.`,
  },
  delete: {
    phrase: "Type the phrase exactly, and enter your password.",
    password: "That password was not accepted.",
    failed: "The account could not be deleted.",
  },
  import: {
    no_file: "Choose a CSV file first.",
    too_large: "That file is larger than the 4 MB the import accepts.",
    write_failed: "The upload was not saved.",
    preview_changed: "The file changed since this preview was shown. Review the preview again and commit.",
    rows_have_errors: "Some rows have errors. Nothing was written — fix the file and upload it again.",
    unresolved_identifiers: "Some identifiers are not among your assets. Create them from the preview, then commit.",
    nothing_to_import: "Every row is a duplicate. Nothing was written.",
    not_found: "A row named an asset that is not yours. Nothing was written.",
    invalid_input: "The database refused a row. Nothing was written.",
  },
};
