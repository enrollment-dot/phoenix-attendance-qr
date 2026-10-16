\set ON_ERROR_STOP on

DO $$
DECLARE
  v_result jsonb;
  v_data jsonb;
  v_list jsonb;
  v_signature regprocedure;
  v_config text[];
  v_is_definer boolean;
  v_has_defaults boolean;
  v_default_expression text;
  v_expected_bangkok_date date;
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

  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ylp_student_create_v1', 'ylp_student_update_v1', 'ylp_students_v1')
  LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'client role unexpectedly has EXECUTE on %', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('postgres', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'backend role lacks EXECUTE on %', v_signature;
    END IF;
    SELECT p.prosecdef, p.proconfig
      INTO v_is_definer, v_config
    FROM pg_proc p
    WHERE p.oid = v_signature;
    IF v_is_definer IS NOT TRUE OR NOT (coalesce(v_config, ARRAY[]::text[]) @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'SECURITY DEFINER or empty search_path missing on %: %, %', v_signature, v_is_definer, v_config;
    END IF;
  END LOOP;

  SELECT p.proargdefaults IS NOT NULL INTO v_has_defaults
  FROM pg_proc p
  WHERE p.oid = 'public.ylp_student_create_v1(text,text,date,text)'::regprocedure;
  IF v_has_defaults IS NOT FALSE THEN
    RAISE EXCEPTION 'four-argument create RPC still has defaults';
  END IF;
  SELECT p.proargdefaults IS NOT NULL INTO v_has_defaults
  FROM pg_proc p
  WHERE p.oid = 'public.ylp_student_update_v1(text,text,date,text)'::regprocedure;
  IF v_has_defaults IS NOT FALSE THEN
    RAISE EXCEPTION 'four-argument update RPC still has defaults';
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

  -- The table default and legacy two-argument wrapper must use Bangkok's date, not session CURRENT_DATE.
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_default_expression
  FROM pg_catalog.pg_attrdef d
  JOIN pg_catalog.pg_class c ON c.oid = d.adrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
  WHERE n.nspname = 'public' AND c.relname = 'students' AND a.attname = 'enrolled_from';
  IF v_default_expression IS NULL OR position('Asia/Bangkok' IN v_default_expression) = 0 THEN
    RAISE EXCEPTION 'enrolled_from default is not explicitly tied to Asia/Bangkok: %', v_default_expression;
  END IF;
  PERFORM pg_catalog.set_config('TimeZone', 'Pacific/Honolulu', true);
  v_expected_bangkok_date := (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date;

  -- Legacy create payloads still resolve and use the business timezone after defaults are removed.
  v_result := public.ylp_student_create_v1(p_student_id := 'TEST-LEGACY-2', p_name := 'Legacy Two-Argument Create');
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,enrolled_from}' IS DISTINCT FROM v_expected_bangkok_date::text
     OR v_result#>>'{data,email}' IS NOT NULL THEN
    RAISE EXCEPTION 'two-argument create compatibility or Bangkok date default failed: expected %, got %', v_expected_bangkok_date, v_result;
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
     OR v_result#>>'{data,enrolled_from}' IS DISTINCT FROM '2026-10-01' THEN
    RAISE EXCEPTION 'two-argument update changed email or enrollment date: %', v_result;
  END IF;

  v_result := public.ylp_student_update_v1(
    p_student_id := 'TEST-VALID-1',
    p_name := 'Legacy Three-Argument Update',
    p_enrolled_from := DATE '2026-10-04'
  );
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_result#>>'{data,email}' IS DISTINCT FROM 'valid@example.com'
     OR v_result#>>'{data,enrolled_from}' IS DISTINCT FROM '2026-10-04' THEN
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
