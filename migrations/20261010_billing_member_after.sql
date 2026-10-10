CREATE OR REPLACE FUNCTION public.vf_member_billing_after()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_due date; this_year int;
BEGIN
 this_year:=EXTRACT(YEAR FROM CURRENT_DATE)::int;
 IF NEW.billing_interval IS DISTINCT FROM OLD.billing_interval THEN
  IF EXISTS (SELECT 1 FROM public.contributions WHERE member_id=NEW.id
    AND contribution_year=this_year AND status='open') THEN
   SELECT MIN(due_date) INTO payment_due FROM public.contributions
    WHERE member_id=NEW.id AND contribution_year=this_year AND status='open';
   DELETE FROM public.contributions WHERE member_id=NEW.id
    AND contribution_year=this_year AND status='open';
   INSERT INTO public.contributions
    (club_id,member_id,contribution_year,amount,due_date,status)
    VALUES (NEW.club_id,NEW.id,this_year,NEW.annual_fee,
     COALESCE(payment_due,make_date(this_year,3,1)),'open');
  END IF;
 ELSIF NEW.annual_fee IS DISTINCT FROM OLD.annual_fee THEN
  UPDATE public.contributions SET
   amount=CASE WHEN contribution_month=0 THEN NEW.annual_fee
      ELSE ROUND(NEW.annual_fee/12,2) END,updated_at=NOW()
   WHERE member_id=NEW.id AND contribution_year=this_year
    AND status='open' AND sepa_exported_at IS NULL;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER vf_member_billing_after_trg
AFTER UPDATE OF contribution_type_id,billing_interval,annual_fee ON public.members
FOR EACH ROW EXECUTE FUNCTION public.vf_member_billing_after();