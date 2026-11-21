// AtlasOps Transactional Email Service
// Provider: Resend
// Never log verification tokens or email action URLs.

export const emailEnabled = () => {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM
  );
};

export const signupMode = () => {
  if (
    process.env.SIGNUP_MODE === 'open' &&
    emailEnabled()
  ) {
    return 'open';
  }

  return 'invite';
};

export async function sendActionEmail({
  to,
  subject,
  action,
  url
}) {
  if (!emailEnabled()) {
    throw new Error('Email delivery is not configured');
  }

  const message = [
    `AtlasOps — ${action}`,
    '',
    `Use esta ligação para continuar: ${url}`,
    '',
    'Se não solicitou esta operação, ignore esta mensagem.',
    'A ligação expira automaticamente. Nunca partilhe este link.'
  ].join('\n');

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        signal: controller.signal,

        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [to],
          subject,
          text: message
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Email service returned HTTP ${response.status}`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function actionUrl(action, slug, secret) {
  const url = new URL(
    process.env.PUBLIC_ORIGIN || 'http://localhost:8080'
  );

  url.searchParams.set('action', action);
  url.searchParams.set('slug', slug);
  url.searchParams.set('token', secret);

  return url.toString();
}