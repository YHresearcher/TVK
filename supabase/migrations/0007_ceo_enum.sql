-- =====================================================================
-- 0007_ceo_enum.sql — Thêm giá trị 'CEO' vào enum app_role
-- PHẢI CHẠY RIÊNG FILE NÀY, TRƯỚC 0008_ceo_readonly.sql:
-- PostgreSQL không cho phép dùng một giá trị enum mới trong cùng
-- transaction vừa tạo ra nó. File 0008 tạo policy tham chiếu 'CEO'
-- nên hai file không thể gộp chung / chạy cùng một lượt.
-- =====================================================================

alter type public.app_role add value if not exists 'CEO';
