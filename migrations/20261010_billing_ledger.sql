ALTER TABLE public.contributions DROP CONSTRAINT IF EXISTS contributions_member_id_contribution_year_key;
ALTER TABLE public.contributions ADD CONSTRAINT contributions_member_year_month_key UNIQUE (member_id,contribution_year,contribution_month);
CREATE INDEX IF NOT EXISTS contributions_monthly_by_club ON public.contributions (club_id,contribution_year,contribution_month);