insert into public.site_admins (user_id)
select id from auth.users where email = 'admin@nikke.local';