import test from 'node:test';
import assert from 'node:assert/strict';

import {
  signupMode,
  emailEnabled,
  actionUrl
} from '../src/lib/mailer.js';

// ============================================================
// ATLASOPS — ONBOARDING UNIT TESTS
// ============================================================

// Test 1: Public registration must fail closed without email.

test(
  'Public registration requires email configuration',
  () => {
    const original = {
      SIGNUP_MODE: process.env.SIGNUP_MODE,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM
    };

    try {
      process.env.SIGNUP_MODE = 'open';

      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;

      assert.equal(emailEnabled(), false);
      assert.equal(signupMode(), 'invite');

    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }
);

// Test 2: Open registration requires email credentials.

test(
  'Open registration requires email credentials',
  () => {
    const original = {
      SIGNUP_MODE: process.env.SIGNUP_MODE,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM
    };

    try {
      process.env.SIGNUP_MODE = 'open';

      process.env.RESEND_API_KEY = 'test-key';
      process.env.EMAIL_FROM =
        'AtlasOps <test@example.com>';

      assert.equal(emailEnabled(), true);
      assert.equal(signupMode(), 'open');

      process.env.SIGNUP_MODE = 'invite';

      assert.equal(signupMode(), 'invite');

    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }
);

// Test 3: Email action links must preserve parameters.

test(
  'Email links preserve origin and parameters',
  () => {
    const originalOrigin = process.env.PUBLIC_ORIGIN;

    try {
      process.env.PUBLIC_ORIGIN =
        'http://localhost:18080';

      const link = new URL(
        actionUrl(
          'verify-email',
          'empresa-demo',
          'test-token'
        )
      );

      assert.equal(
        link.origin,
        'http://localhost:18080'
      );

      assert.equal(
        link.searchParams.get('action'),
        'verify-email'
      );

      assert.equal(
        link.searchParams.get('slug'),
        'empresa-demo'
      );

      assert.equal(
        link.searchParams.get('token'),
        'test-token'
      );

    } finally {
      if (originalOrigin === undefined) {
        delete process.env.PUBLIC_ORIGIN;
      } else {
        process.env.PUBLIC_ORIGIN = originalOrigin;
      }
    }
  }
);