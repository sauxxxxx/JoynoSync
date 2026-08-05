begin;

create or replace function public.classify_lead_phone_timezone_bucket(phone_input text)
returns text
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(phone_input, ''), '\D', '', 'g');
  area_code text;
  eastern_codes text[] := array[
    '201','202','203','207','212','215','216','220','223','226','227','229','231','234','239','240','242','248','249','252','260','263',
    '267','269','272','276','278','283','289','301','302','304','305','313','315','317','321','324','326','329','330','332','336','339',
    '343','345','347','351','352','354','363','365','367','380','382','386','401','404','407','410','412','413','416','418','419','423',
    '428','434','436','437','438','440','443','445','450','463','468','470','472','475','478','484','502','506','508','513','514','516',
    '517','518','519','540','548','551','561','567','570','571','574','579','581','582','584','585','586','603','606','607','609','610',
    '613','614','616','617','624','631','640','645','646','647','649','656','658','667','678','679','680','681','683','686','689','703',
    '704','705','706','709','716','717','718','724','727','728','729','732','734','740','742','743','753','754','757','762','765','770',
    '771','772','774','781','782','786','802','803','804','810','812','813','814','819','821','826','828','835','838','839','843','845',
    '848','854','856','857','859','860','862','863','864','865','873','876','878','902','904','905','906','908','910','912','914','917',
    '919','929','930','934','937','941','943','947','948','954','959','973','978','980','984','989'
  ];
  central_codes text[] := array[
    '204','205','210','214','217','218','219','224','225','228','235','251','254','256','262','270','274','281','306','308','309','312',
    '314','316','318','319','320','325','327','331','334','337','346','353','361','364','402','405','409','414','417','430','431','432',
    '447','448','457','464','469','471','474','479','501','504','507','512','515','531','534','539','557','563','572','573','580','601',
    '605','608','612','615','618','620','629','630','636','639','641','651','659','660','662','682','701','708','712','713','715','726',
    '730','731','737','763','769','773','779','785','806','807','815','816','817','830','832','847','850','861','870','872','901','903',
    '913','918','920','924','931','936','938','940','945','952','956','972','975','979','985'
  ];
  mountain_codes text[] := array[
    '208','303','307','368','385','403','406','435','480','505','520','575','587','602','623','719','720','780','801','825','915','928',
    '970','983','986'
  ];
  pacific_codes text[] := array[
    '206','209','213','236','250','253','279','310','323','341','350','360','369','408','415','424','425','442','458','503','509','510',
    '530','541','559','562','564','604','619','626','628','650','657','661','669','672','702','707','714','725','738','747','760','775',
    '778','805','818','820','831','840','858','909','916','925','949','951','971'
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
  if area_code = any(mountain_codes) then
    return 'Mountain';
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

create or replace function public.resolve_lead_phone_timezone_bucket(primary_phone text, fallback_phone text)
returns text
language plpgsql
immutable
as $$
declare
  primary_bucket text := public.classify_lead_phone_timezone_bucket(primary_phone);
begin
  if primary_bucket <> 'Unknown' then
    return primary_bucket;
  end if;

  return public.classify_lead_phone_timezone_bucket(fallback_phone);
end;
$$;

create or replace function public.set_lead_phone_timezone_bucket()
returns trigger
language plpgsql
as $$
begin
  new.phone_timezone_bucket := public.resolve_lead_phone_timezone_bucket(new.phone, new.secondary_phone);
  return new;
end;
$$;

drop trigger if exists set_lead_phone_timezone_bucket on public.leads;

create trigger set_lead_phone_timezone_bucket
before insert or update of phone, secondary_phone
on public.leads
for each row
execute function public.set_lead_phone_timezone_bucket();

alter table public.leads disable trigger set_leads_updated_at;

with recalculated as (
  select
    id,
    public.resolve_lead_phone_timezone_bucket(phone, secondary_phone) as phone_timezone_bucket
  from public.leads
)
update public.leads as leads
set phone_timezone_bucket = recalculated.phone_timezone_bucket
from recalculated
where leads.id = recalculated.id
  and leads.phone_timezone_bucket is distinct from recalculated.phone_timezone_bucket;

alter table public.leads enable trigger set_leads_updated_at;

commit;
