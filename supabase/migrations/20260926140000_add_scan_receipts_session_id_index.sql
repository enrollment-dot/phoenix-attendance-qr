-- Performance: cover the scan_receipts -> sessions foreign key lookup.
CREATE INDEX IF NOT EXISTS idx_scan_receipts_session_id
ON public.scan_receipts (session_id);
