-- =====================================================================
-- KIỂM THỬ NHANH MIGRATION 0019 (1 CÂU SELECT DUY NHẤT)
-- =====================================================================

SELECT 
  (SELECT data_type || '(' || numeric_precision || ',' || numeric_scale || ')' 
     FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'supplier_payables' AND column_name = 'unit_price'
  ) AS "supplier_payables_type",

  (SELECT data_type || '(' || numeric_precision || ',' || numeric_scale || ')' 
     FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'settlement_lines' AND column_name = 'amount'
  ) AS "settlement_lines_type",

  (SELECT count(*) 
     FROM information_schema.views 
    WHERE table_schema = 'public' AND table_name IN ('v_supplier_consignment', 'v_partner_term_balance')
  ) AS "views_count (kỳ vọng: 2)",

  (SELECT count(*) 
     FROM pg_proc 
    WHERE proname IN ('complete_password_change', 'delete_receipt')
  ) AS "functions_count (kỳ vọng: 2)";
