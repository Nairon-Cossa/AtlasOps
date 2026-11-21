// AtlasOps Commercial Billing
// Hosted EPay checkout in MZN.
// Payment status must be verified server-side.

import {
  randomUUID,
  createHmac,
  timingSafeEqual
} from 'node:crypto';

import { z } from 'zod';

import {
  query,
  withTenant,
  audit
} from '../lib/db.js';

import {
  getActor,
  checkCsrf,
  can
} from '../lib/auth.js';

import { fail } from '../lib/http.js';

// =====================================================
// PLANS - SERVER CONTROLLED
// =====================================================

export const PLANS = Object.freeze({
  starter: {
    code: 'starter',
    name: 'Essencial',
    amount: 2990,
    seats: 5,
    description: 'Para equipas comerciais pequenas'
  },

  growth: {
    code: 'growth',
    name: 'Crescimento',
    amount: 6990,
    seats: 20,
    description: 'Para equipas que precisam de mais capacidade'
  },

  scale: {
    code: 'scale',
    name: 'Empresa',
    amount: 12990,
    seats: 60,
    description: 'Para operações com várias equipas'
  }
});

const VERSION =
  process.env.ATLASOPS_TERMS_VERSION ||
  '2026-11-18-draft';

const ORIGIN = () =>
  process.env.PUBLIC_ORIGIN ||
  'http://localhost:18080';

const EPAY_BASE =
  'https://checkout.epay.co.mz/api/v1';

const key = () =>
  process.env.EPAY_SECRET_KEY || '';

const live = () =>
  key().startsWith('sk_live_');

const configured = () =>
  key().startsWith('sk_test_') || live();

// =====================================================
// LEGAL CONFIGURATION
// =====================================================

const policyInfo = () => ({
  legalName: process.env.ATLASOPS_LEGAL_NAME || '',
  nuit: process.env.ATLASOPS_NUIT || '',
  address: process.env.ATLASOPS_BUSINESS_ADDRESS || '',
  contact: process.env.ATLASOPS_CONTACT_EMAIL || '',
  version: VERSION
});

const legalReady = () => {
  const info = policyInfo();

  return Boolean(
    info.legalName.length >= 3 &&
    info.nuit.length >= 6 &&
    info.address.length >= 8 &&
    /^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(info.contact)
  );
};

const enabled = () =>
  process.env.ATLASOPS_CHECKOUT_ENABLED === 'true' &&
  process.env.ATLASOPS_POLICIES_APPROVED === 'true' &&
  configured() &&
  legalReady() &&
  (!live() || ORIGIN().startsWith('https://')) &&
  (
    process.env.NODE_ENV !== 'production' ||
    live()
  );

const publicConfig = () => ({
  plans: Object.values(PLANS),
  currency: 'MZN',
  cycle: 'monthly-manual-renewal',
  provider: 'EPay',
  testMode: configured() && !live(),
  checkoutEnabled: enabled(),
  legalReady: legalReady(),
  legal: policyInfo(),
  note:
    'Mensalidade paga antecipadamente; sem débito automático. Preços propostos, sujeitos à confirmação comercial.'
});

// =====================================================
// REQUEST VALIDATION
// =====================================================

const profileSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  nuit: z.string().trim().min(6).max(30),
  billingEmail: z.string().email().max(254),
  billingAddress: z.string().trim().min(8).max(300)
}).strict();

const checkoutSchema = z.object({
  plan: z.enum([
    'starter',
    'growth',
    'scale'
  ]),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true)
}).strict();

// =====================================================
// EPAY API
// =====================================================

const providerHeaders = () => ({
  Authorization: `Bearer ${key()}`,
  'Content-Type': 'application/json'
});

async function epay(path, options = {}) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    12000
  );

  try {
    const response = await fetch(
      EPAY_BASE + path,
      {
        ...options,
        headers: {
          ...providerHeaders(),
          ...(options.headers || {})
        },
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let obj;

    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }

    if (!response.ok) {
      throw new Error(
        `EPay HTTP ${response.status}`
      );
    }

    return obj;

  } finally {
    clearTimeout(timer);
  }
}

// =====================================================
// SUBSCRIPTION ACCESS
// =====================================================

async function ensureRow(tenantId) {
  return withTenant(
    tenantId,
    async db => {

      await db.query(
        `
        INSERT INTO billing_subscriptions (
          tenant_id
        )
        VALUES ($1)
        ON CONFLICT DO NOTHING
        `,
        [tenantId]
      );

      const r = await db.query(
        `
        SELECT *
        FROM billing_subscriptions
        WHERE tenant_id = $1
        `,
        [tenantId]
      );

      return r.rows[0];
    }
  );
}

export function isAllowed(sub) {
  if (sub.status === 'trialing') {
    return new Date(sub.trial_ends_at) > new Date();
  }

  if (sub.status === 'active') {
    return Boolean(
      sub.current_period_end &&
      new Date(sub.current_period_end) > new Date()
    );
  }

  return false;
}

export async function requireCommercialAccess(req) {
  await getActor(req);

  const sub = await ensureRow(
    req.actor.tenant_id
  );

  if (!isAllowed(sub)) {
    fail(
      402,
      'Subscrição inactiva. Renove o seu plano em Faturação.'
    );
  }
}

export async function enforceSeats(req) {
  await requireCommercialAccess(req);

  const sub = await ensureRow(
    req.actor.tenant_id
  );

  const limit =
    PLANS[sub.plan_code]?.seats ||
    PLANS.starter.seats;

  const result = await withTenant(
    req.actor.tenant_id,
    db => db.query(
      `
      SELECT count(*)::int AS seats
      FROM users
      `
    )
  );

  if (result.rows[0].seats >= limit) {
    fail(
      403,
      `Limite de ${limit} contas atingido neste plano. Actualize a subscrição.`
    );
  }
}

// =====================================================
// PAYMENT VERIFICATION
// =====================================================

export function paymentMatches(order, payment) {
  return Boolean(
    order &&
    payment &&
    order.provider_id === payment.id &&
    payment.external_reference === String(order.id) &&
    payment.currency === 'MZN' &&
    Number(payment.amount) === Number(order.amount_mzn) &&
    payment.status === 'paid'
  );
}

async function markPaid(
  tenantId,
  orderId,
  providerPayment
) {
  return withTenant(
    tenantId,
    async db => {

      const orderRes = await db.query(
        `
        SELECT *
        FROM billing_orders
        WHERE id = $1
        FOR UPDATE
        `,
        [orderId]
      );

      const order = orderRes.rows[0];

      if (!order) {
        fail(404, 'Pagamento não encontrado');
      }

      if (order.status === 'paid') {
        return true;
      }

      if (!paymentMatches(order, providerPayment)) {
        return false;
      }

      await db.query(
        `
        UPDATE billing_orders
        SET
          status = $1,
          paid_at = COALESCE(
            $2::timestamptz,
            now()
          )
        WHERE id = $3
        `,
        [
          'paid',
          providerPayment.paid_at || null,
          order.id
        ]
      );

      await db.query(
        `
        INSERT INTO billing_subscriptions (
          tenant_id,
          plan_code,
          status,
          current_period_end
        )
        VALUES (
          $1,
          $2,
          'active',
          now() + interval '1 month'
        )

        ON CONFLICT (tenant_id)
        DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = 'active',
          current_period_end =
            GREATEST(
              now(),
              COALESCE(
                billing_subscriptions.current_period_end,
                now()
              )
            ) + interval '1 month',
          updated_at = now()
        `,
        [
          tenantId,
          order.plan_code
        ]
      );

      await audit(
        db,
        tenantId,
        order.requested_by,
        'billing.paid',
        'billing_orders',
        order.id,
        {
          provider: 'epay',
          plan: order.plan_code
        }
      );

      return true;
    }
  );
}

async function verifyOrder(tenantId, order) {
  if (
    !order ||
    order.status !== 'pending' ||
    !order.provider_id ||
    !configured()
  ) {
    return false;
  }

  // Only information retrieved directly from EPay
  // can activate the subscription.

  const payment = await epay(
    '/payments/' +
    encodeURIComponent(order.provider_id)
  );

  if (payment.status === 'paid') {
    return markPaid(
      tenantId,
      order.id,
      payment
    );
  }

  if (['failed', 'cancelled'].includes(payment.status)) {
    await withTenant(
      tenantId,
      db => db.query(
        `
        UPDATE billing_orders
        SET status = $1
        WHERE id = $2
          AND status = $3
        `,
        [
          payment.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
          order.id,
          'pending'
        ]
      )
    );
  }

  return false;
}

// =====================================================
// BILLING ROUTES
// =====================================================

export async function billingRoutes(app) {

  app.get(
    '/billing/public',
    async () => publicConfig()
  );

  // ---------------------------------------------------
  // CURRENT SUBSCRIPTION
  // ---------------------------------------------------

  app.get(
    '/billing/status',
    async req => {

      await getActor(req);

      const tenant = req.actor.tenant_id;

      await ensureRow(tenant);

      const recent = await withTenant(
        tenant,
        db => db.query(
          `
          SELECT *
          FROM billing_orders
          ORDER BY created_at DESC
          LIMIT 10
          `
        )
      );

      const waiting = recent.rows.find(
        o => o.status === 'pending' && o.provider_id
      );

      if (waiting && configured()) {
        try {
          await verifyOrder(
            tenant,
            waiting
          );
        } catch (err) {
          req.log.warn(
            { message: err.message },
            'EPay status temporarily unavailable'
          );
        }
      }

      const [sub, details] = await Promise.all([
        ensureRow(tenant),

        withTenant(
          tenant,
          db => db.query(
            `
            SELECT
              legal_name,
              nuit,
              billing_email,
              billing_address
            FROM billing_company_profiles
            WHERE tenant_id = $1
            `,
            [tenant]
          )
        )
      ]);

      const orders = await withTenant(
        tenant,
        db => db.query(
          `
          SELECT
            id,
            plan_code,
            amount_mzn,
            currency,
            status,
            checkout_url,
            created_at,
            paid_at
          FROM billing_orders
          ORDER BY created_at DESC
          LIMIT 20
          `
        )
      );

      return {
        subscription: sub,
        access: isAllowed(sub),
        orders: orders.rows,
        company: details.rows[0] || null,
        ...publicConfig()
      };
    }
  );

  // ---------------------------------------------------
  // COMPANY BILLING PROFILE
  // ---------------------------------------------------

  app.put(
    '/billing/company',
    async req => {

      await getActor(req);
      checkCsrf(req);
      can(req, 'owner');

      const data = profileSchema.parse(
        req.body
      );

      await withTenant(
        req.actor.tenant_id,
        async db => {

          await db.query(
            `
            INSERT INTO billing_company_profiles (
              tenant_id,
              legal_name,
              nuit,
              billing_email,
              billing_address
            )
            VALUES ($1, $2, $3, $4, $5)

            ON CONFLICT (tenant_id)
            DO UPDATE SET
              legal_name = $2,
              nuit = $3,
              billing_email = $4,
              billing_address = $5,
              updated_at = now()
            `,
            [
              req.actor.tenant_id,
              data.legalName,
              data.nuit,
              data.billingEmail,
              data.billingAddress
            ]
          );

          await audit(
            db,
            req.actor.tenant_id,
            req.actor.id,
            'billing.company_updated',
            'billing_company_profiles',
            req.actor.tenant_id
          );
        }
      );

      return {
        ok: true
      };
    }
  );

  // ---------------------------------------------------
  // CREATE CHECKOUT
  // ---------------------------------------------------

  app.post(
    '/billing/checkout',
    {
      config: {
        rateLimit: {
          max: 4,
          timeWindow: '15 minutes'
        }
      }
    },
    async (req, reply) => {

      await getActor(req);
      checkCsrf(req);
      can(req, 'owner');

      const data = checkoutSchema.parse(
        req.body
      );

      if (!enabled()) {
        fail(
          503,
          'Pagamentos indisponíveis. Configure o prestador, os dados legais e o domínio de produção.'
        );
      }

      const company = await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          SELECT *
          FROM billing_company_profiles
          WHERE tenant_id = $1
          `,
          [req.actor.tenant_id]
        )
      );

      if (!company.rows[0]) {
        fail(
          400,
          'Preencha primeiro os dados de faturação da empresa.'
        );
      }

      const plan = PLANS[data.plan];

      const existing = await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          SELECT *
          FROM billing_orders
          WHERE plan_code = $1
            AND status = 'pending'
            AND created_at >
              now() - interval '15 minutes'
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [data.plan]
        )
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checkout_url) {
          return {
            checkoutUrl: existing.rows[0].checkout_url,
            orderId: existing.rows[0].id
          };
        }

        fail(
          409,
          'Existe um pedido em processamento. Não repita a cobrança; aguarde e contacte o suporte.'
        );
      }

      const id = randomUUID();

      await withTenant(
        req.actor.tenant_id,
        async db => {

          await db.query(
            `
            INSERT INTO billing_legal_acceptances (
              tenant_id,
              user_id,
              terms_version,
              privacy_version
            )
            VALUES ($1, $2, $3, $3)
            `,
            [
              req.actor.tenant_id,
              req.actor.id,
              VERSION
            ]
          );

          await db.query(
            `
            INSERT INTO billing_orders (
              id,
              tenant_id,
              requested_by,
              plan_code,
              amount_mzn
            )
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
              id,
              req.actor.tenant_id,
              req.actor.id,
              plan.code,
              plan.amount
            ]
          );
        }
      );

      await query(
        `
        INSERT INTO billing_order_directory (
          order_id,
          tenant_id
        )
        VALUES ($1, $2)
        `,
        [
          id,
          req.actor.tenant_id
        ]
      );

      const payload = {
        amount: plan.amount,
        currency: 'MZN',

        description:
          `AtlasOps — plano ${plan.name} — 1 mês`,

        external_reference: id,

        customer_name:
          company.rows[0].legal_name,

        customer_email:
          company.rows[0].billing_email,

        return_url:
          ORIGIN() + '/?billing=1',

        cancel_url:
          ORIGIN() + '/?billing=1'
      };

      if (ORIGIN().startsWith('https://')) {
        payload.callback_url =
          ORIGIN() + '/api/billing/webhooks/epay';
      }

      let p;

      try {
        p = await epay(
          '/payments',
          {
            method: 'POST',
            body: JSON.stringify(payload)
          }
        );
      } catch (e) {
        req.log.error(
          {
            message: e.message,
            orderId: id
          },
          'Checkout creation failure'
        );

        fail(
          503,
          'Não foi possível confirmar a criação do pagamento. Consulte o pedido antes de iniciar outro.'
        );
      }

      if (
        typeof p.id !== 'string' ||
        typeof p.payment_url !== 'string' ||
        !p.payment_url.startsWith(
          'https://checkout.epay.co.mz/'
        )
      ) {
        fail(
          502,
          'Resposta inválida do prestador'
        );
      }

      await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          UPDATE billing_orders
          SET
            provider_id = $1,
            checkout_url = $2
          WHERE id = $3
          `,
          [
            p.id,
            p.payment_url,
            id
          ]
        )
      );

      await query(
        `
        UPDATE billing_order_directory
        SET provider_id = $1
        WHERE order_id = $2
        `,
        [
          p.id,
          id
        ]
      );

      return reply.code(201).send({
        checkoutUrl: p.payment_url,
        orderId: id,
        testMode: !live()
      });
    }
  );

  // ---------------------------------------------------
  // VERIFY PAYMENT
  // ---------------------------------------------------

  app.post(
    '/billing/verify',
    {
      config: {
        rateLimit: {
          max: 6,
          timeWindow: '1 minute'
        }
      }
    },
    async req => {

      await getActor(req);
      checkCsrf(req);
      can(req, 'owner');

      const x = z.object({
        orderId: z.string().uuid()
      }).strict().parse(req.body);

      const q = await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          SELECT *
          FROM billing_orders
          WHERE id = $1
          `,
          [x.orderId]
        )
      );

      if (!q.rows[0]) {
        fail(
          404,
          'Pagamento não encontrado'
        );
      }

      if (q.rows[0].status === 'pending') {
        await verifyOrder(
          req.actor.tenant_id,
          q.rows[0]
        );
      }

      return {
        ok: true
      };
    }
  );
}

// =====================================================
// SIGNED EPAY WEBHOOKS
// =====================================================

// Raw-body parser is isolated in a separate Fastify plugin,
// leaving ordinary JSON API requests unaffected.

export async function epayWebhookRoutes(app) {

  app.removeContentTypeParser(
    'application/json'
  );

  app.addContentTypeParser(
    'application/json',
    {
      parseAs: 'buffer'
    },
    (_req, buffer, done) => {
      done(null, buffer);
    }
  );

  app.post(
    '/billing/webhooks/epay',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      }
    },
    async req => {

      const body = req.body;

      const received =
        req.headers['x-educavelpay-signature'];

      if (
        !configured() ||
        !Buffer.isBuffer(body) ||
        typeof received !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(received)
      ) {
        fail(
          401,
          'Invalid payment signature'
        );
      }

      const expected = createHmac(
        'sha256',
        key()
      ).update(body).digest();

      const supplied = Buffer.from(
        received,
        'hex'
      );

      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        fail(
          401,
          'Invalid payment signature'
        );
      }

      let payload;

      try {
        payload = JSON.parse(
          body.toString('utf8')
        );
      } catch {
        fail(
          400,
          'Invalid JSON'
        );
      }

      if (
        !payload ||
        typeof payload.external_reference !== 'string' ||
        !z.string().uuid().safeParse(
          payload.external_reference
        ).success
      ) {
        fail(
          400,
          'Invalid reference'
        );
      }

      const q = await query(
        `
        SELECT tenant_id
        FROM billing_order_directory
        WHERE order_id = $1
        `,
        [payload.external_reference]
      );

      if (!q.rows[0]) {
        return {
          received: true
        };
      }

      // Verify payment details with the provider
      // before activating a subscription.

      const tenant = q.rows[0].tenant_id;

      const order = await withTenant(
        tenant,
        db => db.query(
          `
          SELECT *
          FROM billing_orders
          WHERE id = $1
          `,
          [payload.external_reference]
        )
      );

      if (
        order.rows[0]?.status === 'pending' &&
        order.rows[0].provider_id
      ) {
        await verifyOrder(
          tenant,
          order.rows[0]
        );
      }

      return {
        received: true
      };
    }
  );
}