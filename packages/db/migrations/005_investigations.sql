-- Operational metadata only. Original money, receipts, stock and snapshots stay intact.
CREATE TABLE investigations (
 id text PRIMARY KEY, campus_id text NOT NULL REFERENCES campuses(id), drop_id text NOT NULL REFERENCES drops(id),
 obligation_id text REFERENCES obligations(id), receipt_id text REFERENCES receipts(id), variant_id text REFERENCES variants(id),
 category text NOT NULL CHECK(category IN ('PAYMENT_REVIEW','MISSING','DAMAGED','INCORRECT','EXCESS')),
 reported_quantity int CHECK(reported_quantity>0),
 CHECK((category IN ('INCORRECT','EXCESS') AND reported_quantity IS NOT NULL) OR (category NOT IN ('INCORRECT','EXCESS') AND reported_quantity IS NULL)),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','INVESTIGATING','REVIEWED_HELD')),
 assigned_to text REFERENCES users(id), revision int NOT NULL DEFAULT 0 CHECK(revision>=0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((category='PAYMENT_REVIEW' AND obligation_id IS NOT NULL AND receipt_id IS NULL AND variant_id IS NULL AND reported_quantity IS NULL)
 OR (category<>'PAYMENT_REVIEW' AND obligation_id IS NULL AND receipt_id IS NOT NULL AND variant_id IS NOT NULL)),
 UNIQUE(obligation_id), UNIQUE(receipt_id,variant_id,category)
);
CREATE TABLE investigation_actions (
 id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id), actor text NOT NULL REFERENCES users(id),
 request_key text NOT NULL, payload_hash text NOT NULL, action text NOT NULL CHECK(action IN ('ASSIGN','NOTE','REVIEW_HELD','REOPEN','RECONCILE')),
 reason text NOT NULL, reference text NOT NULL DEFAULT '', result jsonb NOT NULL,
 state text NOT NULL DEFAULT 'DONE' CHECK(state IN ('DONE','QUEUED','PROCESSING','FAILED')),
 attempts int NOT NULL DEFAULT 0, lease_until timestamptz, lease_token text, available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(actor,request_key)
);
CREATE INDEX investigation_scope ON investigations(campus_id,status,created_at);
CREATE INDEX investigation_jobs ON investigation_actions(state,available_at,lease_until);
