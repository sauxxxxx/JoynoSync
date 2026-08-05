begin;

alter table public.leads
add column if not exists phone_timezone_bucket text not null default 'Unknown';

alter table public.leads
drop constraint if exists leads_phone_timezone_bucket_check;

alter table public.leads
add constraint leads_phone_timezone_bucket_check
check (phone_timezone_bucket in ('Eastern', 'Central', 'Pacific', 'Unknown'));

create or replace function public.classify_lead_phone_timezone_bucket(phone_input text)
returns text
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(phone_input, ''), '\D', '', 'g');
  area_code text;
  eastern_codes text[] := array[
    '201','202','203','207','212','215','216','220','223','226','227','229','231','234','239','240','248','249','252','260',
    '267','269','272','276','278','283','289','301','302','304','305','313','315','317','321','330','332','336','339','343',
    '347','351','352','363','365','380','386','401','404','407','410','412','413','416','423','434','437','438','440','443',
    '445','450','463','470','475','478','484','502','506','508','514','516','517','518','519','540','548','551','561','567',
    '570','571','579','581','582','585','603','606','609','610','613','617','631','640','646','647','667','678','679','680',
    '681','689','704','705','706','709','717','718','724','727','732','734','740','742','743','754','757','762','770','771',
    '772','774','781','782','786','802','803','810','812','814','826','828','835','838','843','845','848','854','857','859',
    '860','862','863','864','865','873','878','902','904','908','910','912','914','917','919','929','930','941','947','948',
    '954','959','973','978','980','984','989'
  ];
  central_codes text[] := array[
    '204','205','214','217','218','224','225','228','251','254','262','270','274','281','306','308','309','312','314','316',
    '318','319','320','325','327','331','334','337','346','361','364','402','405','409','414','417','431','432','447','448',
    '464','469','474','479','501','504','507','512','515','531','534','539','557','563','572','573','580','601','605','608',
    '612','615','618','620','629','630','636','639','641','651','660','662','682','701','712','713','715','726','730','731',
    '737','763','769','773','779','785','806','807','816','817','830','832','861','870','872','901','903','913','918','920',
    '931','936','938','940','945','952','956','972','975','979','985'
  ];
  pacific_codes text[] := array[
    '206','209','213','236','250','253','279','310','323','341','350','360','369','408','415','424','425','442','458','503',
    '509','510','530','541','559','562','564','604','619','626','628','650','657','661','669','672','702','707','714','725',
    '747','760','775','778','805','818','820','831','840','858','909','916','925','949','951','971'
  ];
begin
  if digits = '' then
    return 'Unknown';
  end if;
  if length(digits) = 11 and left(digits, 1) = '1' then
    digits := substr(digits, 2);
  end if;
  if length(digits) < 10 then
    return 'Unknown';
  end if;

  area_code := substr(digits, 1, 3);

  if area_code = any(pacific_codes) then
    return 'Pacific';
  end if;
  if area_code = any(central_codes) then
    return 'Central';
  end if;
  if area_code = any(eastern_codes) then
    return 'Eastern';
  end if;

  return 'Unknown';
end;
$$;

create or replace function public.set_lead_phone_timezone_bucket()
returns trigger
language plpgsql
as $$
begin
  new.phone_timezone_bucket := public.classify_lead_phone_timezone_bucket(new.phone);
  return new;
end;
$$;

drop trigger if exists set_lead_phone_timezone_bucket on public.leads;
create trigger set_lead_phone_timezone_bucket
before insert or update of phone
on public.leads
for each row
execute function public.set_lead_phone_timezone_bucket();

update public.leads
set phone_timezone_bucket = public.classify_lead_phone_timezone_bucket(phone);

create index if not exists leads_workspace_phone_timezone_idx
on public.leads (workspace_id, phone_timezone_bucket, archived_at);

commit;
