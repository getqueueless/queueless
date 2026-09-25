-- P1 (red-team audit): set_member_role (0028) checked that the caller is an admin of the target
-- org and that the target isn't ALREADY in a different org -- it never checked whether the
-- target is a real, established patient. Since profiles_read_org_staff (0045) lets any staff/
-- admin of an org read every profile in that org, an admin could search any unassigned patient
-- by name (mobile's admin/staff.tsx recruit search: `profiles where org_id is null and
-- role = 'patient'`, org-unscoped by design) and pull a complete stranger into their org as
-- staff, then read that person's phone and date of birth through the very policy meant to let
-- staff see their own colleagues.
--
-- Checked against the actual recruit flow before writing this (apps/mobile/src/app/(app)/(tabs)/
-- admin/staff.tsx): its own comment says the intended path is "someone with no account yet has
-- to sign up first ... which is when their profile starts existing with org_id = null" -- i.e. a
-- prospective hire creates an account and an admin then promotes it, before that account is ever
-- used as a real patient. `profile_completed_at` is exactly the signal for "used as a real
-- patient" (stamped by complete_my_profile, 0037) -- blocking reassignment once it's set closes
-- the abuse case (grabbing an existing stranger's real, in-use patient account) without touching
-- the recruit flow's own actual use (a fresh signup, profile never completed, promoted directly).
create or replace function public.set_member_role(p_user uuid, p_role public.user_role, p_org uuid)
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

  if v_target.role = 'patient' and p_role in ('staff', 'admin') and v_target.profile_completed_at is not null then
    perform private.fail(403, 'patient_reassignment_blocked', 'Patients must be invited, not reassigned');
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
