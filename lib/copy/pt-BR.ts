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
