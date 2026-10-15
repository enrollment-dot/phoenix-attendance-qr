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
  IF v_data->>'email' <> 'valid@example.com' OR v_data->>'enrolled_from' <> '2026-10-01' THEN
    RAISE EXCEPTION 'create response fields incorrect: %', v_data;
  END IF;

  v_result := public.ylp_student_create_v1('TEST-BAD-EMAIL', 'Invalid Email Student', DATE '2026-10-01', 'not-an-email');
  IF coalesce((v_result->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'invalid email was accepted: %', v_result;
  END IF;

  v_result := public.ylp_student_create_v1('TEST-BLANK-EMAIL', 'Blank Email Student', DATE '2026-10-02', '   ');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'blank email should normalize to NULL: %', v_result;
  END IF;

  v_result := public.ylp_student_create_v1('TEST-CONTROL', 'Bad' || chr(127) || 'Name', DATE '2026-10-01', NULL);
  IF coalesce((v_result->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'control character in name was accepted: %', v_result;
  END IF;

  v_result := public.ylp_student_update_v1('TEST-VALID-1', 'Updated Test Student', NULL, '   ');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'update did not normalize blank email to NULL: %', v_result;
  END IF;
  IF v_result#>>'{data,enrolled_from}' <> '2026-10-01' THEN
    RAISE EXCEPTION 'update unexpectedly changed enrollment date: %', v_result;
  END IF;

  v_list := public.ylp_students_v1();
  IF NOT (v_list @> '[{"student_id":"TEST-VALID-1","email":null,"enrolled_from":"2026-10-01"}]'::jsonb) THEN
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
