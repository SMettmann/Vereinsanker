CREATE OR REPLACE FUNCTION public.vf_installment_amount_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE yearly_fee numeric;
BEGIN
  IF NEW.contribution_month > 0 AND NEW.amount IS DISTINCT FROM OLD.amount THEN
    IF OLD.sepa_exported_at IS NOT NULL OR OLD.status = 'paid' THEN
      NEW.amount := OLD.amount;
    ELSE
      SELECT annual_fee INTO yearly_fee
      FROM public.members WHERE id=NEW.member_id AND club_id=NEW.club_id;
      IF FOUND THEN NEW.amount := ROUND(yearly_fee/12,2); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS vf_installment_amount_guard_trg ON public.contributions;
CREATE TRIGGER vf_installment_amount_guard_trg BEFORE UPDATE OF amount ON public.contributions FOR EACH ROW EXECUTE FUNCTION public.vf_installment_amount_guard();