-- Assign 9-digit login IDs to existing worker accounts.
-- Worker IDs are stored in users.phone to preserve the existing schema;
-- phone numbers for workshops, marketers and admins are untouched.
do $$
declare
  worker_row record;
  new_id text;
begin
  for worker_row in
    select id from public.users
    where role = 'worker' and (phone is null or phone !~ '^\\d{8,10}$')
  loop
    loop
      new_id := (floor(100000000 + random() * 900000000))::bigint::text;
      exit when not exists (select 1 from public.users where phone = new_id);
    end loop;

    update public.users set phone = new_id where id = worker_row.id;
  end loop;
end $$;
