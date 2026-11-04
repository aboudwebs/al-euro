-- Manual identity verification for workshops without a commercial registration/license.
-- Support performs the checks outside the app (registered phone + workshop location + storefront/video evidence);
-- an admin records the evidence and makes the final activation decision in /admin/accounts.

alter table public.users
  add column if not exists license_verification_status text,
  add column if not exists license_verification_workshop_name text,
  add column if not exists license_verification_address text,
  add column if not exists license_verification_evidence text,
  add column if not exists license_verification_notes text,
  add column if not exists license_verification_reviewed_at timestamptz,
  add column if not exists license_verification_reviewed_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_license_verification_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_license_verification_status_check
      check (license_verification_status is null or license_verification_status in ('pending','verified','rejected'));
  end if;
end $$;

comment on column public.users.license_verification_evidence is
  'Admin-entered summary of identity evidence checked by support; do not store personal ID images or sensitive documents here.';
