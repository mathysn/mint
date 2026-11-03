-- The admin log is append-only: staff actions can never be edited or erased.
CREATE FUNCTION admin_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_log is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_log_append_only BEFORE UPDATE OR DELETE ON "admin_log"
  FOR EACH ROW EXECUTE FUNCTION admin_log_append_only();
