create function public.set_member_role(p_user uuid, p_role public.user_role, p_org uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_target public.profiles;
  v_admin_count int;
begin
  if v_caller is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_caller and org_id = p_org and role = 'admin'
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  select * into v_target from public.profiles where id = p_user;
  if v_target.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not (v_target.org_id is null or v_target.org_id = p_org) then
    perform private.fail(403, 'forbidden', 'That member belongs to a different organization');
  end if;

  if v_target.role = 'admin' and v_target.org_id = p_org and p_role <> 'admin' then
    select count(*) into v_admin_count from public.profiles where org_id = p_org and role = 'admin';
    if v_admin_count <= 1 then
      perform private.fail(409, 'illegal_transition', 'Cannot demote the organization''s last admin');
    end if;
  end if;

  update public.profiles
    set role = p_role, org_id = case when p_role = 'patient' then null else p_org end
    where id = p_user
    returning * into v_target;

  return v_target;
end;
$$;

revoke execute on function public.set_member_role(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.set_member_role(uuid, public.user_role, uuid) to authenticated;
