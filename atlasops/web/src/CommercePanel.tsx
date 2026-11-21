import React, {
  useCallback,
  useEffect,
  useState
} from 'react';

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet
} from 'lucide-react';

import {
  api,
  money,
  type Session
} from './api';

import './commerce.css';

type Plan = {
  code: 'starter' | 'growth' | 'scale';
  name: string;
  amount: number;
  seats: number;
  description: string;
};

type Legal = {
  legalName: string;
  nuit: string;
  address: string;
  contact: string;
  version: string;
};

type PublicConfig = {
  plans: Plan[];
  currency: string;
  provider: string;
  testMode: boolean;
  checkoutEnabled: boolean;
  legalReady: boolean;
  legal: Legal;
  note: string;
};

type Order = {
  id: string;
  plan_code: string;
  amount_mzn: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  checkout_url: string | null;
};

type State = PublicConfig & {
  subscription: {
    plan_code: string;
    status: string;
    trial_ends_at: string;
    current_period_end: string | null;
  };

  access: boolean;
  orders: Order[];

  company: {
    legal_name: string;
    nuit: string;
    billing_email: string;
    billing_address: string;
  } | null;
};

const fmt = (
  d: string | null | undefined
) =>
  d
    ? new Date(d).toLocaleDateString(
        'pt-MZ',
        {
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        }
      )
    : '—';

function Pill({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <span className="c-pill">
      {children}
    </span>
  );
}

function Layout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="c-page">
      <div className="c-wrap">
        {children}
      </div>
    </div>
  );
}

function Notice({
  error
}: {
  error: string
}) {
  return (
    <div role="alert" className="c-alert">
      {error}
    </div>
  );
}

// =====================================================
// POLICIES
// =====================================================

function LegalDocuments({
  info
}: {
  info: Legal
}) {

  const contact =
    info.contact ||
    '[EMAIL DE CONTACTO POR PREENCHER]';

  const who =
    info.legalName ||
    '[ENTIDADE LEGAL POR PREENCHER]';

  return (
    <section
      className="c-legal"
      id="legal-docs"
    >

      <div className="c-section-head">
        <Pill>
          GOVERNAÇÃO E CONFORMIDADE
        </Pill>

        <h2>Documentos e políticas</h2>

        <p>
          Versão {info.version}.
          Estes textos são minutas comerciais
          e precisam de revisão jurídica
          antes de publicação definitiva.
        </p>
      </div>

      <details id="terms">
        <summary>
          Termos e condições de utilização
        </summary>

        <div className="c-legal-copy">
          <p>
            O AtlasOps é um serviço de software
            empresarial operado por {who},
            NUIT {info.nuit || '[PENDENTE]'},
            com sede em{' '}
            {info.address || '[MORADA PENDENTE]'}.
            Contacto: {contact}.
          </p>

          <p>
            O cliente é responsável por
            administrar utilizadores, garantir
            que tem autorização para tratar
            os dados inseridos e utilizar
            as funcionalidades em conformidade
            com a legislação aplicável.
            O AtlasOps fornece ferramentas
            de registo, análise e organização;
            não garante um aumento de vendas,
            receitas ou lucros.
          </p>

          <p>
            Os planos são pagos antecipadamente
            por períodos mensais, sem renovação
            automática ou débito recorrente.
            O acesso pode ficar suspenso
            após a data de validade.
            As funcionalidades que dependem
            de terceiros, nomeadamente
            operadoras móveis, gravações
            autorizadas e IA, só estão
            disponíveis mediante integração
            e consentimentos adequados.
          </p>

          <p>
            É proibido usar o sistema para
            vigilância oculta, interceção não
            autorizada de comunicações,
            fraude, spam ou tratamento de
            dados sem base legal.
            O cliente pode solicitar apoio,
            exportação ou eliminação de dados
            através de {contact},
            sujeito a obrigações legais
            de conservação.
          </p>
        </div>
      </details>

      <details id="privacy">
        <summary>
          Política de privacidade e tratamento de dados
        </summary>

        <div className="c-legal-copy">
          <p>
            O AtlasOps trata dados de registo
            e conta, identificadores empresariais,
            faturação, autenticação, registos
            operacionais e comerciais, métricas,
            registos de auditoria e, quando
            autorizado, metadados de chamadas
            e transcrições fornecidas por
            fontes legítimas.
          </p>

          <p>
            O cliente empresarial decide que
            dados operacionais introduz e deve
            informar os seus funcionários
            e contactos.
            O prestador trata os dados para
            fornecer, proteger e manter o
            serviço, gerir pagamentos,
            prestar suporte e cumprir
            obrigações legais.
            Apenas pessoal autorizado e
            fornecedores contratados devem
            ter acesso necessário para
            essas finalidades.
          </p>

          <p>
            O acesso é limitado por organização
            e perfil.
            O AtlasOps não deve ser descrito
            como gravando automaticamente
            chamadas SIM, verificando custos
            com operadoras ou analisando
            áudio sem uma integração
            realmente ativada.
            Contactos podem solicitar informação
            ou exercer direitos aplicáveis
            através de {contact}.
          </p>

          <p>
            Conservação, transferências
            internacionais, subprocessadores,
            incidentes de segurança e pedidos
            de eliminação devem ser
            especificados no acordo de
            tratamento de dados da empresa
            antes da operação comercial.
            Não são prometidos prazos fixos
            de conservação sem configuração
            técnica correspondente.
          </p>
        </div>
      </details>

      <details id="billing-policy">
        <summary>
          Faturação, cancelamento e reembolsos
        </summary>

        <div className="c-legal-copy">
          <p>
            Os valores exibidos são propostas
            de preço em MZN para acesso
            durante um mês.
            Impostos aplicáveis e condições
            comerciais definitivas serão
            identificados na documentação
            emitida pela entidade vendedora.
            Não existe cobrança automática
            no fim do período.
          </p>

          <p>
            A confirmação do pagamento é
            obtida no servidor diretamente
            do prestador, não por uma imagem,
            captura de ecrã ou clique do
            comprador.
            Falhas e pagamentos pendentes
            não concedem acesso pago.
            Pedidos de cancelamento ou
            reembolso serão analisados
            segundo o contrato celebrado
            e a lei aplicável;
            contacte {contact} com a
            referência do pedido.
          </p>

          <p>
            Os registos de pedidos na
            plataforma são comprovativos
            operacionais, não substituem
            faturas fiscais ou recibos
            legalmente exigíveis.
            O prestador é responsável por
            emitir documentos fiscais
            apropriados fora deste módulo
            enquanto não existir integração
            fiscal certificada.
          </p>
        </div>
      </details>

      <details id="monitoring">
        <summary>
          Política de monitorização, IA e utilização aceitável
        </summary>

        <div className="c-legal-copy">
          <p>
            A monitorização de atividades
            deve ser proporcional,
            transparente, relacionada com
            fins empresariais legítimos
            e comunicada antecipadamente
            às pessoas afetadas.
            O cliente deve definir funções,
            permissões e acesso aos dados
            em conformidade com a lei.
          </p>

          <p>
            Chamadas registadas manualmente
            não são provas verificadas pela
            operadora.
            Dados de dispositivo e faturação
            só são apresentados como
            independentes quando a origem
            o justifica.
            Gravação, transcrição e
            processamento de voz exigem
            autorização apropriada e
            disponibilidade técnica.
          </p>

          <p>
            É vedado contornar proteções do
            sistema, aceder a dados de outras
            empresas, fazer interceção ilegal
            ou usar relatórios automatizados
            como única base para decisões
            prejudiciais sobre trabalhadores.
          </p>
        </div>
      </details>

    </section>
  );
}

// =====================================================
// PLAN CARDS
// =====================================================

function PlanCards({
  plans,
  onChoose,
  selected
}: {
  plans: Plan[];
  onChoose?: (code: Plan['code']) => void;
  selected?: string;
}) {

  return (
    <div className="c-plans">

      {plans.map(plan => (
        <article
          key={plan.code}
          className={
            'c-plan ' +
            (plan.code === 'growth' ? 'featured ' : '') +
            (selected === plan.code ? 'selected' : '')
          }
        >

          {plan.code === 'growth' && (
            <div className="c-popular">
              RECOMENDADO
            </div>
          )}

          <h3>{plan.name}</h3>

          <p>{plan.description}</p>

          <div className="c-price">
            {money(plan.amount)}
            <small> / mês</small>
          </div>

          <ul>
            <li>
              <CheckCircle2 size={16}/>
              Até {plan.seats} contas empresariais
            </li>

            <li>
              <CheckCircle2 size={16}/>
              CRM, vendas e tarefas
            </li>

            <li>
              <CheckCircle2 size={16}/>
              Receitas, despesas e relatórios
            </li>

            <li>
              <CheckCircle2 size={16}/>
              Perfis de acesso e auditoria
            </li>
          </ul>

          {onChoose ? (
            <button
              type="button"
              className={
                'c-button ' +
                (selected === plan.code ? 'light' : '')
              }
              onClick={() => onChoose(plan.code)}
            >
              {selected === plan.code
                ? 'Plano selecionado'
                : 'Escolher plano'}

              <ArrowRight size={16}/>
            </button>
          ) : (
            <span className="c-price-note">
              Disponível após criar a conta
            </span>
          )}

        </article>
      ))}

    </div>
  );
}

// =====================================================
// PUBLIC PRICING
// =====================================================

export function PublicPlans({
  onBack,
  onStart
}: {
  onBack: () => void;
  onStart: () => void;
}) {

  const [cfg, setCfg] =
    useState<PublicConfig | null>(null);

  const [error, setError] =
    useState('');

  useEffect(() => {
    api<PublicConfig>(
      '/billing/public'
    )
      .then(setCfg)
      .catch(e => setError(e.message));
  }, []);

  return (
    <Layout>

      <header className="c-nav">
        <strong>
          <Activity size={23}/>
          ATLASOPS
        </strong>

        <button
          className="c-link"
          onClick={onBack}
        >
          <ArrowLeft size={16}/>
          Voltar ao acesso
        </button>
      </header>

      <div className="c-hero">
        <Pill>
          PLATAFORMA DE INTELIGÊNCIA OPERACIONAL
        </Pill>

        <h1>
          Planos transparentes.
          <br/>
          <em>Operações mais claras.</em>
        </h1>

        <p>
          Escolha uma capacidade adequada
          à equipa.
          Preços mensais indicativos,
          sem débito automático,
          em meticais.
        </p>
      </div>

      {error && (
        <Notice error={error}/>
      )}

      {cfg && (
        <>
          <PlanCards plans={cfg.plans}/>

          <div className="c-center">
            <button
              className="c-button"
              onClick={onStart}
            >
              Criar empresa e escolher plano
              <ArrowRight size={17}/>
            </button>
          </div>

          <div className="c-disclaimer">
            <ShieldCheck size={18}/>

            Para equipas acima de 60 utilizadores
            ou necessidades personalizadas,
            solicite uma proposta comercial.

            Análises de chamadas,
            custos verificados e IA
            dependem de integrações autorizadas.
            Acesso comercial sujeito a ativação.
          </div>

          <LegalDocuments info={cfg.legal}/>
        </>
      )}

    </Layout>
  );
}

// =====================================================
// AUTHENTICATED BILLING DASHBOARD
// =====================================================

export default function CommercePanel({
  session,
  onExit
}: {
  session: Session;
  onExit?: () => void;
}) {

  const [data, setData] =
    useState<State | null>(null);

  const [err, setErr] =
    useState('');

  const [busy, setBusy] =
    useState(false);

  const [selected, setSelected] =
    useState<Plan['code']>('growth');

  const [accepted, setAccepted] =
    useState(false);

  const [privacy, setPrivacy] =
    useState(false);

  const [profile, setProfile] = useState({
    legalName: '',
    nuit: '',
    billingEmail: session.user.email,
    billingAddress: ''
  });

  const owner =
    session.user.role === 'owner';

  const refresh = useCallback(
    async () => {

      try {
        const s = await api<State>(
          '/billing/status'
        );

        setData(s);

        setSelected(p =>
          s.plans.some(v => v.code === p)
            ? p
            : s.subscription.plan_code as Plan['code']
        );

        if (s.company) {
          setProfile({
            legalName: s.company.legal_name,
            nuit: s.company.nuit,
            billingEmail: s.company.billing_email,
            billingAddress: s.company.billing_address
          });
        }

        setErr('');

      } catch (e) {
        setErr(
          e instanceof Error
            ? e.message
            : 'Falha ao consultar faturação.'
        );
      }
    },
    []
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (
    fn: () => Promise<void>
  ) => {

    setBusy(true);
    setErr('');

    try {
      await fn();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : 'Ocorreu um erro.'
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      await api(
        '/billing/company',
        'PUT',
        profile
      );

      await refresh();
    });

  const checkout = () =>
    act(async () => {

      const r = await api<{
        checkoutUrl: string;
        testMode: boolean;
      }>(
        '/billing/checkout',
        'POST',
        {
          plan: selected,
          acceptTerms: accepted,
          acceptPrivacy: privacy
        }
      );

      if (
        !r.checkoutUrl.startsWith(
          'https://checkout.epay.co.mz/'
        )
      ) {
        throw new Error(
          'URL de pagamento inválida'
        );
      }

      window.location.assign(
        r.checkoutUrl
      );
    });

  const verify = (id: string) =>
    act(async () => {
      await api(
        '/billing/verify',
        'POST',
        {
          orderId: id
        }
      );

      await refresh();
    });

  return (
    <Layout>

      <header className="c-nav">

        <strong>
          <Activity size={23}/>
          ATLASOPS <span>COMERCIAL</span>
        </strong>

        <div className="c-actions">

          {onExit && (
            <button
              className="c-link"
              onClick={onExit}
            >
              <ArrowLeft size={16}/>
              Voltar
            </button>
          )}

          <button
            className="c-link"
            onClick={refresh}
          >
            <RefreshCw size={16}/>
            Atualizar
          </button>

        </div>
      </header>

      <div className="c-hero small">
        <Pill>
          SUBSCRIÇÃO & FATURAÇÃO
        </Pill>

        <h1>
          O plano certo para
          <br/>
          <em>a sua empresa.</em>
        </h1>

        <p>
          Dados de faturação,
          condições claras e pagamentos
          confirmados pelo prestador —
          sem informação de cartões
          guardada no AtlasOps.
        </p>
      </div>

      {err && (
        <Notice error={err}/>
      )}

      {!data ? (
        <div className="c-card">
          A carregar informações comerciais...
        </div>
      ) : (
        <>

          <div className="c-status">
            <div>
              <Clock3 size={20}/>

              <div>
                <strong>
                  Estado:{' '}
                  {
                    data.subscription.status === 'trialing'
                      ? 'Avaliação'
                      : data.subscription.status === 'active'
                      ? 'Ativo'
                      : data.subscription.status === 'past_due'
                      ? 'Por renovar'
                      : 'Inativo'
                  }
                </strong>

                <p>
                  {data.subscription.status === 'trialing'
                    ? 'Avaliação até ' +
                      fmt(data.subscription.trial_ends_at)
                    : 'Acesso até ' +
                      fmt(data.subscription.current_period_end)}

                  {' · Plano '}
                  {data.subscription.plan_code}
                </p>
              </div>
            </div>

            <Pill>
              {data.access
                ? 'ACESSO DISPONÍVEL'
                : 'RENOVAÇÃO NECESSÁRIA'}
            </Pill>
          </div>

          {data.testMode && (
            <div className="c-info">
              <ShieldCheck size={19}/>

              Ambiente de testes: quaisquer
              pagamentos com chave de teste
              não movimentam dinheiro real.
            </div>
          )}

          {!data.checkoutEnabled && (
            <div className="c-info">
              <LockKeyhole size={19}/>

              Checkout ainda não ativo.
              É necessário configurar os dados
              da entidade vendedora, a chave
              do prestador e as condições
              de lançamento.

              A demonstração dos planos
              continua disponível.
            </div>
          )}

          {/* PLANS */}

          <section className="c-section">
            <div className="c-section-head">
              <h2>01 · Escolha o plano</h2>
              <p>
                Pagamento único por mês.
                Não existe renovação automática.
              </p>
            </div>

            <PlanCards
              plans={data.plans}
              selected={selected}
              onChoose={owner ? setSelected : undefined}
            />
          </section>

          <div className="c-disclaimer">
            Precisa de mais de 60 contas,
            requisitos especiais ou integração
            com a operadora?

            Solicite uma proposta à equipa
            comercial em{' '}
            {data.legal.contact ||
              'email de contacto por configurar'}.
          </div>

          {/* BILLING DETAILS */}

          <section className="c-section">

            <div className="c-section-head">
              <h2>02 · Dados de faturação</h2>
              <p>
                Registe os dados reais da
                empresa antes de iniciar
                uma cobrança.
              </p>
            </div>

            <div className="c-card">

              <div className="c-form-grid">

                <label>
                  Nome legal da empresa

                  <input
                    disabled={!owner}
                    value={profile.legalName}
                    onChange={e =>
                      setProfile({
                        ...profile,
                        legalName: e.target.value
                      })
                    }
                    placeholder="Nome registado"
                  />
                </label>

                <label>
                  NUIT

                  <input
                    disabled={!owner}
                    value={profile.nuit}
                    onChange={e =>
                      setProfile({
                        ...profile,
                        nuit: e.target.value
                      })
                    }
                    placeholder="Número fiscal da empresa"
                  />
                </label>

                <label>
                  Email de faturação

                  <input
                    type="email"
                    disabled={!owner}
                    value={profile.billingEmail}
                    onChange={e =>
                      setProfile({
                        ...profile,
                        billingEmail: e.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Morada de faturação

                  <input
                    disabled={!owner}
                    value={profile.billingAddress}
                    onChange={e =>
                      setProfile({
                        ...profile,
                        billingAddress: e.target.value
                      })
                    }
                  />
                </label>

              </div>

              {owner && (
                <button
                  className="c-button secondary"
                  onClick={save}
                  disabled={busy}
                >
                  Guardar dados
                  <CheckCircle2 size={16}/>
                </button>
              )}

            </div>
          </section>

          {/* CHECKOUT */}

          <section className="c-section">

            <div className="c-section-head">
              <h2>03 · Confirmar e pagar</h2>
              <p>
                A leitura e aceitação das
                condições são registadas
                antes de criar o pedido.
              </p>
            </div>

            <div className="c-card c-checkout">

              <div>
                <strong>
                  Plano{' '}
                  {data.plans.find(
                    p => p.code === selected
                  )?.name}
                </strong>

                <div className="c-price">
                  {money(
                    data.plans.find(
                      p => p.code === selected
                    )?.amount || 0
                  )}

                  <small> por 1 mês</small>
                </div>
              </div>

              <label className="c-agree">

                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={e =>
                    setAccepted(e.target.checked)
                  }
                />

                <span>
                  Li e aceito os{' '}
                  <a href="#terms">
                    Termos e Condições
                  </a>
                  {' '}(versão {data.legal.version}).
                </span>
              </label>

              <label className="c-agree">

                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={e =>
                    setPrivacy(e.target.checked)
                  }
                />

                <span>
                  Li a{' '}
                  <a href="#privacy">
                    Política de Privacidade
                  </a>
                  {' '}e tenho autorização para
                  utilizar os dados da empresa.
                </span>
              </label>

              <button
                className="c-button"
                disabled={
                  !owner ||
                  !data.checkoutEnabled ||
                  !accepted ||
                  !privacy ||
                  busy
                }
                onClick={checkout}
              >
                <Wallet size={18}/>

                Continuar para pagamento seguro

                <ArrowRight size={18}/>
              </button>

              <p className="c-hint">
                Acesso pago apenas depois
                de confirmação de EPay.
                Esta página não emite
                documentos fiscais.
                Contacte a entidade vendedora
                para fatura ou recibo.
              </p>

            </div>
          </section>

          {/* HISTORY */}

          <section className="c-section">

            <div className="c-section-head">
              <h2>Histórico de pedidos</h2>
              <p>
                As referências abaixo não
                substituem faturas fiscais.
              </p>
            </div>

            <div className="c-card c-orders">

              {data.orders.length === 0 ? (
                <p>
                  Ainda não existem pagamentos.
                </p>
              ) : (
                data.orders.map(o => (
                  <div
                    className="c-order"
                    key={o.id}
                  >

                    <div>
                      <strong>
                        {o.plan_code}
                        {' · '}
                        {money(o.amount_mzn)}
                      </strong>

                      <p>
                        Pedido {o.id.slice(0, 8)}
                        {' · '}
                        {fmt(o.created_at)}
                        {' · '}
                        <b>{o.status}</b>
                      </p>
                    </div>

                    {o.status === 'pending' &&
                      owner && (
                        <button
                          className="c-button secondary"
                          disabled={busy}
                          onClick={() => verify(o.id)}
                        >
                          Verificar pagamento
                        </button>
                      )}

                    {o.status === 'paid' && (
                      <Pill>
                        PAGO E CONFIRMADO
                      </Pill>
                    )}

                  </div>
                ))
              )}

            </div>
          </section>

          <LegalDocuments info={data.legal}/>

          <footer className="c-footer">
            <FileText size={16}/>

            {data.legal.legalName ||
              'Identificação legal pendente'}

            {' · '}

            {data.legal.contact ||
              'Contacto empresarial por configurar'}

            {' · Políticas em revisão jurídica'}
          </footer>

        </>
      )}

    </Layout>
  );
}