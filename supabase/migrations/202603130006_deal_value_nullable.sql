begin;

alter table public.deals
  alter column value_amount drop default,
  alter column value_amount drop not null;

commit;
