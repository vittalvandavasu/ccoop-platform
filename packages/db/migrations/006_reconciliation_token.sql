-- Fence observational status updates without discarding authenticated receipts.
-- Existing providers, amounts, references and financial/receipt history are unchanged.
ALTER TABLE obligations ADD COLUMN reconciliation_token text;
