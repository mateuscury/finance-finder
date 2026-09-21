/**
 * Every string a person reads, as one typed shape (MILESTONES.md §4
 * decision 34). `en.ts` and `pt-BR.ts` each implement `Copy` in full, so a
 * key present in one dictionary and missing in the other is a type error —
 * and `copy.test.ts` proves the key sets are identical at runtime too.
 *
 * Groups fill in as screens are designed (Milestone 4 Phases 2–5). A leaf is
 * a string, or a function of named parameters when a count or a name is
 * interpolated; never a template a screen assembles from fragments, because
 * the two languages order their words differently.
 */
import type { SecurityReason } from "@/lib/auth/security";
import type { DatabaseRestoreRefusal, RestoreRefusal } from "@/lib/backup";
import type { CommitRefusal } from "@/lib/import/commit";
import type { ActionReason } from "@/lib/ledger/result";
import type { UnpricedReason } from "@/lib/calc/staleness";

/** Every closed reason a figure can be undefined for: the kernel's unpriced reasons plus the performance modules' own. */
export type ReasonCode = UnpricedReason | "stale" | "zero_start_value" | "no_position";

/** The outcome codes the import page shows, beyond the commit planner's own. */
export type ImportOutcome = CommitRefusal | "no_file" | "too_large" | "write_failed" | "not_found" | "invalid_input";
/** The outcome codes Settings shows for a restore, beyond the planner's and the database's own. */
export type RestoreOutcome = RestoreRefusal | DatabaseRestoreRefusal | "done" | "no_file" | "write_failed";
export type DeleteOutcome = "phrase" | "password" | "failed";

export interface Copy {
  /** The shell (SPEC §9.2): route labels in the two groups, the toggles, sign out. */
  nav: {
    skipToContent: string;
    analysis: string;
    ledger: string;
    overview: string;
    performance: string;
    allocation: string;
    contribution: string;
    maturities: string;
    assets: string;
    transactions: string;
    cashFlows: string;
    settings: string;
    menu: string;
    signOut: string;
    theme: string;
    themeSystem: string;
    themeLight: string;
    themeDark: string;
    /** The privacy toggle's label and the hidden-amount announcement (SPEC §12.3). */
    privacy: string;
    privacyOn: string;
    privacyOff: string;
    amountHidden: string;
  };
  /** The value-status marks of SPEC §11 and §9.5. */
  status: {
    ok: string;
    carriedForward: (p: { date: string }) => string;
    stale: (p: { date: string }) => string;
    unpriced: string;
    unpricedReason: (p: { reason: string }) => string;
    accrues: string;
    /** A phrase per closed reason code, for a table cell or a banner. */
    reasons: Record<ReasonCode, string>;
  };
  /** The status strip (SPEC §9.2): present only when something is pending. */
  strip: {
    label: string;
    unpriced: (p: { n: number }) => string;
    rebuilding: (p: { from: string; through: string | null; target: string }) => string;
    sourceDisabled: (p: { sourceId: string; variable: string }) => string;
    exportNudge: (p: { lastExportAt: string | null }) => string;
    refresh: string;
    refreshing: string;
    dismiss: string;
  };
  /** SPEC §9.3: the first-run card, one step per row of the table. */
  firstRun: {
    title: string;
    baseCurrency: (p: { currency: string }) => string;
    firstAsset: string;
    firstTransaction: string;
    priced: string;
    pricedPending: (p: { n: number }) => string;
    done: string;
  };
  /** SPEC §9.5: the empty states, verbatim. */
  empty: {
    overviewHeadline: (p: { n: number }) => string;
    overviewHistory: string;
    performanceHistory: string;
    performanceBenchmarks: string;
    allocation: string;
    contribution: string;
    maturities: string;
    assets: string;
    assetsImport: string;
    transactions: string;
    cashFlows: string;
    login: string;
  };
  /** Per-screen strings, filled as each screen is designed (Milestone 4 Phases 2–5). */
  screens: {
    overview: {
      title: string;
      headline: string;
      dayChange: string;
      periodChange: (p: { from: string; to: string }) => string;
      staleExcluded: (p: { n: number }) => string;
      carried: (p: { n: number }) => string;
      allocation: string;
      movers: string;
      history: string;
    };
    performance: {
      title: string;
      period: string;
      periods: Record<"1m" | "ytd" | "1y" | "all", string>;
      twr: string;
      mwr: string;
      twrHelp: string;
      mwrHelp: string;
      benchmarks: string;
      none: string;
      nominal: string;
      real: string;
      realHelp: (p: { series: string }) => string;
      chart: string;
      portfolio: string;
      skipped: (p: { n: number }) => string;
      ignored: (p: { n: number }) => string;
      droppedFlows: (p: { n: number }) => string;
      excludedDates: (p: { n: number }) => string;
      chainSpan: (p: { from: string; to: string }) => string;
      mwrReason: Record<"insufficient_flows" | "no_root", string>;
      over: (p: { from: string; to: string }) => string;
    };
    allocation: {
      title: string;
      asOf: (p: { date: string }) => string;
      byKind: string;
      byPack: string;
      byCurrency: string;
      exposure: string;
      currency: string;
      native: string;
      base: string;
      stale: string;
      unresolved: (p: { n: number }) => string;
    };
    contribution: {
      title: string;
      help: string;
      total: string;
      gain: string;
      share: string;
      partial: string;
      reason: (p: { reason: string; n: number }) => string;
      drillIn: string;
      attribution: string;
      attributionHelp: string;
      rNative: string;
      rFx: string;
      rBase: string;
      identity: string;
      baseCurrencyNote: string;
      bdrGap: string;
      noPosition: string;
      back: string;
      chained: (p: { n: number }) => string;
    };
    maturities: {
      title: string;
      help: string;
      asOf: (p: { date: string }) => string;
      ladder: string;
      timeline: string;
      maturity: string;
      daysToGo: (p: { n: number }) => string;
      current: string;
      atMaturity: string;
      dependsOnIndex: string;
      navNoProjection: string;
      matured: string;
      recordRedemption: string;
      noValueToday: string;
    };
    /** The asset form (SPEC §9 screen 6): pack → kind → generated metadata fields → currency. */
    assetForm: {
      pack: string;
      kind: string;
      identifier: string;
      identifierHint: Record<"ticker" | "isin" | "custom", string>;
      name: string;
      nativeCurrency: string;
      metadata: string;
      noMetadata: string;
      optional: string;
      saving: string;
      locked: string;
      packStatus: Record<"draft" | "supported" | "unmaintained", string>;
    };
    pager: {
      label: string;
      previous: string;
      next: string;
      of: (p: { page: number; pages: number; total: number }) => string;
    };
    assets: {
      title: string;
      add: string;
      addButton: string;
      edit: (p: { identifier: string }) => string;
      editLink: string;
      save: string;
      delete: string;
      columns: { asset: string; kind: string; currency: string; value: string; actions: string };
      unknownKind: (p: { kind: string }) => string;
      priced: (p: { source: string; date: string }) => string;
      retry: string;
      enterPrice: string;
      prices: string;
      pricesHelp: string;
      manualPrice: string;
      priceDate: string;
      price: string;
      setPrice: string;
      removePrice: (p: { date: string }) => string;
      backToList: string;
    };
    transactions: {
      title: string;
      add: string;
      addButton: string;
      edit: string;
      save: string;
      delete: string;
      import: string;
      addAssetFirst: string;
      imported: (p: { n: number; skipped: number }) => string;
      columns: {
        date: string;
        asset: string;
        type: string;
        quantity: string;
        unitPrice: string;
        fees: string;
        note: string;
        actions: string;
      };
      types: Record<"buy" | "sell" | "dividend" | "interest" | "fee", string>;
      typeHelp: Record<"buy" | "sell" | "dividend" | "interest" | "fee", string>;
      fields: {
        asset: string;
        date: string;
        type: string;
        quantity: string;
        unitPrice: string;
        currency: string;
        fees: string;
        note: string;
      };
      fxNote: string;
    };
    import: {
      title: string;
      back: string;
      steps: { upload: string; map: string; preview: string; commit: string };
      formatTitle: string;
      formatHelp: string;
      chooseFile: string;
      upload: string;
      unparsable: (p: { filename: string; reason: string; line: number }) => string;
      discard: string;
      file: (p: { filename: string; rows: number }) => string;
      mapTitle: string;
      mapHelp: string;
      required: string;
      notInFile: string;
      saveMapping: string;
      mappingSaved: string;
      missingColumns: (p: { columns: string }) => string;
      previewTitle: string;
      counts: (p: { total: number; valid: number; errors: number; unresolved: number; duplicates: number }) => string;
      unresolvedTitle: string;
      unresolvedRows: (p: { pack: string; kind: string; identifier: string; rows: string }) => string;
      unregisteredKind: string;
      createAsset: string;
      columns: {
        row: string;
        date: string;
        type: string;
        identifier: string;
        quantity: string;
        unitPrice: string;
        fees: string;
        status: string;
      };
      status: {
        ready: string;
        error: (p: { fields: string }) => string;
        unresolved: string;
        duplicate: string;
        include: string;
      };
      commitHelp: string;
      commit: (p: { n: number }) => string;
    };
    /** Screen 8: deposits and withdrawals in the base currency (decision 25). */
    cashFlows: {
      title: string;
      editTitle: string;
      columns: { date: string; amount: string; note: string; actions: string };
      fields: { date: string; amount: string; note: string };
      /** The base currency is shown, not chosen: "Amount in BRL". */
      amountIn: (p: { currency: string }) => string;
      signRule: string;
      add: string;
      addButton: string;
      saveButton: string;
      edit: string;
      delete: string;
      backToList: string;
    };
    /** Screen 9 in its three sections (SPEC §9, §9.6, §12.3). */
    settings: {
      title: string;
      portfolio: {
        title: string;
        baseCurrency: string;
        baseCurrencyHelp: string;
        confirmReset: string;
        saveBaseCurrency: string;
        packs: string;
        packsHelp: string;
        packCounts: (p: { instruments: number; series: number }) => string;
        /** PACKS.md §12: what "draft" means to the person enabling it. */
        draftNote: string;
        unmaintainedNote: string;
        savePacks: string;
        preferences: string;
        theme: string;
        language: string;
        savePreferences: string;
      };
      security: {
        title: string;
        signedInAs: (p: { who: string; level: string }) => string;
        levels: { aal1: string; aal2: string };
        password: string;
        newPassword: string;
        confirmPassword: string;
        passwordRule: string;
        changePassword: string;
        secondFactor: string;
        enrolled: string;
        removeFactor: string;
        /** The recovery line; the command is rendered in <code> around this text. */
        recoveryBefore: string;
        recoveryAfter: string;
        notEnrolled: string;
        sessions: string;
        signOutEverywhere: string;
        /** Strings only (no functions): they cross into the client widget as props. */
        enrol: {
          start: string;
          starting: string;
          failed: string;
          scan: string;
          qrAlt: string;
          secret: string;
          code: string;
          confirm: string;
        };
      };
      data: {
        title: string;
        /** SPEC §12.1, the disclosure paragraph. */
        disclosure: string;
        lastExport: (p: { date: string | null }) => string;
        noBackups: string;
        downloadJson: string;
        downloadCsv: string;
        restoreTitle: string;
        restoreHelp: string;
        restoreFile: string;
        acknowledge: string;
        restoreButton: string;
        deleteTitle: string;
        /** The phrase itself is rendered in <code> between these two parts. */
        deleteBefore: string;
        deleteAfter: string;
        phrase: string;
        password: string;
        deleteButton: string;
      };
    };
    /** Screen 10 and its two companions (SPEC §9.6). */
    login: {
      title: string;
      email: string;
      password: string;
      /** The uniform failure line: never says which of the two was wrong. */
      failed: string;
      signIn: string;
      forgot: string;
      mfa: {
        title: string;
        code: string;
        failed: string;
        verify: string;
      };
      reset: {
        title: string;
        email: string;
        send: string;
        /** Always the same answer, whether or not the address has an account. */
        sentBefore: string;
        sentAfter: string;
        back: string;
        completeTitle: string;
        newPassword: string;
        confirm: string;
        failed: string;
        set: string;
      };
    };
  };
  /** Fixed copy of the error boundary and the loading state — never a detail. */
  errors: {
    title: string;
    body: string;
    retry: string;
    loading: string;
  };
  /** This language's own name, for the language select (decision 34). */
  languageName: string;
  /** The one line under a saved form. */
  saved: string;
  /** "Check: a, b." after a field-level refusal. */
  checkFields: (p: { fields: string }) => string;
  /** One line per `ActionReason` (lib/ledger/result.ts). */
  reasons: Record<ActionReason, string>;
  /** One line per `SecurityReason`, plus the one-factor refusal. */
  security: Record<SecurityReason | "factor_exists", string>;
  restore: Record<RestoreOutcome, string> & {
    /** The warnings acknowledgement line: N items this build cannot price. */
    warnings: (p: { count: number; codes: string }) => string;
  };
  delete: Record<DeleteOutcome, string>;
  import: Record<ImportOutcome, string>;
}
