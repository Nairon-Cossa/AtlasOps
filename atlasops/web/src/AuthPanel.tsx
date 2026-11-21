import React, {
  useEffect,
  useState
} from 'react';

import {
  Activity,
  Check,
  ChevronRight,
  Mail,
  ShieldCheck
} from 'lucide-react';

import {
  api,
  type Session
} from './api';

import {
  PublicPlans
} from './CommercePanel';

type Mode =
  | 'login'
  | 'register'
  | 'verify-email'
  | 'resend-verification'
  | 'reset-request'
  | 'reset-password'
  | 'accept-invite';

type AuthConfig = {
  registrationMode: 'open' | 'invite';
  emailDelivery: boolean;
  staffInvites: boolean;
};

const readLink = () => {
  const u = new URL(window.location.href);

  const action = u.searchParams.get('action');

  const mode: Mode =
    action === 'verify-email' ||
    action === 'accept-invite' ||
    action === 'reset-password'
      ? action
      : 'login';

  const link = {
    mode,
    slug: u.searchParams.get('slug') || '',
    token: u.searchParams.get('token') || ''
  };

  if (action) {
    window.history.replaceState(
      {},
      '',
      window.location.pathname
    );
  }

  return link;
};

const initialLink = readLink();

export default function AuthPanel({
  onLogin
}: {
  onLogin: (session: Session) => void;
}) {

  const [link] = useState(initialLink);

  const [mode, setMode] =
    useState<Mode>(link.mode);

  const [showPlans, setShowPlans] =
    useState(false);

  const [config, setConfig] =
    useState<AuthConfig>({
      registrationMode: 'invite',
      emailDelivery: false,
      staffInvites: false
    });

  const [busy, setBusy] =
    useState(false);

  const [notice, setNotice] =
    useState<{
      text: string;
      success: boolean;
    } | null>(null);

  const [data, setData] = useState({
    slug: link.slug,
    email: '',
    password: '',
    confirmPassword: '',
    orgName: '',
    fullName: '',
    signupCode: ''
  });

  useEffect(() => {
    api<AuthConfig>(
      '/auth/config'
    )
      .then(setConfig)
      .catch(() => {});
  }, []);

  const update = (
    key: keyof typeof data,
    value: string
  ) => {
    setData(old => ({
      ...old,
      [key]: value
    }));
  };

  const switchMode = (next: Mode) => {
    setNotice(null);
    setMode(next);
  };

  const title: Record<Mode, string> = {
    login: 'Entre no seu workspace',

    register:
      'Crie o workspace da empresa',

    'verify-email':
      'Confirme o seu email',

    'resend-verification':
      'Reenvie a confirmação',

    'reset-request':
      'Recupere o acesso',

    'reset-password':
      'Defina uma nova palavra-passe',

    'accept-invite':
      'Aceite o convite'
  };

  async function submit(
    e: React.FormEvent
  ) {

    e.preventDefault();

    setBusy(true);
    setNotice(null);

    try {
      if (mode === 'login') {

        await api(
          '/auth/login',
          'POST',
          {
            slug: data.slug,
            email: data.email,
            password: data.password
          }
        );

        onLogin(
          await api<Session>(
            '/auth/me'
          )
        );

      } else if (mode === 'register') {

        if (
          data.password !==
          data.confirmPassword
        ) {
          throw new Error(
            'As palavras-passe não coincidem.'
          );
        }

        const r = await api<{
          pendingVerification?: boolean;
          message?: string;
        }>(
          '/auth/register',
          'POST',
          {
            orgName: data.orgName,
            slug: data.slug,
            fullName: data.fullName,
            email: data.email,
            password: data.password,

            ...(config.registrationMode === 'invite'
              ? {
                  signupCode: data.signupCode
                }
              : {})
          }
        );

        if (r.pendingVerification) {
          switchMode('login');

          setNotice({
            text:
              r.message ||
              'Enviámos uma ligação para confirmar o email.',
            success: true
          });

        } else {
          onLogin(
            await api<Session>(
              '/auth/me'
            )
          );
        }

      } else if (mode === 'verify-email') {

        await api(
          '/auth/verify-email',
          'POST',
          {
            slug: link.slug,
            token: link.token
          }
        );

        onLogin(
          await api<Session>(
            '/auth/me'
          )
        );

      } else if (mode === 'accept-invite') {

        if (
          data.password !==
          data.confirmPassword
        ) {
          throw new Error(
            'As palavras-passe não coincidem.'
          );
        }

        await api(
          '/auth/invites/accept',
          'POST',
          {
            slug: link.slug,
            token: link.token,
            password: data.password
          }
        );

        onLogin(
          await api<Session>(
            '/auth/me'
          )
        );

      } else if (
        mode === 'resend-verification'
      ) {

        const r = await api<{
          message: string
        }>(
          '/auth/resend-verification',
          'POST',
          {
            slug: data.slug,
            email: data.email
          }
        );

        setNotice({
          text: r.message,
          success: true
        });

      } else if (
        mode === 'reset-request'
      ) {

        const r = await api<{
          message: string
        }>(
          '/auth/password-reset/request',
          'POST',
          {
            slug: data.slug,
            email: data.email
          }
        );

        setNotice({
          text: r.message,
          success: true
        });

      } else if (
        mode === 'reset-password'
      ) {

        if (
          data.password !==
          data.confirmPassword
        ) {
          throw new Error(
            'As palavras-passe não coincidem.'
          );
        }

        await api(
          '/auth/password-reset/confirm',
          'POST',
          {
            slug: link.slug,
            token: link.token,
            newPassword: data.password
          }
        );

        setMode('login');

        setNotice({
          text:
            'Palavra-passe alterada. Pode entrar na sua conta.',
          success: true
        });
      }

    } catch (e) {

      setNotice({
        text:
          e instanceof Error
            ? e.message
            : 'Ocorreu um erro. Tente novamente.',
        success: false
      });

    } finally {
      setBusy(false);
    }
  }

  const signup =
    mode === 'register';

  const needPassword = [
    'login',
    'register',
    'reset-password',
    'accept-invite'
  ].includes(mode);

  const needEmail = [
    'login',
    'register',
    'reset-request',
    'resend-verification'
  ].includes(mode);

  const needSlug = [
    'login',
    'register',
    'reset-request',
    'resend-verification'
  ].includes(mode);

  if (showPlans) {
    return (
      <PublicPlans
        onBack={() => setShowPlans(false)}
        onStart={() => {
          setShowPlans(false);
          switchMode('register');
        }}
      />
    );
  }

  return (
    <div className="auth-page">

      <div className="auth-intro">

        <div className="mark">
          <Activity size={22}/>

          <b>
            ATLAS<span>OPS</span>
          </b>
        </div>

        <div className="intro-middle">

          <div className="eyebrow">
            <span className="dot"/>
            {' '}INTELIGÊNCIA OPERACIONAL
          </div>

          <h1>
            A tua empresa.
            <br/>
            <em>Mais clara.</em>
            <br/>
            Mais rentável.
          </h1>

          <p>
            Centralize chamadas, equipa, vendas,
            despesas e resultados.
            Tome decisões com dados
            identificados pela sua origem.
          </p>

          <div className="intro-badges">

            <span>
              <Check size={15}/>
              Actividade auditável
            </span>

            <span>
              <Check size={15}/>
              Dados por empresa
            </span>

            <span>
              <Check size={15}/>
              Custos reais e estimados
            </span>

          </div>
        </div>

        <div className="auth-foot">
          Construído para empresas em Moçambique.
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">

          <div className="mobile-mark">
            <Activity/>
            <b>ATLASOPS</b>
          </div>

          <div className="eyebrow dark">
            BEM-VINDO / WELCOME
          </div>

          <h2>{title[mode]}</h2>

          <p className="sub">
            {signup
              ? 'Configure a sua empresa e administre a equipa num único local.'
              : mode === 'login'
              ? 'Acompanhe trabalho, custos e resultados num só lugar.'
              : mode === 'reset-request' ||
                mode === 'resend-verification'
              ? 'Enviaremos uma ligação para o endereço de email da conta.'
              : mode === 'verify-email'
              ? 'A ligação é válida durante 60 minutos.'
              : mode === 'accept-invite'
              ? 'Crie a sua palavra-passe pessoal para aceder à empresa.'
              : 'A ligação é de utilização única.'}
          </p>

          {notice && (
            <div
              role="alert"
              className={
                notice.success
                  ? 'success'
                  : 'error'
              }
            >
              {notice.text}
            </div>
          )}

          <form
            className="auth-form"
            onSubmit={submit}
          >

            {signup && (
              <>

                <label>
                  Nome da empresa

                  <input
                    required
                    minLength={2}
                    maxLength={160}
                    value={data.orgName}
                    onChange={e =>
                      update(
                        'orgName',
                        e.target.value
                      )
                    }
                    placeholder="Ex.: Empresa Comercial, Lda"
                  />
                </label>

                <label>
                  Nome completo do responsável

                  <input
                    required
                    minLength={2}
                    maxLength={150}
                    value={data.fullName}
                    onChange={e =>
                      update(
                        'fullName',
                        e.target.value
                      )
                    }
                    placeholder="Nome e apelido"
                  />
                </label>

              </>
            )}

            {needSlug && (
              <label>
                Workspace / Empresa

                <input
                  required
                  minLength={3}
                  maxLength={40}
                  value={data.slug}
                  onChange={e =>
                    update(
                      'slug',
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '')
                    )
                  }
                  placeholder="nome-da-empresa"
                />
              </label>
            )}

            {needEmail && (
              <label>
                Endereço de email

                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={data.email}
                  onChange={e =>
                    update(
                      'email',
                      e.target.value
                    )
                  }
                  placeholder="nome@empresa.co.mz"
                />
              </label>
            )}

            {needPassword && (
              <label>
                {mode === 'accept-invite' ||
                mode === 'reset-password'
                  ? 'Nova palavra-passe'
                  : 'Palavra-passe'}

                <input
                  required
                  type="password"
                  minLength={
                    mode === 'login' ? 1 : 12
                  }
                  maxLength={128}
                  autoComplete={
                    mode === 'login'
                      ? 'current-password'
                      : 'new-password'
                  }
                  value={data.password}
                  onChange={e =>
                    update(
                      'password',
                      e.target.value
                    )
                  }
                  placeholder={
                    mode === 'login'
                      ? 'A sua palavra-passe'
                      : 'Pelo menos 12 caracteres'
                  }
                />
              </label>
            )}

            {(signup ||
              mode === 'reset-password' ||
              mode === 'accept-invite') && (
              <label>
                Confirmar palavra-passe

                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={data.confirmPassword}
                  onChange={e =>
                    update(
                      'confirmPassword',
                      e.target.value
                    )
                  }
                />
              </label>
            )}

            {signup &&
              config.registrationMode === 'invite' && (
                <label>
                  Código de convite para novas empresas

                  <input
                    required
                    value={data.signupCode}
                    onChange={e =>
                      update(
                        'signupCode',
                        e.target.value
                      )
                    }
                    placeholder="Código do administrador AtlasOps"
                  />
                </label>
              )}

            {signup &&
              config.registrationMode === 'open' && (
                <p className="auth-helper">
                  <Mail size={14}/>
                  Um email de confirmação será
                  enviado antes de activar a conta.
                </p>
              )}

            {mode === 'reset-request' &&
              !config.emailDelivery && (
                <p className="auth-helper">
                  A recuperação por email
                  ainda não está configurada
                  neste servidor.
                </p>
              )}

            <button
              className="primary large"
              disabled={busy}
              type="submit"
            >
              {busy
                ? 'A processar...'
                : {
                    login:
                      'Entrar na plataforma',

                    register:
                      'Criar workspace',

                    'verify-email':
                      'Confirmar email',

                    'resend-verification':
                      'Reenviar confirmação',

                    'reset-request':
                      'Enviar ligação',

                    'reset-password':
                      'Alterar palavra-passe',

                    'accept-invite':
                      'Activar conta'
                  }[mode]}

              <ChevronRight size={18}/>
            </button>

          </form>

          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                Ainda não tem workspace?{' '}

                <button
                  type="button"
                  onClick={() =>
                    switchMode('register')
                  }
                >
                  Criar empresa
                </button>
              </>
            ) : (
              <>
                Já tem conta?{' '}

                <button
                  type="button"
                  onClick={() =>
                    switchMode('login')
                  }
                >
                  Entrar
                </button>
              </>
            )}
          </div>

          {mode === 'login' && (
            <div className="auth-switch">

              <button
                type="button"
                onClick={() =>
                  switchMode('reset-request')
                }
              >
                Esqueceu a palavra-passe?
              </button>

              {' · '}

              <button
                type="button"
                onClick={() =>
                  switchMode('resend-verification')
                }
              >
                Reenviar confirmação
              </button>

            </div>
          )}

          <div className="auth-switch">
            <button
              type="button"
              onClick={() =>
                setShowPlans(true)
              }
            >
              Consultar planos, preços e políticas
            </button>
          </div>

          <p className="tiny centered">
            <ShieldCheck
              size={12}
              style={{
                verticalAlign: 'middle'
              }}
            />

            {' '}AtlasOps não grava automaticamente
            chamadas de SIM.
            A origem de cada dado é identificada.
          </p>

        </div>
      </div>

    </div>
  );
}