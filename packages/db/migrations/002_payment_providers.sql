ALTER TABLE obligations ADD COLUMN provider text;
UPDATE obligations b SET provider=CASE
 WHEN b.provider_order_id IS NOT NULL THEN 'razorpay'
 WHEN EXISTS(SELECT 1 FROM payment_events e WHERE e.obligation_id=b.id AND e.provider_payment_id LIKE 'sim-payment-%') THEN 'simulator'
 ELSE 'legacy_unknown' END;
ALTER TABLE obligations ALTER COLUMN provider SET NOT NULL;
ALTER TABLE obligations ADD CONSTRAINT obligation_provider_check CHECK(provider IN ('cashfree','razorpay','simulator','legacy_unknown'));
ALTER TABLE obligations DROP CONSTRAINT obligations_provider_order_id_key;
CREATE UNIQUE INDEX obligation_provider_order ON obligations(provider,provider_order_id);
ALTER TABLE obligations ADD COLUMN payment_session_id text;
ALTER TABLE obligations ADD COLUMN customer_ref text;
ALTER TABLE obligations ADD COLUMN last_checked_at timestamptz;
ALTER TABLE obligations ADD COLUMN checkout_state text NOT NULL DEFAULT 'NOT_ATTEMPTED';
ALTER TABLE orders ADD COLUMN payment_hold boolean NOT NULL DEFAULT false;
ALTER TABLE payment_events DROP CONSTRAINT payment_events_provider_payment_id_key;
ALTER TABLE payment_events DROP CONSTRAINT payment_events_obligation_id_key;
ALTER TABLE payment_events ADD COLUMN provider text;
UPDATE payment_events e SET provider=b.provider FROM obligations b WHERE b.id=e.obligation_id;
ALTER TABLE payment_events ALTER COLUMN provider SET NOT NULL;
ALTER TABLE payment_events ADD COLUMN credited_amount int NOT NULL DEFAULT 0;
UPDATE payment_events SET credited_amount=amount;
CREATE UNIQUE INDEX payment_provider_transaction ON payment_events(provider,provider_payment_id);
CREATE TABLE payment_attempts(
 provider text NOT NULL, payment_id text NOT NULL, obligation_id text NOT NULL REFERENCES obligations(id),
 status text NOT NULL, amount int NOT NULL CHECK(amount>0), currency text NOT NULL,
 provider_time timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,payment_id));
CREATE TABLE payment_observations(
 id text PRIMARY KEY, provider text NOT NULL, payment_id text NOT NULL, obligation_id text NOT NULL REFERENCES obligations(id),
 status text NOT NULL, amount int NOT NULL, source text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_exceptions(
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), obligation_id text NOT NULL REFERENCES obligations(id),
 provider text NOT NULL, payment_id text NOT NULL, reason text NOT NULL, amount int NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,payment_id,reason));
