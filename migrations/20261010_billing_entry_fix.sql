CREATE OR REPLACE FUNCTION public.vf_split_monthly_contribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  first_month integer;
  month_no integer;
  due_day integer;
  due_on date;
BEGIN
  IF NEW.contribution_month <> 0 OR NEW.status <> 'open' OR NEW.sepa_exported_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT annual_fee,billing_interval,joined_at INTO m FROM public.members
  WHERE id=NEW.member_id AND club_id=NEW.club_id;
  IF NOT FOUND OR m.billing_interval <> 'monthly' THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    IF m.joined_at IS NULL THEN RETURN NULL; END IF;
  ELSE
    IF NEW.note IS NULL OR NEW.note NOT LIKE 'Eintrittsbeitrag ab %'
      OR NEW.note IS NOT DISTINCT FROM OLD.note THEN RETURN NULL; END IF;
  END IF;

  first_month := CASE
    WHEN m.joined_at IS NOT NULL AND EXTRACT(YEAR FROM m.joined_at)::integer=NEW.contribution_year
      THEN EXTRACT(MONTH FROM m.joined_at)::integer
    WHEN m.joined_at IS NOT NULL AND EXTRACT(YEAR FROM m.joined_at)::integer>NEW.contribution_year
      THEN 13 ELSE 1 END;
  due_day := COALESCE(EXTRACT(DAY FROM NEW.due_date)::integer,1);
  DELETE FROM public.contributions WHERE id=NEW.id;
  FOR month_no IN first_month..12 LOOP
    due_on := make_date(NEW.contribution_year,month_no,
      LEAST(due_day,EXTRACT(DAY FROM
        (make_date(NEW.contribution_year,month_no,1)+INTERVAL '1 month - 1 day'))::integer));
    IF month_no=first_month AND NEW.due_date IS NOT NULL AND NEW.due_date>due_on THEN
      due_on := NEW.due_date;
    END IF;
    INSERT INTO public.contributions
      (club_id,member_id,contribution_year,contribution_month,amount,due_date,status,payment_method,note)
    VALUES
      (NEW.club_id,NEW.member_id,NEW.contribution_year,month_no,ROUND(m.annual_fee/12,2),due_on,
       'open',NEW.payment_method,NEW.note);
  END LOOP;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS vf_split_monthly_contribution_on_entry_trg ON public.contributions;
CREATE TRIGGER vf_split_monthly_contribution_on_entry_trg AFTER UPDATE OF note ON public.contributions FOR EACH ROW WHEN (NEW.contribution_month=0 AND NEW.status='open') EXECUTE FUNCTION public.vf_split_monthly_contribution();