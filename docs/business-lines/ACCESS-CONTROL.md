# TVK V2.0 P1 — Access Control (Phân quyền theo ngành hàng)

Trạng thái: **P1 đã triển khai** (migration `0025_business_lines.sql`).
Phạm vi: phân quyền ngành ở tầng database + helpers server-side. UI quản lý
phân quyền (trang Cài đặt) và bộ chọn ngành thuộc P2.

## 1. Ma trận phân quyền (§6.3)

| Vai trò | OIL | AUTO_PARTS | ALL |
|---|---|---|---|
| OWNER | Toàn quyền | Toàn quyền | Toàn quyền |
| CEO | Chỉ xem | Chỉ xem | Chỉ xem |
| ACCOUNTING | Phạm vi được gán | Phạm vi được gán | Cần gán rõ ràng |
| SALES | Phạm vi được gán | Phạm vi được gán | Không mặc định |
| WAREHOUSE | Phạm vi được gán | Phạm vi được gán | Không mặc định |

Phân quyền ngành chỉ giới hạn **phạm vi ngành**, không cấp thêm quyền chức
năng. Ví dụ: SALES chỉ-OIL không xem được AUTO_PARTS dù đổi URL, và cũng
không xem được thao tác tài chính của OWNER chỉ vì ngành trùng khớp.

Không có vai trò MANAGER hay STAFF (§6.1). Ngữ nghĩa 5 vai trò hiện có giữ nguyên.

## 2. Quy tắc tương thích P1 (quan trọng)

Migration 0025 áp dụng **Expand trước, Enforce sau** (§15.1):

- User **chưa có dòng nào** trong `user_business_lines` vẫn thấy **toàn bộ**
  (hành vi cũ). Chỉ khi OWNER đã gán phân quyền thì phạm vi mới thu hẹp.
- Sản phẩm/chứng từ **chưa phân loại** (`business_line_id IS NULL`) vẫn hiển
  thị với mọi người (hành vi cũ) cho tới khi được phân loại thủ công.
- OWNER/CEO luôn thấy mọi ngành (CEO chỉ xem — RLS ghi hiện có vẫn chặn CEO
  ghi ở mọi bảng).

Quy tắc này giữ cho "Existing application remains functional" (P1 Exit Gate).
Việc bắt buộc gán (user không gán = không thấy gì) thuộc **P2** và cần quyết
định của chủ cửa hàng trước khi siết — xem "Câu hỏi mở" ở cuối file.

## 3. Hàm `user_can_access_business_line(p_user_id, p_business_line_id)`

`SECURITY DEFINER, STABLE`, trả về boolean:

1. `p_business_line_id IS NULL` → true (chưa phân loại — legacy).
2. Profile không tồn tại hoặc không active → false (fail-closed).
3. Role OWNER/CEO (và active) → true.
4. User không có phân quyền nào → true (tương thích P1).
5. Ngược lại: true chỉ khi có dòng `user_business_lines` khớp đúng ngành.

Hàm dùng trong `v_batches_for_sales` và sẽ dùng cho RLS các bảng chứng từ ở P2.

## 4. RLS trên bảng mới (migration 0025)

### business_lines
- SELECT: mọi `authenticated` (cần cho bộ chọn ngành ở P2).
- INSERT/UPDATE/DELETE: chỉ OWNER.

### user_business_lines
- SELECT: chính mình (`user_id = auth.uid()`), hoặc OWNER/CEO xem tất cả.
- INSERT/DELETE: chỉ OWNER.
- Không có policy UPDATE: đổi phân quyền = DELETE dòng cũ + INSERT dòng mới.

### business_line_group_mappings
- SELECT: mọi `authenticated`; INSERT/UPDATE/DELETE: chỉ OWNER.

### product_business_line_audit (append-only)
- SELECT: OWNER/ACCOUNTING/CEO.
- Không policy INSERT/UPDATE/DELETE + `REVOKE INSERT, UPDATE, DELETE` ở tầng
  GRANT. Chỉ trigger `SECURITY DEFINER` và migration (postgres) ghi được.

### Các cột business_line_id trên bảng hiện có
Không đổi policy RLS của các bảng đó — policy hiện có (theo vai trò) vẫn áp
dụng; cột mới chỉ là dữ liệu, không phải cửa truy cập mới.

## 5. `v_batches_for_sales` (§6.5)

Giữ nguyên guard active-profile của 0024 (JWT không có profile TVK active →
0 dòng), thêm điều kiện `user_can_access_business_line(auth.uid(),
p.business_line_id)`. Không có cột giá vốn (`unit_cost`,
`consignment_price`) trong view — kiểm chứng trong
`docs/tests/p1_business_lines_local.sql` mục H1.

Kết quả kiểm chứng trên database local (seed 2 lô: 1 AUTO_PARTS, 1 OIL):

| Người dùng | Thấy |
|---|---|
| Không JWT | 0 dòng |
| SALES chỉ-OIL | 1 dòng OIL, 0 dòng AUTO_PARTS |
| SALES chưa gán | 2 dòng (tương thích P1) |
| CEO | 2 dòng |
| OWNER | 2 dòng |
| Authenticated không có profile | 0 dòng |

## 6. Server-side (code app, P1)

- `src/lib/types.ts`: `BusinessLineCode`, `BusinessLine`,
  `BUSINESS_LINE_LABELS`, `userHasBusinessLineAccess()` (bản TypeScript của
  cùng quy tắc tương thích P1 — dùng ở P2).
- `src/lib/business-lines.ts`: `listBusinessLines()`,
  `getUserBusinessLineIds()`, `getMyBusinessLineIds()`,
  `canChangeProductBusinessLine()` (kiểm tra sớm, không thay thế guard DB),
  `listUnclassifiedProducts()`.
- `src/lib/actions.ts` (OWNER-only, có `requireRole` + RLS đỡ sau):
  `assignUserBusinessLineAction`, `revokeUserBusinessLineAction`,
  `updateProductBusinessLineAction` (đổi ngành sản phẩm; trigger DB chặn
  lại lần nữa và ghi kiểm toán).

Nguyên tắc: không bao giờ tin `business_line_id` do trình duyệt gửi lên —
mọi kiểm tra phân quyền ngành đều đọc từ database.

## 7. Câu hỏi mở (CẦN XÁC NHẬN — quyết ở P2, không chặn P1)

1. **Siết bắt buộc gán khi nào?** P1 đang để user chưa gán = thấy toàn bộ.
   Khi nào OWNER muốn đổi thành "không gán = không thấy gì"? (Khuyến nghị:
   siết ở P2 sau khi OWNER đã gán xong cho 5 tài khoản hiện có.)
2. **Gán mặc định cho 5 tài khoản hiện có?** P1 không tự gán dòng nào trong
   `user_business_lines`. OWNER muốn tự gán tay (qua action P1 / UI P2) hay
   muốn migration P2 gán mặc định cả 2 ngành cho OWNER + CEO và 1 ngành cho
   từng tài khoản còn lại?
