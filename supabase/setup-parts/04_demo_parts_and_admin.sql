-- ---------------------------------------------------------------------------
-- 5) Seed: the 8 demo parts - ONLY when `parts` is empty.
--    model / years are blank and branch is a placeholder: edit them from /admin/parts.
-- ---------------------------------------------------------------------------
insert into public.parts (id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url, is_active, created_at)
select v.* from (values
  ('1', 'فلتر زيت',          'Mercedes-Benz', '', '', 'A2761800009', null::text, 18::numeric,  42, 'الفرع الرئيسي', null::text, true, now()),
  ('2', 'طقم فحمات أمامي',   'BMW',           '', '', '34116761244', null::text, 75::numeric,  15, 'الفرع الرئيسي', null::text, true, now()),
  ('3', 'مضخة مياه',         'Audi',          '', '', '06H121026',   null::text, 95::numeric,   8, 'الفرع الرئيسي', null::text, true, now()),
  ('4', 'مساعد أمامي',       'Range Rover',   '', '', 'LR032049',    null::text, 210::numeric,  5, 'الفرع الرئيسي', null::text, true, now()),
  ('5', 'بوجي إشعال',        'Volkswagen',    '', '', '06K905601',   null::text, 12::numeric,  60, 'الفرع الرئيسي', null::text, true, now()),
  ('6', 'حساس أوكسجين',      'BMW',           '', '', '11787589121', null::text, 64::numeric,   0, 'الفرع الرئيسي', null::text, true, now()),
  ('7', 'فلتر هواء',         'Mercedes-Benz', '', '', 'A2760940004', null::text, 22::numeric,  30, 'الفرع الرئيسي', null::text, true, now()),
  ('8', 'سير مجموعة',        'Audi',          '', '', '06E903137',   null::text, 38::numeric,  12, 'الفرع الرئيسي', null::text, true, now())
) as v(id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url, is_active, created_at)
where not exists (select 1 from public.parts);

-- ---------------------------------------------------------------------------
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
