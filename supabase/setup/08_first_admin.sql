-- 6) Promote YOUR first admin
--    a) Register a normal marketer account in the app (/login -> marketer tab).
--    b) Replace 09XXXXXXXX with that account's phone and run this statement
--       (with the placeholder it matches nothing and changes nothing).
--    c) Sign in at /admin/login with the same phone and password.
-- ---------------------------------------------------------------------------
update public.users
   set role = 'admin', is_active = true
 where phone = '09XXXXXXXX' and role = 'marketer'
returning id, name, phone, role, is_active;

-- Storage: the private buckets "receipts", "special-requests" and "avatars" and the public bucket
-- "parts-images" are created automatically by the API on first upload.
