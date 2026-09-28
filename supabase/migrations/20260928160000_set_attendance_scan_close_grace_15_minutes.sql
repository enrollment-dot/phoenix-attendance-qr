-- Keep the existing 30-minute pre-start scan window.
-- Reduce the post-session scan grace period from 120 minutes to 15 minutes.
update public.settings
set value = '15'
where key = 'close_minutes';

DO $$
BEGIN
  IF NOT EXISTS (
    select 1 from public.settings
    where key = 'close_minutes' and value = '15'
  ) THEN
    RAISE EXCEPTION 'close_minutes was not updated to 15';
  END IF;
END $$;
