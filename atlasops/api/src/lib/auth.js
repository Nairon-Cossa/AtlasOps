import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { token, digest, safeEqual } from './crypto.js';
import { query, withTenant, audit } from './db.js';
import { fail } from './http.js';

import {
  emailEnabled,
  signupMode,
  sendActionEmail,
  actionUrl
} from './mailer.js';

export const ROLES = [
  'owner',
  'admin',
  'manager',
  'analyst',
  'agent'
];

export const sessionName =
  process.env.SESSION_COOKIE_NAME || 'ao_session';

const SESSION_DAYS = 7;

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 3,
  parallelism: 1
};

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DAYS * 86400
  };
}

export const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(x => x.toLowerCase());

export const password = z
  .string()
  .min(12)
  .max(128);

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,39}$/);

const registrationSchema = z.object({
  orgName: z.string().trim().min(2).max(160),
  slug,
  fullName: z.string().trim().min(2).max(150),
  email,
  password,
  signupCode: z.string().optional()
}).strict();

export const loginSchema = z.object({
  slug,
  email,
  password: z.string()
}).strict();

const linkSchema = z.object({
  slug,
  token: z.string().min(32).max(256)
}).strict();

const resetRequestSchema = z.object({
  slug,
  email
}).strict();

const authSuccess = {
  ok: true
};

// ============================================================
// SESSIONS
// ============================================================

export async function issueSession(
  reply,
  tenantId,
  userId
) {
  const session = token();
  const csrf = token();

  await query(
    `
    INSERT INTO auth_sessions (
      session_hash,
      csrf_hash,
      tenant_id,
      user_id,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      now() + interval '7 days'
    )
    `,
    [
      digest(session),
      digest(csrf),
      tenantId,
      userId
    ]
  );

  reply.setCookie(
    sessionName,
    session,
    cookieOptions()
  );

  reply.setCookie(
    'ao_csrf',
    csrf,
    {
      ...cookieOptions(),
      httpOnly: false
    }
  );
}

export async function getActor(req) {
  const session = req.cookies?.[sessionName];

  if (!session) {
    fail(401, 'Authentication required');
  }

  const { rows } = await query(
    `
    SELECT
      tenant_id,
      user_id,
      csrf_hash
    FROM auth_sessions
    WHERE session_hash = $1
      AND revoked_at IS NULL
      AND expires_at > now()
    `,
    [digest(session)]
  );

  if (!rows[0]) {
    fail(401, 'Session expired');
  }

  const s = rows[0];

  const actor = await withTenant(
    s.tenant_id,
    async db => {
      const result = await db.query(
        `
        SELECT
          id,
          tenant_id,
          full_name,
          email,
          role,
          status,
          email_verified_at
        FROM users
        WHERE id = $1
        `,
        [s.user_id]
      );

      return result.rows[0];
    }
  );

  if (
    !actor ||
    actor.status !== 'active' ||
    !actor.email_verified_at
  ) {
    fail(403, 'Account is not active');
  }

  req.actor = actor;
  req.csrfHash = s.csrf_hash;

  return actor;
}

// ============================================================
// AUTHORIZATION
// ============================================================

export function can(req, ...roles) {
  if (
    !req.actor ||
    !roles.includes(req.actor.role)
  ) {
    fail(403, 'Insufficient permissions');
  }
}

export function checkCsrf(req) {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  ) {
    return;
  }

  const header = req.headers['x-csrf-token'];
  const cookie = req.cookies?.ao_csrf;

  if (
    !header ||
    !cookie ||
    !safeEqual(header, cookie) ||
    !safeEqual(
      digest(header),
      req.csrfHash
    )
  ) {
    fail(403, 'Invalid CSRF token');
  }
}

export async function employeeIdForActor(
  db,
  actor
) {
  const result = await db.query(
    `
    SELECT id
    FROM employees
    WHERE user_id = $1
    `,
    [actor.id]
  );

  return result.rows[0]?.id ?? null;
}

// ============================================================
// TENANT LOOKUP
// ============================================================

async function tenantForSlug(value) {
  const result = await query(
    `
    SELECT tenant_id
    FROM tenant_directory
    WHERE slug = $1
    `,
    [value]
  );

  return result.rows[0]?.tenant_id ?? null;
}

// ============================================================
// ONE-TIME AUTHENTICATION TOKENS
// ============================================================

async function createChallenge(
  db,
  tenantId,
  userId,
  purpose,
  minutes
) {
  const secret = token();

  await db.query(
    `
    UPDATE auth_challenges
    SET used_at = now()
    WHERE tenant_id = $1
      AND user_id = $2
      AND purpose = $3
      AND used_at IS NULL
    `,
    [
      tenantId,
      userId,
      purpose
    ]
  );

  await db.query(
    `
    INSERT INTO auth_challenges (
      tenant_id,
      user_id,
      purpose,
      token_hash,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      now() + ($5::int * interval '1 minute')
    )
    `,
    [
      tenantId,
      userId,
      purpose,
      digest(secret),
      minutes
    ]
  );

  return secret;
}

async function useChallenge(
  db,
  secret,
  purpose
) {
  // Consume the token inside the active transaction.

  const result = await db.query(
    `
    UPDATE auth_challenges
    SET used_at = now()
    WHERE token_hash = $1
      AND purpose = $2
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id
    `,
    [
      digest(secret),
      purpose
    ]
  );

  if (!result.rowCount) {
    fail(
      400,
      'Ligação inválida ou expirada'
    );
  }

  return result.rows[0].user_id;
}

// ============================================================
// EMAIL DELIVERY
// ============================================================

async function sendSafely(
  to,
  subject,
  action,
  url
) {
  try {
    await sendActionEmail({
      to,
      subject,
      action,
      url
    });
  } catch (error) {
    console.error(
      'AtlasOps email delivery failed:',
      error.message
    );

    fail(
      503,
      'Não foi possível enviar o email. Tente novamente mais tarde.'
    );
  }
}

// ============================================================
// AUTHENTICATION ROUTES
// ============================================================

export async function authRoutes(fastify) {

  // ----------------------------------------------------------
  // PUBLIC AUTH CONFIGURATION
  // ----------------------------------------------------------

  fastify.get(
    '/auth/config',
    async () => ({
      registrationMode: signupMode(),
      emailDelivery: emailEnabled(),
      staffInvites: emailEnabled()
    })
  );

  // ----------------------------------------------------------
  // REGISTER COMPANY
  // ----------------------------------------------------------

  fastify.post(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: 4,
          timeWindow: '15 minutes'
        }
      }
    },
    async (req, reply) => {

      const x = registrationSchema.parse(
        req.body
      );

      const open =
        signupMode() === 'open';

      if (
        !open &&
        (
          !process.env.SIGNUP_INVITE_CODE ||
          !x.signupCode ||
          !safeEqual(
            x.signupCode,
            process.env.SIGNUP_INVITE_CODE
          )
        )
      ) {
        fail(
          403,
          'Código de acesso inválido'
        );
      }

      const tenantId = randomUUID();
      const userId = randomUUID();

      const hash = await argon2.hash(
        x.password,
        HASH_OPTIONS
      );

      const mail = emailEnabled();

      const verifySecret = await withTenant(
        tenantId,
        async db => {

          await db.query(
            `
            INSERT INTO organizations (
              id,
              name,
              slug
            )
            VALUES ($1, $2, $3)
            `,
            [
              tenantId,
              x.orgName,
              x.slug
            ]
          );

          await db.query(
            `
            INSERT INTO tenant_directory (
              slug,
              tenant_id
            )
            VALUES ($1, $2)
            `,
            [
              x.slug,
              tenantId
            ]
          );

          await db.query(
            `
            INSERT INTO users (
              id,
              tenant_id,
              email,
              password_hash,
              full_name,
              role,
              email_verified_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              'owner',
              $6
            )
            `,
            [
              userId,
              tenantId,
              x.email,
              hash,
              x.fullName,
              mail ? null : new Date()
            ]
          );

          await audit(
            db,
            tenantId,
            userId,
            'organization.created',
            'organizations',
            tenantId
          );

          return mail
            ? createChallenge(
                db,
                tenantId,
                userId,
                'verify_email',
                60
              )
            : null;
        }
      );

      if (mail) {
        await sendSafely(
          x.email,
          'Confirme o email — AtlasOps',
          'Confirmação de email',
          actionUrl(
            'verify-email',
            x.slug,
            verifySecret
          )
        );

        return reply.code(201).send({
          pendingVerification: true,
          message:
            'Enviámos uma ligação de confirmação para o seu email.'
        });
      }

      await issueSession(
        reply,
        tenantId,
        userId
      );

      return reply.code(201).send({
        user: {
          id: userId,
          full_name: x.fullName,
          role: 'owner',
          email: x.email
        },
        organization: {
          id: tenantId,
          slug: x.slug,
          name: x.orgName
        }
      });
    }
  );

  // ----------------------------------------------------------
  // VERIFY EMAIL
  // ----------------------------------------------------------

  fastify.post(
    '/auth/verify-email',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes'
        }
      }
    },
    async (req, reply) => {

      const x = linkSchema.parse(
        req.body
      );

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (!tenantId) {
        fail(
          400,
          'Ligação inválida ou expirada'
        );
      }

      const userId = await withTenant(
        tenantId,
        async db => {

          const id = await useChallenge(
            db,
            x.token,
            'verify_email'
          );

          await db.query(
            `
            UPDATE users
            SET
              email_verified_at = now(),
              updated_at = now()
            WHERE id = $1
            `,
            [id]
          );

          await audit(
            db,
            tenantId,
            id,
            'email.verified',
            'users',
            id
          );

          return id;
        }
      );

      await issueSession(
        reply,
        tenantId,
        userId
      );

      return {
        ok: true
      };
    }
  );

  // ----------------------------------------------------------
  // RESEND EMAIL VERIFICATION
  // ----------------------------------------------------------

  fastify.post(
    '/auth/resend-verification',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '30 minutes'
        }
      }
    },
    async req => {

      const x = resetRequestSchema.parse(
        req.body
      );

      if (!emailEnabled()) {
        fail(
          503,
          'Verificação por email indisponível'
        );
      }

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (tenantId) {
        const secret = await withTenant(
          tenantId,
          async db => {

            const result = await db.query(
              `
              SELECT id
              FROM users
              WHERE lower(email) = $1
                AND email_verified_at IS NULL
                AND status = $2
              `,
              [
                x.email,
                'active'
              ]
            );

            if (!result.rowCount) {
              return null;
            }

            const last = await db.query(
              `
              SELECT 1
              FROM auth_challenges
              WHERE user_id = $1
                AND purpose = 'verify_email'
                AND created_at >
                  now() - interval '5 minutes'
              LIMIT 1
              `,
              [result.rows[0].id]
            );

            if (last.rowCount) {
              return null;
            }

            return createChallenge(
              db,
              tenantId,
              result.rows[0].id,
              'verify_email',
              60
            );
          }
        );

        if (secret) {
          try {
            await sendActionEmail({
              to: x.email,
              subject:
                'Confirme o email — AtlasOps',
              action:
                'Confirmação de email',
              url: actionUrl(
                'verify-email',
                x.slug,
                secret
              )
            });
          } catch (error) {
            req.log.error(
              { message: error.message },
              'Email delivery failed'
            );
          }
        }
      }

      return {
        ...authSuccess,
        message:
          'Se existir uma conta por confirmar, enviaremos um email.'
      };
    }
  );

  // ----------------------------------------------------------
  // LOGIN
  // ----------------------------------------------------------

  fastify.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: '15 minutes'
        }
      }
    },
    async (req, reply) => {

      const x = loginSchema.parse(
        req.body
      );

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (!tenantId) {
        fail(
          401,
          'Credenciais inválidas'
        );
      }

      const person = await withTenant(
        tenantId,
        async db => {

          const result = await db.query(
            `
            SELECT
              id,
              password_hash,
              status,
              role,
              full_name,
              email,
              email_verified_at
            FROM users
            WHERE lower(email) = $1
            `,
            [x.email]
          );

          return result.rows[0];
        }
      );

      if (
        !person ||
        person.status !== 'active' ||
        !person.email_verified_at ||
        !await argon2.verify(
          person.password_hash,
          x.password
        )
      ) {
        fail(
          401,
          'Credenciais inválidas'
        );
      }

      await issueSession(
        reply,
        tenantId,
        person.id
      );

      await withTenant(
        tenantId,
        db => db.query(
          `
          UPDATE users
          SET last_login_at = now()
          WHERE id = $1
          `,
          [person.id]
        )
      );

      return {
        user: {
          id: person.id,
          full_name: person.full_name,
          email: person.email,
          role: person.role
        },
        organization: {
          slug: x.slug
        }
      };
    }
  );

  // ----------------------------------------------------------
  // REQUEST PASSWORD RESET
  // ----------------------------------------------------------

  fastify.post(
    '/auth/password-reset/request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '30 minutes'
        }
      }
    },
    async req => {

      const x = resetRequestSchema.parse(
        req.body
      );

      if (!emailEnabled()) {
        fail(
          503,
          'Recuperação por email ainda não configurada'
        );
      }

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (tenantId) {
        const secret = await withTenant(
          tenantId,
          async db => {

            const result = await db.query(
              `
              SELECT id
              FROM users
              WHERE lower(email) = $1
                AND email_verified_at IS NOT NULL
                AND status = 'active'
              `,
              [x.email]
            );

            if (!result.rowCount) {
              return null;
            }

            const last = await db.query(
              `
              SELECT 1
              FROM auth_challenges
              WHERE user_id = $1
                AND purpose = 'reset_password'
                AND created_at >
                  now() - interval '5 minutes'
              LIMIT 1
              `,
              [result.rows[0].id]
            );

            if (last.rowCount) {
              return null;
            }

            return createChallenge(
              db,
              tenantId,
              result.rows[0].id,
              'reset_password',
              30
            );
          }
        );

        if (secret) {
          try {
            await sendActionEmail({
              to: x.email,
              subject:
                'Recuperar palavra-passe — AtlasOps',
              action:
                'Recuperação de palavra-passe',
              url: actionUrl(
                'reset-password',
                x.slug,
                secret
              )
            });
          } catch (error) {
            req.log.error(
              { message: error.message },
              'Email delivery failed'
            );
          }
        }
      }

      return {
        ...authSuccess,
        message:
          'Se a conta existir, enviaremos instruções por email.'
      };
    }
  );

  // ----------------------------------------------------------
  // CONFIRM PASSWORD RESET
  // ----------------------------------------------------------

  fastify.post(
    '/auth/password-reset/confirm',
    {
      config: {
        rateLimit: {
          max: 6,
          timeWindow: '15 minutes'
        }
      }
    },
    async req => {

      const x = linkSchema.extend({
        newPassword: password
      }).parse(req.body);

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (!tenantId) {
        fail(
          400,
          'Ligação inválida ou expirada'
        );
      }

      const hash = await argon2.hash(
        x.newPassword,
        HASH_OPTIONS
      );

      const userId = await withTenant(
        tenantId,
        async db => {

          const userId = await useChallenge(
            db,
            x.token,
            'reset_password'
          );

          await db.query(
            `
            UPDATE users
            SET
              password_hash = $1,
              updated_at = now()
            WHERE id = $2
            `,
            [
              hash,
              userId
            ]
          );

          await audit(
            db,
            tenantId,
            userId,
            'password.reset',
            'users',
            userId
          );

          return userId;
        }
      );

      await query(
        `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
        `,
        [
          tenantId,
          userId
        ]
      );

      return authSuccess;
    }
  );

  // ----------------------------------------------------------
  // ACCEPT EMPLOYEE INVITATION
  // ----------------------------------------------------------

  fastify.post(
    '/auth/invites/accept',
    {
      config: {
        rateLimit: {
          max: 6,
          timeWindow: '15 minutes'
        }
      }
    },
    async (req, reply) => {

      const x = linkSchema.extend({
        password
      }).parse(req.body);

      const tenantId = await tenantForSlug(
        x.slug
      );

      if (!tenantId) {
        fail(
          400,
          'Convite inválido ou expirado'
        );
      }

      const hash = await argon2.hash(
        x.password,
        HASH_OPTIONS
      );

      const userId = await withTenant(
        tenantId,
        async db => {

          const userId = await useChallenge(
            db,
            x.token,
            'staff_invite'
          );

          await db.query(
            `
            UPDATE users
            SET
              password_hash = $1,
              status = 'active',
              email_verified_at = now(),
              updated_at = now()
            WHERE id = $2
              AND status = 'disabled'
            `,
            [
              hash,
              userId
            ]
          );

          await audit(
            db,
            tenantId,
            userId,
            'invite.accepted',
            'users',
            userId
          );

          return userId;
        }
      );

      await issueSession(
        reply,
        tenantId,
        userId
      );

      return authSuccess;
    }
  );

  // ----------------------------------------------------------
  // GET CURRENT USER
  // ----------------------------------------------------------

  fastify.get(
    '/auth/me',
    async req => {

      await getActor(req);

      const org = await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          SELECT
            name,
            slug,
            currency
          FROM organizations
          WHERE id = $1
          `,
          [req.actor.tenant_id]
        )
      );

      return {
        user: req.actor,
        organization: org.rows[0]
      };
    }
  );

  // ----------------------------------------------------------
  // LOGOUT
  // ----------------------------------------------------------

  fastify.post(
    '/auth/logout',
    async (req, reply) => {

      await getActor(req);
      checkCsrf(req);

      await query(
        `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE session_hash = $1
        `,
        [
          digest(
            req.cookies[sessionName]
          )
        ]
      );

      reply.clearCookie(
        sessionName,
        { path: '/' }
      );

      reply.clearCookie(
        'ao_csrf',
        { path: '/' }
      );

      return authSuccess;
    }
  );

  // ----------------------------------------------------------
  // CHANGE PASSWORD
  // ----------------------------------------------------------

  fastify.post(
    '/auth/change-password',
    async req => {

      await getActor(req);
      checkCsrf(req);

      const x = z.object({
        currentPassword: z.string(),
        newPassword: password
      }).strict().parse(req.body);

      await withTenant(
        req.actor.tenant_id,
        async db => {

          const result = await db.query(
            `
            SELECT password_hash
            FROM users
            WHERE id = $1
            `,
            [req.actor.id]
          );

          if (
            !await argon2.verify(
              result.rows[0].password_hash,
              x.currentPassword
            )
          ) {
            fail(
              403,
              'Palavra-passe actual incorrecta'
            );
          }

          const hash = await argon2.hash(
            x.newPassword,
            HASH_OPTIONS
          );

          await db.query(
            `
            UPDATE users
            SET
              password_hash = $1,
              updated_at = now()
            WHERE id = $2
            `,
            [
              hash,
              req.actor.id
            ]
          );

          await audit(
            db,
            req.actor.tenant_id,
            req.actor.id,
            'password.changed',
            'users',
            req.actor.id
          );
        }
      );

      await query(
        `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE user_id = $1
          AND tenant_id = $2
          AND session_hash <> $3
        `,
        [
          req.actor.id,
          req.actor.tenant_id,
          digest(
            req.cookies[sessionName]
          )
        ]
      );

      return authSuccess;
    }
  );

  // ----------------------------------------------------------
  // LIST COMPANY USERS
  // ----------------------------------------------------------

  fastify.get(
    '/auth/users',
    async req => {

      await getActor(req);

      can(
        req,
        'owner',
        'admin'
      );

      const result = await withTenant(
        req.actor.tenant_id,
        db => db.query(
          `
          SELECT
            id,
            email,
            full_name,
            role,
            status,
            email_verified_at,
            created_at,
            last_login_at
          FROM users
          ORDER BY created_at DESC
          LIMIT 100
          `
        )
      );

      return {
        items: result.rows
      };
    }
  );

  // ----------------------------------------------------------
  // CREATE / INVITE COMPANY USER
  // ----------------------------------------------------------

  fastify.post(
    '/auth/users',
    async (req, reply) => {

      await getActor(req);
      checkCsrf(req);

      can(
        req,
        'owner',
        'admin'
      );

      const x = z.object({
        email,
        fullName: z
          .string()
          .trim()
          .min(2)
          .max(150),

        password: password.optional(),

        role: z.enum([
          'admin',
          'manager',
          'analyst',
          'agent'
        ])
      }).strict().parse(req.body);

      if (
        req.actor.role === 'admin' &&
        x.role === 'admin'
      ) {
        fail(
          403,
          'Só o proprietário pode criar administradores'
        );
      }

      const mail = emailEnabled();

      if (
        !mail &&
        process.env.NODE_ENV === 'production'
      ) {
        fail(
          503,
          'Configure o email para enviar convites de funcionário'
        );
      }

      if (!mail && !x.password) {
        fail(
          400,
          'Palavra-passe temporária obrigatória no ambiente local'
        );
      }

      const initialHash = await argon2.hash(
        mail ? token() : x.password,
        HASH_OPTIONS
      );

      const item = await withTenant(
        req.actor.tenant_id,
        async db => {

          const result = await db.query(
            `
            INSERT INTO users (
              tenant_id,
              email,
              password_hash,
              full_name,
              role,
              status,
              email_verified_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )
            RETURNING
              id,
              email,
              full_name,
              role,
              status
            `,
            [
              req.actor.tenant_id,
              x.email,
              initialHash,
              x.fullName,
              x.role,
              mail ? 'disabled' : 'active',
              mail ? null : new Date()
            ]
          );

          await audit(
            db,
            req.actor.tenant_id,
            req.actor.id,
            'user.created',
            'users',
            result.rows[0].id,
            {
              role: x.role
            }
          );

          const challenge = mail
            ? await createChallenge(
                db,
                req.actor.tenant_id,
                result.rows[0].id,
                'staff_invite',
                1440
              )
            : null;

          const org = await db.query(
            `
            SELECT slug
            FROM organizations
            WHERE id = $1
            `,
            [req.actor.tenant_id]
          );

          return {
            user: result.rows[0],
            challenge,
            slug: org.rows[0].slug
          };
        }
      );

      if (mail) {
        await sendSafely(
          x.email,
          'Convite para o AtlasOps',
          'Convite de colaborador',
          actionUrl(
            'accept-invite',
            item.slug,
            item.challenge
          )
        );
      }

      return reply.code(201).send({
        ...item.user,
        invitationSent: mail
      });
    }
  );

  // ----------------------------------------------------------
  // RESEND STAFF INVITATION
  // ----------------------------------------------------------

  fastify.post(
    '/auth/users/:id/resend-invite',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '30 minutes'
        }
      }
    },
    async req => {

      await getActor(req);
      checkCsrf(req);

      can(
        req,
        'owner',
        'admin'
      );

      if (!emailEnabled()) {
        fail(
          503,
          'O serviço de email não está configurado'
        );
      }

      const targetId = z
        .string()
        .uuid()
        .parse(req.params.id);

      const result = await withTenant(
        req.actor.tenant_id,
        async db => {

          const person = await db.query(
            `
            SELECT
              email,
              id
            FROM users
            WHERE id = $1
              AND status = 'disabled'
              AND email_verified_at IS NULL
            `,
            [targetId]
          );

          if (!person.rowCount) {
            fail(
              404,
              'Convite pendente não encontrado'
            );
          }

          const last = await db.query(
            `
            SELECT 1
            FROM auth_challenges
            WHERE user_id = $1
              AND purpose = 'staff_invite'
              AND created_at >
                now() - interval '5 minutes'
            LIMIT 1
            `,
            [targetId]
          );

          if (last.rowCount) {
            fail(
              429,
              'Aguarde antes de reenviar o convite'
            );
          }

          const secret = await createChallenge(
            db,
            req.actor.tenant_id,
            targetId,
            'staff_invite',
            1440
          );

          const org = await db.query(
            `
            SELECT slug
            FROM organizations
            WHERE id = $1
            `,
            [req.actor.tenant_id]
          );

          await audit(
            db,
            req.actor.tenant_id,
            req.actor.id,
            'invite.resent',
            'users',
            targetId
          );

          return {
            email: person.rows[0].email,
            slug: org.rows[0].slug,
            secret
          };
        }
      );

      await sendSafely(
        result.email,
        'Convite para o AtlasOps',
        'Convite de colaborador',
        actionUrl(
          'accept-invite',
          result.slug,
          result.secret
        )
      );

      return authSuccess;
    }
  );

  // ----------------------------------------------------------
  // UPDATE USER ROLE / STATUS
  // ----------------------------------------------------------

  fastify.patch(
    '/auth/users/:id',
    async req => {

      await getActor(req);
      checkCsrf(req);

      can(
        req,
        'owner',
        'admin'
      );

      const x = z.object({
        role: z.enum([
          'admin',
          'manager',
          'analyst',
          'agent'
        ]).optional(),

        status: z.enum([
          'active',
          'disabled'
        ]).optional()

      }).strict().refine(
        x => Object.keys(x).length > 0
      ).parse(req.body);

      const result = await withTenant(
        req.actor.tenant_id,
        async db => {

          const previous = await db.query(
            `
            SELECT
              role,
              email_verified_at,
              status
            FROM users
            WHERE id = $1
            `,
            [req.params.id]
          );

          if (
            !previous.rows[0] ||
            previous.rows[0].role === 'owner'
          ) {
            fail(
              403,
              'O proprietário não pode ser modificado'
            );
          }

          if (
            req.actor.role === 'admin' &&
            (
              x.role === 'admin' ||
              previous.rows[0].role === 'admin'
            )
          ) {
            fail(
              403,
              'Só o proprietário pode modificar administradores'
            );
          }

          if (
            x.status === 'active' &&
            !previous.rows[0].email_verified_at
          ) {
            fail(
              403,
              'Conta ainda não activada por convite'
            );
          }

          const updated = await db.query(
            `
            UPDATE users
            SET
              role = COALESCE($1, role),
              status = COALESCE($2, status),
              updated_at = now()
            WHERE id = $3
            RETURNING
              id,
              email,
              full_name,
              role,
              status
            `,
            [
              x.role ?? null,
              x.status ?? null,
              req.params.id
            ]
          );

          if (x.status === 'disabled') {
            await query(
              `
              UPDATE auth_sessions
              SET revoked_at = now()
              WHERE user_id = $1
                AND tenant_id = $2
              `,
              [
                req.params.id,
                req.actor.tenant_id
              ]
            );
          }

          await audit(
            db,
            req.actor.tenant_id,
            req.actor.id,
            'user.updated',
            'users',
            req.params.id,
            x
          );

          return updated;
        }
      );

      return result.rows[0];
    }
  );
}