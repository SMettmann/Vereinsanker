CREATE OR REPLACE FUNCTION public.vf_member_billing_before()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE interval_value text;
BEGIN
  IF NEW.contribution_type_id IS NOT NULL THEN
    SELECT t.billing_interval INTO interval_value FROM public.contribution_types t
    WHERE t.id=NEW.contribution_type_id AND t.club_id=NEW.club_id;
    NEW.billing_interval := COALESCE(interval_value,'yearly');
  END IF;
  IF TG_OP='UPDATE' AND NEW.billing_interval IS DISTINCT FROM OLD.billing_interval THEN
    IF EXISTS (SELECT 1 FROM public.contributions c
      WHERE c.member_id=NEW.id AND c.contribution_year=EXTRACT(YEAR FROM CURRENT_DATE)::int
      AND (c.status='paid' OR c.sepa_exported_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'BILLING_INTERVAL_LOCKED_CURRENT_YEAR';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vf_member_billing_before_trg
BEFORE INSERT OR UPDATE OF contribution_type_id,billing_interval ON public.members
FOR EACH ROW EXECUTE FUNCTION public.vf_member_billing_before();