ALTER TABLE obligations ADD COLUMN last_reconcile_at timestamptz;
ALTER TABLE obligations ADD COLUMN reconciliation_error text;
