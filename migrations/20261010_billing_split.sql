CREATE OR REPLACE FUNCTION public.vf_split_monthly_contribution()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE m record; first_month int; mon int; day_num int; due_on date;
BEGIN
  IF NEW.contribution_month <> 0 OR NEW.status <> 'open' OR NEW.sepa_exported_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT annual_fee,billing_interval,joined_at INTO m
  FROM public.members WHERE id=NEW.member_id AND club_id=NEW.club_id;
  IF NOT FOUND OR m.billing_interval <> 'monthly' THEN RETURN NULL; END IF;
  first_month := CASE
    WHEN m.joined_at IS NOT NULL AND EXTRACT(YEAR FROM m.joined_at)::int=NEW.contribution_year
      THEN EXTRACT(MONTH FROM m.joined_at)::int
    WHEN m.joined_at IS NOT NULL AND EXTRACT(YEAR FROM m.joined_at)::int>NEW.contribution_year
      THEN 13 ELSE 1 END;
  day_num := COALESCE(EXTRACT(DAY FROM NEW.due_date)::int,1);
  DELETE FROM public.contributions WHERE id=NEW.id;
  FOR mon IN first_month..12 LOOP
    due_on := make_date(NEW.contribution_year,mon,LEAST(day_num,
      EXTRACT(DAY FROM (make_date(NEW.contribution_year,mon,1)+INTERVAL '1 month - 1 day'))::int));
    IF mon=first_month AND NEW.due_date IS NOT NULL AND NEW.due_date>due_on THEN due_on:=NEW.due_date; END IF;
    INSERT INTO public.contributions
      (club_id,member_id,contribution_year,contribution_month,amount,due_date,status,payment_method,note)
    VALUES
      (NEW.club_id,NEW.member_id,NEW.contribution_year,mon,ROUND(m.annual_fee/12,2),due_on,'open',NEW.payment_method,NEW.note);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER vf_split_monthly_contribution_trg
AFTER INSERT ON public.contributions FOR EACH ROW
WHEN (NEW.contribution_month=0 AND NEW.status='open')
EXECUTE FUNCTION public.vf_split_monthly_contribution();