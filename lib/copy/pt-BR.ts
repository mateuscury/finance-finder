import type { Copy } from "./types";

/**
 * Português do Brasil. Tratamento por "você"; vocabulário do investidor
 * pessoa física como as corretoras o usam (cotação, aporte, resgate,
 * carteira). Uma tradução das mesmas chaves de `en.ts`, nunca um texto
 * diferente.
 */
export const ptBR: Copy = {
  nav: {
    skipToContent: "Pular para o conteúdo",
    analysis: "Análise",
    ledger: "Lançamentos",
    overview: "Visão geral",
    performance: "Desempenho",
    allocation: "Alocação",
    contribution: "Contribuição",
    maturities: "Vencimentos",
    assets: "Ativos",
    transactions: "Transações",
    cashFlows: "Aportes e resgates",
    settings: "Configurações",
    menu: "Menu",
    signOut: "Sair",
    theme: "Tema",
    themeSystem: "Sistema",
    themeLight: "Claro",
    themeDark: "Escuro",
    privacy: "Ocultar valores",
    privacyOn: "Valores ocultos",
    privacyOff: "Valores visíveis",
    amountHidden: "oculto",
  },
  status: {
    ok: "atualizado",
    carriedForward: ({ date }) => `repetido de ${date}`,
    stale: ({ date }) => `desatualizado — último valor em ${date}, fora dos totais`,
    unpriced: "sem preço",
    unpricedReason: ({ reason }) => `sem preço — ${reason}`,
    accrues: "rende",
    reasons: {
      no_observation: "sem observação na data ou antes",
      series_gap: "falta um dia da série do índice",
      before_first_anchor: "antes da primeira observação do índice",
      no_fx_series: "nenhuma série de câmbio liga as moedas",
      no_price: "sem preço na data ou antes",
      indexation_not_supported: "títulos indexados marcados a curva ainda não são suportados",
      invalid_metadata: "os metadados não cabem no tipo",
      matured: "vencido",
      not_a_return_series: "uma curva não tem um retorno único",
      stale: "desatualizado em uma das pontas do período",
      zero_start_value: "nada estava investido no início",
      no_position: "não mantido no período",
    },
  },
  strip: {
    label: "Situação",
    unpriced: ({ n }) => (n === 1 ? "1 ativo sem preço" : `${n} ativos sem preço`),
    rebuilding: ({ from, through, target }) => `histórico em reconstrução ${from} → ${through ?? "…"} de ${target}`,
    sourceDisabled: ({ sourceId, variable }) => `fonte ${sourceId} desativada: ${variable} não definida`,
    exportNudge: ({ lastExportAt }) =>
      lastExportAt
        ? `última exportação em ${lastExportAt.slice(0, 10)} — exporte um backup`
        : "nenhum backup ainda — exporte um",
    refresh: "Atualizar",
    refreshing: "Buscando em segundo plano; recarregue em instantes.",
    dismiss: "Dispensar",
  },
  firstRun: {
    title: "Monte sua carteira",
    baseCurrency: ({ currency }) => `Moeda base: ${currency} — troque antes da primeira transação; depois ela trava.`,
    firstAsset: "Adicione o que você tem: pacote → tipo de instrumento → identificador.",
    firstTransaction: "Lance uma à mão, ou importe um CSV do seu histórico.",
    priced: "Precificado — preenche sozinho assim que uma fonte responder.",
    pricedPending: ({ n }) =>
      n === 1
        ? "1 ativo aguarda preço. Se uma fonte estiver desativada ou falhando, a linha de situação avisa; um preço manual é sempre possível."
        : `${n} ativos aguardam preço. Se uma fonte estiver desativada ou falhando, a linha de situação avisa; um preço manual é sempre possível.`,
    done: "feito",
  },
  empty: {
    overviewHeadline: ({ n }) => (n === 1 ? "1 ativo sem preço" : `${n} ativos sem preço`),
    overviewHistory: "O histórico começa depois da foto de hoje à noite.",
    performanceHistory: "Precisa de dois dias de histórico para traçar um retorno.",
    performanceBenchmarks: "Os índices chegam com a coleta noturna.",
    allocation: "Nada para alocar ainda.",
    contribution: "A contribuição precisa de histórico ao longo do período.",
    maturities: "Nenhuma renda fixa ainda. Adicione um Tesouro Direto, CDB, LCI…",
    assets: "Adicione o que você tem.",
    assetsImport: "ou importe um CSV — identificadores desconhecidos podem ser criados a partir da prévia.",
    transactions: "Nenhuma transação ainda.",
    cashFlows: "Aportes e resgates são o que separa seu retorno das suas contribuições.",
    login: "Instância de dono único — a conta é criada com `pnpm bootstrap:user`.",
  },
  screens: {
    overview: {
      title: "Visão geral",
      headline: "Valor da carteira hoje",
      dayChange: "Variação do dia",
      periodChange: ({ from, to }) => `${from} → ${to}`,
      staleExcluded: ({ n }) =>
        n === 1 ? "1 posição desatualizada fora do total" : `${n} posições desatualizadas fora do total`,
      carried: ({ n }) => (n === 1 ? "1 posição com valor repetido" : `${n} posições com valor repetido`),
      allocation: "Alocação por tipo",
      movers: "Maiores variações",
      history: "Valor ao longo do tempo",
    },
    performance: {
      title: "Desempenho",
      period: "Período",
      periods: { "1m": "1M", ytd: "No ano", "1y": "1A", all: "Tudo" },
      twr: "Retorno ponderado pelo tempo",
      mwr: "Retorno ponderado pelo dinheiro",
      twrHelp: "O que os ativos da carteira fizeram, independentemente de quando você aportou ou resgatou.",
      mwrHelp: "Seu retorno anualizado, com o momento dos aportes e resgates incluído.",
      benchmarks: "Índices",
      none: "Nenhum",
      nominal: "Nominal",
      real: "Real",
      realHelp: ({ series }) => `Deflacionado por ${series}.`,
      chart: "Retorno acumulado",
      portfolio: "Carteira",
      skipped: ({ n }) =>
        n === 1 ? "1 subperíodo ignorado: sem valor no início." : `${n} subperíodos ignorados: sem valor no início.`,
      ignored: ({ n }) =>
        n === 1
          ? "1 aporte/resgate depois da última foto ainda não conta."
          : `${n} aportes/resgates depois da última foto ainda não contam.`,
      droppedFlows: ({ n }) =>
        n === 1
          ? "1 aporte/resgate em outra moeda não pôde ser convertido e ficou de fora."
          : `${n} aportes/resgates em outra moeda não puderam ser convertidos e ficaram de fora.`,
      excludedDates: ({ n }) =>
        n === 1
          ? "1 dia ficou de fora: uma posição estava desatualizada ou sem preço nele."
          : `${n} dias ficaram de fora: uma posição estava desatualizada ou sem preço neles.`,
      chainSpan: ({ from, to }) => `Os números cobrem ${from} → ${to}, os dias em que toda posição tinha valor.`,
      mwrReason: {
        insufficient_flows: "Precisa de um aporte e de um valor posterior para resolver.",
        no_root: "Nenhuma taxa resolve esses fluxos.",
      },
      over: ({ from, to }) => `${from} → ${to}`,
    },
    allocation: {
      title: "Alocação",
      asOf: ({ date }) => `Em ${date}, pela última foto.`,
      byKind: "Por tipo de instrumento",
      byPack: "Por mercado",
      byCurrency: "Por moeda",
      exposure: "Exposição",
      currency: "Moeda",
      native: "Valor na moeda",
      base: "Na moeda base",
      stale: "Desatualizado — exibido, não alocado",
      unresolved: ({ n }) =>
        n === 1
          ? "1 posição é de um tipo que esta versão não conhece; conta pelo id."
          : `${n} posições são de tipos que esta versão não conhece; contam pelo id.`,
    },
    contribution: {
      title: "Contribuição",
      help: "A parte de cada posição no retorno simples do período: o ganho dela sobre o valor inicial mais o que você aportou. As partes somam o retorno.",
      total: "Retorno simples",
      gain: "Ganho",
      share: "Contribuição",
      partial: "Parcial: algumas posições não puderam ser medidas neste período, então o total as deixa de fora.",
      reason: ({ reason, n }) => (n === 1 ? `1 posição: ${reason}` : `${n} posições: ${reason}`),
      drillIn: "Ativo vs. câmbio",
      attribution: "Atribuição",
      attributionHelp:
        "O retorno desta posição separado entre o que o ativo fez na própria moeda e o que o câmbio fez.",
      rNative: "Ativo, na própria moeda",
      rFx: "Câmbio",
      rBase: "Na sua moeda base",
      identity: "(1 + base) = (1 + ativo) × (1 + câmbio)",
      baseCurrencyNote: "Cotado na sua moeda base, então o câmbio contribuiu exatamente zero.",
      bdrGap:
        "Um ativo cotado na sua moeda base sobre um lastro estrangeiro mostra zero aqui: o efeito do câmbio está dentro do preço, e esta versão não o separa.",
      noPosition: "Não mantido neste período.",
      back: "Todas as posições",
      chained: ({ n }) =>
        n === 1 ? "1 subperíodo encadeado." : `${n} subperíodos encadeados nas datas de transação desta posição.`,
    },
  },
  errors: {
    title: "Algo deu errado",
    body: "Esta tela não pôde ser exibida. Nada nos seus dados foi alterado.",
    retry: "Tentar de novo",
    loading: "Carregando…",
  },
  saved: "Salvo.",
  checkFields: ({ fields }) => ` Verifique: ${fields}.`,
  reasons: {
    invalid_input: "Alguns campos não foram aceitos.",
    not_found: "Esse registro não existe.",
    unknown_kind: "Esse tipo de instrumento não está registrado nesta versão.",
    invalid_metadata: "Os metadados não correspondem ao que esse tipo de instrumento exige.",
    duplicate_asset: "Você já tem um ativo com essa identidade.",
    asset_identity_locked: "Este ativo tem transações; sua identidade não pode mudar. Nome e metadados podem.",
    asset_has_transactions: "Este ativo tem transações e não pode ser excluído.",
    base_locked:
      "A moeda base foi travada pela sua primeira transação. Confirme a redefinição para trocá-la e reconstruir o histórico.",
    write_failed: "A alteração não foi salva.",
  },
  security: {
    aal2_required: "Confirme seu segundo fator primeiro: saia e entre de novo com o código do autenticador.",
    invalid_input: "As senhas não conferem ou são curtas demais (mínimo de 12 caracteres).",
    wrong_password: "Essa senha não foi aceita.",
    auth_failed: "A autenticação recusou a alteração.",
    no_factor: "Não há autenticador para remover.",
    code_rejected: "Esse código não foi aceito. Tente o próximo.",
    factor_exists: "Já existe um autenticador cadastrado. Remova-o antes de cadastrar outro.",
  },
  restore: {
    done: "Restaurado.",
    no_file: "Escolha um arquivo de backup primeiro.",
    invalid_backup: "Esse arquivo não é um backup do Finance Finder.",
    unsupported_version: "Esse backup foi gerado por uma versão mais nova deste aplicativo.",
    duplicate_asset_id: "O arquivo lista o mesmo ativo duas vezes.",
    foreign_asset_reference: "O arquivo referencia um ativo que ele não contém.",
    account_not_empty:
      "A restauração só funciona em uma conta vazia. Exclua tudo primeiro, ou restaure em uma instância nova.",
    asset_id_conflict: "Um id de ativo do arquivo já existe.",
    invalid_rows:
      "O arquivo tem uma linha que o banco recusa (um preço negativo, um tipo desconhecido). Corrija a exportação e tente de novo.",
    not_authenticated: "Entre de novo e tente novamente.",
    write_failed: "A restauração foi recusada.",
    warnings: ({ count, codes }) =>
      `O arquivo tem ${count} item(ns) que esta versão não consegue precificar (${codes}); eles serão restaurados sem preço. Envie de novo com a caixa marcada para prosseguir.`,
  },
  delete: {
    phrase: "Digite a frase exatamente, e informe sua senha.",
    password: "Essa senha não foi aceita.",
    failed: "A conta não pôde ser excluída.",
  },
  import: {
    no_file: "Escolha um arquivo CSV primeiro.",
    too_large: "Esse arquivo é maior que os 4 MB que a importação aceita.",
    write_failed: "O envio não foi salvo.",
    preview_changed: "O arquivo mudou desde que esta prévia foi exibida. Revise a prévia de novo e confirme.",
    rows_have_errors: "Algumas linhas têm erros. Nada foi gravado — corrija o arquivo e envie de novo.",
    unresolved_identifiers:
      "Alguns identificadores não estão entre seus ativos. Crie-os a partir da prévia e confirme.",
    nothing_to_import: "Todas as linhas são duplicadas. Nada foi gravado.",
    not_found: "Uma linha citou um ativo que não é seu. Nada foi gravado.",
    invalid_input: "O banco recusou uma linha. Nada foi gravado.",
  },
};
