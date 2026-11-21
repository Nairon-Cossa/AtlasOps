import Fastify from 'fastify';

import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

import { authRoutes } from './lib/auth.js';
import { dataRoutes } from './routes/data.js';
import { deviceRoutes } from './routes/devices.js';
import { carrierRoutes } from './routes/carrier.js';
import { analyticsRoutes } from './routes/analytics.js';
import { intelligenceRoutes } from './routes/intelligence.js';

import {
  errorHandler,
  fail
} from './lib/http.js';

import { pool } from './lib/db.js';

import {
  billingRoutes,
  epayWebhookRoutes,
  requireCommercialAccess,
  enforceSeats
} from './routes/billing.js';

export async function makeApp() {

  const app = Fastify({
    logger: {
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-educavelpay-signature',
        'res.headers.set-cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.currentPassword',
        'req.body.confirmPassword',
        'req.body.signupCode',
        'req.body.enrollmentToken',
        'req.body.token'
      ]
    },

    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestTimeout: 20000
  });

  await app.register(
    helmet,
    {
      contentSecurityPolicy: false
    }
  );

  await app.register(cookie);

  await app.register(
    rateLimit,
    {
      global: true,
      max: 180,
      timeWindow: '1 minute'
    }
  );

  app.addHook(
    'onRequest',
    async req => {

      if (
        ['POST', 'PUT', 'PATCH', 'DELETE']
          .includes(req.method)
      ) {

        const origin =
          req.headers.origin;

        if (
          origin &&
          origin !== process.env.PUBLIC_ORIGIN
        ) {
          fail(
            403,
            'Cross-origin request blocked'
          );
        }

        if (
          !req.headers['content-type']
            ?.startsWith('application/json')
        ) {
          fail(
            415,
            'JSON content type required'
          );
        }
      }
    }
  );

  app.get(
    '/health',
    async () => ({
      status: 'ok'
    })
  );

  app.get(
    '/ready',
    async () => {
      await pool.query('SELECT 1');

      return {
        status: 'ready'
      };
    }
  );

  app.register(
    async api => {

      api.setErrorHandler(
        errorHandler
      );

      // Business APIs require an active plan or trial.
      // Authentication and payment recovery remain accessible.

      api.addHook(
        'preHandler',
        async req => {

          const path =
            req.url.split('?')[0];

          if (
            path === '/api/auth/users' &&
            req.method === 'POST'
          ) {
            return enforceSeats(req);
          }

          if (
            [
              '/api/data/',
              '/api/calls',
              '/api/analytics',
              '/api/intelligence',
              '/api/carrier'
            ].some(p => path.startsWith(p))
          ) {
            await requireCommercialAccess(req);
          }
        }
      );

      await billingRoutes(api);

      await api.register(
        epayWebhookRoutes
      );

      await authRoutes(api);
      await dataRoutes(api);
      await deviceRoutes(api);
      await carrierRoutes(api);
      await analyticsRoutes(api);
      await intelligenceRoutes(api);
    },
    {
      prefix: '/api'
    }
  );

  app.setErrorHandler(
    errorHandler
  );

  return app;
}

if (
  import.meta.url ===
  `file://${process.argv[1]}`
) {

  const app = await makeApp();

  await app.listen({
    port: Number(
      process.env.PORT || 4000
    ),
    host:
      process.env.HOST || '127.0.0.1'
  });

  const stop = async () => {

    await app.close();
    await pool.end();

    process.exit(0);
  };

  process.on(
    'SIGTERM',
    stop
  );

  process.on(
    'SIGINT',
    stop
  );
}