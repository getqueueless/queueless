begin;
select plan(9);

select ok(has_function_privilege('authenticated', 'private.my_role()', 'execute'), 'authenticated can call private.my_role');
select ok(has_function_privilege('authenticated', 'private.my_org()', 'execute'), 'authenticated can call private.my_org');
select ok(has_function_privilege('authenticated', 'private.is_staff_of(uuid)', 'execute'), 'authenticated can call private.is_staff_of');
select ok(has_function_privilege('authenticated', 'private.is_admin_of(uuid)', 'execute'), 'authenticated can call private.is_admin_of');

select is(
  has_function_privilege('authenticated', 'private.mint_token(uuid,uuid,lane,uuid,text,uuid,timestamptz,uuid,uuid)', 'execute'),
  false, 'authenticated cannot call private.mint_token'
);
select is(
  has_function_privilege('authenticated', 'private.fail(int,text,text,int,jsonb)', 'execute'),
  false, 'authenticated cannot call private.fail'
);
select is(
  has_function_privilege('authenticated', 'private.housekeeping(timestamptz)', 'execute'),
  false, 'authenticated cannot call private.housekeeping'
);
select is(
  has_function_privilege('authenticated', 'private.rebuild_boards(uuid,date)', 'execute'),
  false, 'authenticated cannot call private.rebuild_boards'
);
select is(
  has_function_privilege('anon', 'private.my_role()', 'execute'),
  false, 'anon cannot call any private function, including the helpers'
);

select * from finish(true);
rollback;
