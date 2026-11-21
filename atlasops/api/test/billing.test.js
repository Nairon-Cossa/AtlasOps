import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANS,
  isAllowed,
  paymentMatches
} from '../src/routes/billing.js';

// =====================================================
// TEST 1: PLAN LIMITS
// =====================================================

test(
  'Plans have server-controlled prices and account caps',
  () => {

    assert.deepEqual(
      Object.keys(PLANS),
      ['starter', 'growth', 'scale']
    );

    assert.equal(
      PLANS.starter.amount,
      2990
    );

    assert.equal(
      PLANS.growth.seats,
      20
    );
  }
);

// =====================================================
// TEST 2: TRIAL EXPIRATION
// =====================================================

test(
  'Trial expires and unpaid workspaces cannot use business APIs',
  () => {

    assert.equal(
      isAllowed({
        status: 'trialing',
        trial_ends_at: '2000-01-01T00:00:00Z'
      }),
      false
    );

    assert.equal(
      isAllowed({
        status: 'trialing',
        trial_ends_at: '2099-01-01T00:00:00Z'
      }),
      true
    );

    assert.equal(
      isAllowed({
        status: 'past_due',
        current_period_end: '2099-01-01T00:00:00Z'
      }),
      false
    );
  }
);

// =====================================================
// TEST 3: PAID SUBSCRIPTION
// =====================================================

test(
  'Paid access requires a non-expired billing period',
  () => {

    assert.equal(
      isAllowed({
        status: 'active',
        current_period_end: '2000-01-01T00:00:00Z'
      }),
      false
    );

    assert.equal(
      isAllowed({
        status: 'active',
        current_period_end: '2099-01-01T00:00:00Z'
      }),
      true
    );
  }
);

// =====================================================
// TEST 4: PAYMENT INTEGRITY
// =====================================================

test(
  'A payment cannot activate an unrelated or changed order',
  () => {

    const order = {
      id: 'order-abc',
      provider_id: 'epay123',
      amount_mzn: '2990.00'
    };

    const valid = {
      id: 'epay123',
      external_reference: 'order-abc',
      amount: '2990.00',
      currency: 'MZN',
      status: 'paid'
    };

    assert.equal(
      paymentMatches(order, valid),
      true
    );

    assert.equal(
      paymentMatches(order, {
        ...valid,
        amount: '299.00'
      }),
      false
    );

    assert.equal(
      paymentMatches(order, {
        ...valid,
        external_reference: 'other'
      }),
      false
    );

    assert.equal(
      paymentMatches(order, {
        ...valid,
        currency: 'USD'
      }),
      false
    );

    assert.equal(
      paymentMatches(order, {
        ...valid,
        status: 'pending'
      }),
      false
    );

    assert.equal(
      paymentMatches(order, {
        ...valid,
        id: 'another'
      }),
      false
    );
  }
);