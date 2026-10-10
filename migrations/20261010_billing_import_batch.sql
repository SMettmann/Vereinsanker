CREATE OR REPLACE FUNCTION public.import_members_batch(p_club_id uuid, p_rows jsonb, p_contribution_year integer, p_due_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_action text;
  v_target_id uuid;
  v_member_id uuid;
  v_member_number text;
  v_existing_number text;
  v_candidate integer;
  v_fee numeric;
  v_standard_fee numeric;
  v_interval text;
  v_label text;
  v_status text;
  v_status_explicit boolean;
  v_paid_at timestamptz;
  v_contribution_id uuid;
  v_current_status text;
  v_created integer := 0;
  v_updated integer := 0;
  v_renumbered integer := 0;
begin
  if not private.club_data_write_allowed(p_club_id) then
    raise exception using errcode='42501', message='ACCESS_BLOCKED';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='INVALID_IMPORT_ROWS';
  end if;

  if p_contribution_year < 2000 or p_contribution_year > 2100 then
    raise exception using errcode='22023', message='INVALID_CONTRIBUTION_YEAR';
  end if;

  select c.standard_fee into v_standard_fee
  from public.clubs c
  where c.id=p_club_id;

  if not found then
    raise exception using errcode='22023', message='CLUB_NOT_FOUND';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_action := lower(coalesce(nullif(v_item->>'action',''),'create'));
    if v_action not in ('create','update') then
      raise exception using errcode='22023', message='INVALID_IMPORT_ACTION';
    end if;

    if btrim(coalesce(v_item->>'first_name',''))='' or btrim(coalesce(v_item->>'last_name',''))='' then
      raise exception using errcode='22023', message='IMPORT_NAME_REQUIRED';
    end if;

    v_fee := greatest(0, coalesce(nullif(v_item->>'annual_fee','')::numeric, v_standard_fee, 0));
    v_interval := nullif(lower(btrim(v_item->>'billing_interval')),'');
    IF v_interval IN ('monatlich','monthly') THEN v_interval:='monthly'; END IF;
    IF v_interval IN ('jährlich','jaehrlich','yearly') THEN v_interval:='yearly'; END IF;
    IF v_interval IS NOT NULL AND v_interval NOT IN ('monthly','yearly') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='INVALID_BILLING_INTERVAL';
    END IF;
    IF v_interval='monthly' AND v_action='create' AND nullif(v_item->>'joined_at','') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MONTHLY_JOIN_DATE_REQUIRED';
    END IF;
    IF v_interval='monthly' AND v_action='update' AND
      COALESCE(nullif(v_item->>'joined_at','')::date,
        (SELECT m.joined_at FROM public.members m WHERE m.id=nullif(v_item->>'target_id','')::uuid)) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MONTHLY_JOIN_DATE_REQUIRED';
    END IF;
    v_member_number := nullif(btrim(v_item->>'member_number'),'');
    v_label := nullif(btrim(v_item->>'contribution_label'),'');
    if v_label is null then
      v_label := case when v_fee = coalesce(v_standard_fee,0) then 'Standardbeitrag' else 'Individuell' end;
    end if;

    if v_action='create' then
      if v_member_number is null or exists (
        select 1 from public.members m
        where m.club_id=p_club_id
          and m.active=true
          and m.member_number is not null
          and lower(m.member_number)=lower(v_member_number)
      ) then
        v_candidate := 1001;
        loop
          exit when not exists (
            select 1 from public.members m
            where m.club_id=p_club_id
              and m.active=true
              and lower(coalesce(m.member_number,''))=lower(v_candidate::text)
          );
          v_candidate := v_candidate + 1;
        end loop;
        v_member_number := v_candidate::text;
        v_renumbered := v_renumbered + 1;
      end if;

      insert into public.members(
        club_id,member_number,first_name,last_name,group_name,email,iban,account_holder,annual_fee,
        mandate_reference,mandate_signed_at,active,birth_date,phone,street,postal_code,city,
        contribution_label,billing_interval,joined_at,updated_at
      ) values (
        p_club_id,
        v_member_number,
        btrim(v_item->>'first_name'),
        btrim(v_item->>'last_name'),
        nullif(btrim(v_item->>'group_name'),''),
        nullif(btrim(v_item->>'email'),''),
        nullif(btrim(v_item->>'iban'),''),
        nullif(btrim(v_item->>'account_holder'),''),
        v_fee,
        nullif(btrim(v_item->>'mandate_reference'),''),
        nullif(v_item->>'mandate_signed_at','')::date,
        true,
        nullif(v_item->>'birth_date','')::date,
        nullif(btrim(v_item->>'phone'),''),
        nullif(btrim(v_item->>'street'),''),
        nullif(btrim(v_item->>'postal_code'),''),
        nullif(btrim(v_item->>'city'),''),
        v_label,
        COALESCE(v_interval,'yearly'),
        nullif(v_item->>'joined_at','')::date,
        now()
      ) returning id into v_member_id;

      v_created := v_created + 1;
    else
      v_target_id := nullif(v_item->>'target_id','')::uuid;
      if v_target_id is null then
        raise exception using errcode='22023', message='IMPORT_UPDATE_TARGET_REQUIRED';
      end if;

      select m.member_number into v_existing_number
      from public.members m
      where m.id=v_target_id and m.club_id=p_club_id
      for update;

      if not found then
        raise exception using errcode='22023', message='IMPORT_UPDATE_TARGET_NOT_FOUND';
      end if;

      if v_member_number is null then
        v_member_number := v_existing_number;
      elsif exists (
        select 1 from public.members m
        where m.club_id=p_club_id
          and m.id<>v_target_id
          and m.active=true
          and m.member_number is not null
          and lower(m.member_number)=lower(v_member_number)
      ) then
        v_member_number := v_existing_number;
        if v_member_number is null then
          v_candidate := 1001;
          loop
            exit when not exists (
              select 1 from public.members m
              where m.club_id=p_club_id
                and m.active=true
                and lower(coalesce(m.member_number,''))=lower(v_candidate::text)
            );
            v_candidate := v_candidate + 1;
          end loop;
          v_member_number := v_candidate::text;
        end if;
        v_renumbered := v_renumbered + 1;
      end if;

      update public.members
      set member_number=v_member_number,
          first_name=btrim(v_item->>'first_name'),
          last_name=btrim(v_item->>'last_name'),
          group_name=nullif(btrim(v_item->>'group_name'),''),
          email=nullif(btrim(v_item->>'email'),''),
          iban=nullif(btrim(v_item->>'iban'),''),
          account_holder=case
            when v_item ? 'account_holder' then nullif(btrim(v_item->>'account_holder'),'')
            else account_holder
          end,
          annual_fee=v_fee,
          mandate_reference=nullif(btrim(v_item->>'mandate_reference'),''),
          mandate_signed_at=nullif(v_item->>'mandate_signed_at','')::date,
          active=true,
          birth_date=coalesce(nullif(v_item->>'birth_date','')::date,birth_date),
          phone=coalesce(nullif(btrim(v_item->>'phone'),''),phone),
          street=coalesce(nullif(btrim(v_item->>'street'),''),street),
          postal_code=coalesce(nullif(btrim(v_item->>'postal_code'),''),postal_code),
          city=coalesce(nullif(btrim(v_item->>'city'),''),city),
          contribution_label=v_label,
          billing_interval=COALESCE(v_interval,billing_interval),
          joined_at=coalesce(nullif(v_item->>'joined_at','')::date,joined_at),
          updated_at=now()
      where id=v_target_id and club_id=p_club_id
      returning id into v_member_id;

      v_updated := v_updated + 1;
    end if;

    v_status_explicit := v_item ? 'contribution_status'
      and nullif(btrim(v_item->>'contribution_status'),'') is not null;
    v_status := lower(nullif(btrim(v_item->>'contribution_status'),''));
    if v_status_explicit and v_status not in ('open','paid','none') then
      raise exception using errcode='22023', message='INVALID_IMPORT_CONTRIBUTION_STATUS';
    end if;

    IF (v_interval='monthly' OR (v_action='update' AND v_interval IS NULL AND EXISTS(SELECT 1 FROM public.members m WHERE m.id=nullif(v_item->>'target_id','')::uuid AND m.billing_interval='monthly'))) AND v_status_explicit AND v_status IN ('paid','none') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MONTHLY_IMPORT_STATUS_UNSUPPORTED';
    END IF;

    v_paid_at := case
      when nullif(v_item->>'paid_at','') is null then null
      else (nullif(v_item->>'paid_at','')::date)::timestamptz
    end;

    select c.id,c.status into v_contribution_id,v_current_status
    from public.contributions c
    where c.member_id=v_member_id
      and c.contribution_year=p_contribution_year
    limit 1
    for update;

    if v_action='create' then
      if coalesce(v_status,'open') <> 'none' then
        insert into public.contributions(
          club_id,member_id,contribution_year,amount,due_date,status,paid_at,note
        ) values (
          p_club_id,v_member_id,p_contribution_year,v_fee,p_due_date,
          coalesce(v_status,'open'),
          case when v_status='paid' then v_paid_at else null end,
          case when v_status='paid' then 'Beim Mitgliederimport als bezahlt übernommen' else null end
        );
      end if;
    else
      if v_status_explicit then
        if v_status='none' then
          if v_contribution_id is not null and v_current_status='paid' then
            raise exception using errcode='22023', message='PAID_CONTRIBUTION_CANNOT_BE_REMOVED';
          end if;
          if v_contribution_id is not null then
            delete from public.contributions where id=v_contribution_id;
          end if;
        elsif v_contribution_id is not null then
          update public.contributions
          set amount=v_fee,
              due_date=coalesce(due_date,p_due_date),
              status=v_status,
              paid_at=case when v_status='paid' then v_paid_at else null end,
              note=case when v_status='paid' then 'Beim Mitgliederimport als bezahlt übernommen' else note end,
              updated_at=now()
          where id=v_contribution_id;
        else
          insert into public.contributions(
            club_id,member_id,contribution_year,amount,due_date,status,paid_at,note
          ) values (
            p_club_id,v_member_id,p_contribution_year,v_fee,p_due_date,v_status,
            case when v_status='paid' then v_paid_at else null end,
            case when v_status='paid' then 'Beim Mitgliederimport als bezahlt übernommen' else null end
          );
        end if;
      else
        if v_contribution_id is null then
          insert into public.contributions(
            club_id,member_id,contribution_year,amount,due_date,status
          ) values (
            p_club_id,v_member_id,p_contribution_year,v_fee,p_due_date,'open'
          );
        elsif v_current_status <> 'paid' then
          update public.contributions
          set amount=v_fee,updated_at=now()
          where id=v_contribution_id;
        end if;
      end if;
    end if;

    update public.members
    set contribution_exempt_years=
      case
        when v_status_explicit and v_status='none'
          then case
            when p_contribution_year=any(coalesce(contribution_exempt_years,'{}'::integer[]))
              then coalesce(contribution_exempt_years,'{}'::integer[])
            else array_append(coalesce(contribution_exempt_years,'{}'::integer[]),p_contribution_year)
          end
        else array_remove(coalesce(contribution_exempt_years,'{}'::integer[]),p_contribution_year)
      end,
      updated_at=now()
    where id=v_member_id;
  end loop;

  return jsonb_build_object(
    'created',v_created,
    'updated',v_updated,
    'renumbered',v_renumbered,
    'total',v_created+v_updated
  );
end;
$function$
;
