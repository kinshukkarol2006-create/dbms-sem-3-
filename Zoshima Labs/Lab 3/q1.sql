-- 1. Status Change Audit Trigger

CREATE OR REPLACE FUNCTION
log_status_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO appointment_log(
  appointment_id,
  old_status,
  new_status,
  changed_at
  )
  VALUES(
  OLD.appointment_id,
  OLD.status,
  NEW.status,
  '2026-01-01 00:00:00'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_status_audit
AFTER UPDATE OF status ON appointment
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION log_status_change();