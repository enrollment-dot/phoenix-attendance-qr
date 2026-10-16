\set ON_ERROR_STOP on

DO $$
DECLARE
  v_result jsonb;
  v_data jsonb;
  v_list jsonb;
BEGIN
  IF NOT has_function_privilege('anon', 'public.ylp_students_v1()', 'EXECUTE') THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE on ylp_students_v1';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_student_create_v1(text,text,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on student create RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_student_create_v1(text,text,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks EXECUTE on student create RPC';
  END IF;

  v_result := public.ylp_student_create_v1('TEST-VALID-1', 'Valid Test Student', DATE '2026-10-01', 'valid@example.com');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'valid create failed: %', v_result;
  END IF;
  v_data := v_result->'data';
  IF v_data->>'email' IS DISTINCT FROM 'valid@example.com' OR v_data->>'enrolled_from' IS DISTINCT FROM '2026-10-01' THEN
    RAISE EXCEPTION 'create response fields incorrect: %', v_data;
  END IF;

  v_result := public.ylp_student_create_v1('TEST-BAD-EMAIL', 'Invalid Email Student', DATE '2026-10-01', 'not-an-email');
  IF coalesce((v_result->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'invalid email was accepted: %', v_result;
  END IF;
  v_result := public.ylp_student_create_v1('TEST-BAD-DOT', 'Bad Domain Student', DATE '2026-10-01', 'valid@exampleXcom');
  IF coalesce((v_result->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'email without a literal domain dot was accepted: %', v_result;
  END IF;
  -- Keep validation expectations aligned with the migration's intentionally basic email format check.
  -- The current pattern requires a literal dot but does not enforce every RFC domain-label rule.

  v_result := public.ylp_student_create_v1('TEST-BLANK-EMAIL', 'Blank Email Student', DATE '2026-10-02', '   ');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'blank email should normalize to NULL: %', v_result;
  END IF;

  v_result := public.ylp_student_create_v1('TEST-CONTROL', 'Bad' || chr(127) || 'Name', DATE '2026-10-01', NULL);
  IF coalesce((v_result->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'control character in name was accepted: %', v_result;
  END IF;

  -- Legacy create payloads still resolve after the 4-argument RPC defaults are removed.
  v_result := public.ylp_student_create_v1(p_student_id := 'TEST-LEGACY-2', p_name := 'Legacy Two-Argument Create');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,enrolled_from}' IS NULL
     OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'two-argument create compatibility failed: %', v_result;
  END IF;

  v_result := public.ylp_student_create_v1(
    p_student_id := 'TEST-LEGACY-3',
    p_name := 'Legacy Three-Argument Create',
    p_enrolled_from := DATE '2026-10-03'
  );
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,enrolled_from}' IS DISTINCT FROM '2026-10-03'
     OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'three-argument create compatibility failed: %', v_result;
  END IF;

  -- Legacy update payloads must preserve email because those clients cannot submit it.
  v_result := public.ylp_student_update_v1(p_student_id := 'TEST-VALID-1', p_name := 'Legacy Two-Argument Update');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,email}' IS DISTINCT FROM 'valid@example.com'
     OR v_result#>>'{data,enrolled_from}' IS DISTINCT FROM '2026-10-04' THEN
    RAISE EXCEPTION 'two-argument update changed email or enrollment date: %', v_result;
  END IF;

  v_result := public.ylp_student_update_v1(
    p_student_id := 'TEST-VALID-1',
    p_name := 'Legacy Three-Argument Update',
    p_enrolled_from := DATE '2026-10-04'
  );
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,email}' <> 'valid@example.com'
     OR v_result#>>'{data,enrolled_from}' <> '2026-10-04' THEN
    RAISE EXCEPTION 'three-argument update changed email or failed to update enrollment date: %', v_result;
  END IF;

  v_result := public.ylp_student_update_v1('TEST-VALID-1', 'Updated Test Student', NULL, '   ');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'update did not normalize blank email to NULL: %', v_result;
  END IF;
  IF v_result#>>'{data,enrolled_from}' IS DISTINCT FROM '2026-10-04' THEN
    RAISE EXCEPTION 'update unexpectedly changed enrollment date: %', v_result;
  END IF;

  v_list := public.ylp_students_v1();
  IF NOT (v_list @> '[{"student_id":"TEST-VALID-1","email":null,"enrolled_from":"2026-10-04"}]'::jsonb) THEN
    RAISE EXCEPTION 'list RPC does not include expected email/enrollment fields: %', v_list;
  END IF;

  BEGIN
    INSERT INTO public.students(student_id, name, email, active, enrolled_from)
    VALUES ('TEST-CONSTRAINT', 'Constraint Test', 'not-an-email', true, DATE '2026-10-01');
    RAISE EXCEPTION 'email table constraint accepted invalid email';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
