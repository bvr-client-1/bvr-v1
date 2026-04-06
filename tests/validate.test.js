import test from 'node:test';
import assert from 'node:assert/strict';
import Joi from 'joi';
import { validate } from '../backend/middleware/validate.js';

test('validate sanitizes body by replacement', async () => {
  const req = { body: { keep: 'value', drop: 'x' } };
  let nextArg;
  await validate(Joi.object({ keep: Joi.string().required() }), 'body')(req, {}, (value) => {
    nextArg = value;
  });
  assert.equal(nextArg, undefined);
  assert.deepEqual(req.body, { keep: 'value' });
});

test('validate sanitizes query without replacing Express query object', async () => {
  const query = { phone: '9876543210', drop: 'x' };
  const req = { query };
  await validate(Joi.object({ phone: Joi.string().required() }), 'query')(req, {}, () => {});
  assert.equal(req.query, query);
  assert.deepEqual(req.query, { phone: '9876543210' });
});
