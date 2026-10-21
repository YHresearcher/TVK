# ĐẶC TẢ HỆ THỐNG QUẢN LÝ HÀNG HOÁ — CỬA HÀNG PHỤ TÙNG Ô TÔ

**Phiên bản:** 1.0 — bản thống nhất sau các buổi trao đổi ngày 21/10/2026
**Trạng thái:** Đã chốt về cấu trúc và chức năng. Một số điểm vận hành chờ chốt ở Mục 12.
**Đặc điểm cốt lõi:** Hàng mua đứt và hàng ký gửi cùng tồn tại; ký gửi hai chiều (nhận từ nhà cung cấp và gửi đi cho đối tác).

---

## 1. Mục tiêu hệ thống

- Quản lý toàn bộ vòng đời hàng hoá: nhập → lưu kho → bán / gửi ký gửi → tiêu thụ → xuất hoá đơn → thanh toán → trả hàng.
- Tại mọi thời điểm trả lời chính xác 3 câu hỏi: hàng này **của ai**, đang **nằm ở kho nào**, và **đã trả tiền / phải thu bao nhiêu**.
- Không bao giờ lẫn lộn giữa hàng bán trực tiếp (có chiết khấu) và hàng ký gửi — ở cả 3 tầng: tồn kho, chứng từ, công nợ.
- Tự động sinh công nợ: bán hàng ký gửi → phải trả nhà cung cấp; đối tác tiêu thụ hàng ký gửi → phải thu đối tác.

## 2. Sáu nguyên tắc thiết kế cốt lõi (không được phá vỡ)

1. **Phân biệt theo LÔ, không theo sản phẩm.** Cùng một mã hàng có thể vừa có lô mua đứt, vừa có lô ký gửi của nhiều nhà cung cấp, giá vốn khác nhau. Mọi tính toán (giá vốn, lợi nhuận, công nợ) đều bám theo lô.
2. **Hai trục độc lập: Quyền sở hữu × Nơi lưu giữ.** Ký gửi đi chỉ thay đổi nơi lưu giữ, không đổi chủ sở hữu. Ký gửi vào chỉ thay đổi nơi lưu giữ về phía mình, hàng vẫn của nhà cung cấp.
3. **Sổ cái biến động kho (stock ledger).** Tồn kho không bao giờ sửa trực tiếp bằng tay; mọi thay đổi đều phát sinh từ một chứng từ và ghi một dòng biến động. Sai sót được sửa bằng chứng từ đảo, không xoá dấu vết.
4. **Phân bổ trước — hoá đơn sau.** Hoá đơn chỉ được sinh ra từ phiếu phân bổ đã chốt nguồn hàng (mua đứt / ký gửi, lô nào). Nhân viên không gõ lại số lượng hay loại hàng trên hoá đơn.
5. **Chứng từ quản lý tách theo bản chất, mã unique.** Phần bán trực tiếp và phần ký gửi luôn là 2 chứng từ quản lý riêng (BH / KG), kể cả khi nằm chung trên 1 hoá đơn GTGT. Mã chứng từ do hệ thống sinh, duy nhất, không tái sử dụng — chứng từ huỷ vẫn giữ mã với trạng thái "Đã huỷ".
6. **Chiết khấu chỉ thuộc phía bán trực tiếp.** Chiết khấu cho khách không làm thay đổi khoản phải trả nhà cung cấp của phần ký gửi (luôn tính theo giá ký gửi đã thoả thuận của lô). Hệ thống cảnh báo đỏ nếu giá bán sau chiết khấu thấp hơn giá ký gửi (bán lỗ phần ký gửi).

## 3. Kiến trúc kỹ thuật

| Lớp | Công nghệ |
|---|---|
| Giao diện + xử lý | Next.js 14 (App Router) + TypeScript + Tailwind CSS, giao diện responsive dùng tốt trên điện thoại |
| Cơ sở dữ liệu | Supabase (PostgreSQL) + Auth + Row Level Security theo vai trò |
| Lưu trữ file | Supabase Storage (ảnh sản phẩm, chứng từ scan) |
| Triển khai | Vercel |
| Mã vạch | In nhãn lô (mã vạch/QR); quét bằng camera điện thoại, không cần máy quét riêng ở giai đoạn đầu |
| Báo cáo | Xuất Excel / PDF |
| Giai đoạn sau | Tích hợp nhà cung cấp hoá đơn điện tử (xuất HĐ GTGT trực tiếp từ hệ thống), cổng cho đối tác tự báo tiêu thụ |

## 4. Mô hình hai trục: Sở hữu × Lưu giữ

| | **Tại kho của mình** | **Tại kho đối tác** |
|---|---|---|
| **Hàng của mình** | **A.** Bán bình thường tại cửa hàng | **C.** Ký gửi đi: đối tác bán → sinh phải thu; chưa bán → trả về |
| **Hàng của nhà cung cấp** | **B.** Nhận ký gửi: bán được → sinh phải trả NCC; chưa bán → trả lại NCC | **D.** Ký gửi chồng ký gửi: **KHOÁ mặc định**, chỉ mở cho từng NCC khi có thoả thuận rõ ràng, vì dòng tiền đi qua 2 lớp |

Mỗi đối tác có một **"kho ảo"** riêng trong hệ thống để quản lý hàng đang nằm tại kho của họ.

## 5. Mô hình dữ liệu (các bảng chính)

### 5.1 Danh mục
- **products** — mã hàng (SKU), tên, hãng sản xuất, đơn vị tính, giá bán lẻ / giá gara / giá sỉ, tồn tối thiểu.
- **product_codes** — các mã tra cứu của một mặt hàng: mã OEM, mã hãng, mã tương đương (một phụ tùng có nhiều mã).
- **vehicles** — hãng xe, dòng xe, đời xe, động cơ.
- **product_fitments** — mặt hàng lắp được cho xe nào (tra cứu theo xe).

### 5.2 Đối tác
- **suppliers** — nhà cung cấp: thông tin liên hệ, mã số thuế, điều khoản ký gửi (số ngày phải thanh toán sau khi bán, hạn trả hàng chưa bán).
- **partners** — khách hàng / gara / công ty vận tải / cửa hàng khác: loại đối tác, mã số thuế, hạn mức công nợ, hạn mức ký gửi.

### 5.3 Kho và lô hàng
- **locations** — kho của mình (kệ / ô) hoặc kho ảo của đối tác (`partner_id`).
- **stock_batches (lô hàng)** — trái tim của hệ thống:
  - `batch_code`: mã lô, tiền tố `OWN-…` (hàng mình) / `CONS-…` (ký gửi), in nhãn trắng cho OWN, nhãn vàng cho CONS.
  - `ownership_type`: `OWNED` (mua đứt) | `CONSIGNED` (ký gửi).
  - `supplier_id`: bắt buộc nếu là lô ký gửi.
  - `location_id`: nơi đang lưu giữ (thay đổi khi gửi ký gửi đi / trả về).
  - `unit_cost`: giá nhập mua đứt, hoặc giá ký gửi thoả thuận nếu là lô ký gửi.
  - Ngày nhận, số chứng từ nhập, hạn thanh toán / hạn trả hàng.
- **stock_movements (sổ cái kho)** — mỗi biến động một dòng: loại biến động (nhập mua, nhận ký gửi, bán, gửi ký gửi, chuyển kho, trả vào, trả ra, điều chỉnh kiểm kê), số lượng +/−, lô, kho nguồn → kho đích, chứng từ gốc, người thực hiện, thời gian. Tồn kho của lô = tổng các dòng biến động; không có cột tồn nào được sửa tay.

### 5.4 Chứng từ nghiệp vụ (chi tiết ở Mục 7)
Phiếu nhập mua, phiếu nhận ký gửi, phiếu gửi ký gửi, báo cáo tiêu thụ, phiếu phân bổ, chứng từ bán trực tiếp (BH), chứng từ hàng ký gửi (KG), hoá đơn GTGT, phiếu trả hàng, đợt đối soát/thanh toán.

### 5.5 Công nợ và tiền
- **supplier_payables** — phải trả NCC: sinh tự động khi hàng ký gửi bán được; gắn với chứng từ KG / dòng bán; hạn thanh toán theo điều khoản NCC; trạng thái chưa trả / trả một phần / đã trả.
- **partner_receivables** — phải thu đối tác: sinh khi đối tác tiêu thụ hàng (phần mua đứt theo giá bán sau chiết khấu; phần ký gửi theo giá ký gửi chuyển giao).
- **settlements** — đợt đối soát + thanh toán gộp với từng NCC / đối tác, kèm chi tiết đối chiếu.
- **payments** — phiếu thu / chi tiền gắn với đợt đối soát hoặc công nợ cụ thể.

### 5.6 Người dùng
- **users / roles** — tài khoản nhân viên và vai trò (Mục 9). Mọi chứng từ ghi lại người tạo, người duyệt.

## 6. Cấu trúc module / màn hình

| Đường dẫn | Module | Chức năng chính |
|---|---|---|
| `/dashboard` | Tổng quan | Tồn kho 3 con số (của mình / ký gửi / tổng) theo giá trị; công nợ phải thu – phải trả đến hạn; hàng ký gửi sắp đến hạn trả; hàng sắp hết; cảnh báo chênh lệch đối tác |
| `/products` | Danh mục hàng hoá | CRUD sản phẩm, mã OEM/tương đương, xe tương thích, giá 3 cấp, ảnh |
| `/inventory` | Tồn kho theo lô | Xem tồn theo lô / kho / vị trí (gồm kho ảo đối tác), in nhãn lô, kiểm kê, điều chỉnh có lý do, lịch sử biến động của lô |
| `/stock-in` | Nhập hàng | Lập phiếu nhập mua đứt (PN) hoặc nhận ký gửi (NK); sinh lô + nhãn ngay khi nhập |
| `/consignment-out` | Gửi ký gửi đi | Lập phiếu gửi ký gửi (GK) cho đối tác, in phiếu giao, theo dõi hàng tại từng đối tác, nhận hàng trả về |
| `/sales` | Bán hàng | Bán lẻ tại quầy, chọn lô (FIFO mặc định, chọn tay được), in hoá đơn bán hàng |
| `/partner-consumption` | Tiêu thụ & phân bổ | Nhập báo cáo tiêu thụ của đối tác, lập phiếu phân bổ (PB), xuất hoá đơn theo đợt |
| `/invoices` | Hoá đơn GTGT | Danh sách hoá đơn đã xuất, liên kết dòng hoá đơn ↔ chứng từ BH/KG, huỷ hoá đơn (mở lại đúng phần phân bổ của nó) |
| `/payables` | Phải trả NCC | Công nợ theo NCC, lập đợt đối soát + thanh toán, in biên bản đối soát |
| `/receivables` | Phải thu đối tác | Công nợ theo đối tác, nhắc nợ quá hạn, lập đợt thu tiền |
| `/returns` | Trả hàng & bảo hành | Khách trả hàng (về đúng lô gốc), trả hàng ký gửi chưa bán cho NCC, đối tác trả hàng chưa bán, xử lý bảo hành |
| `/reports` | Báo cáo | Mục 10 |
| `/settings` | Cài đặt | Điều khoản mặc định, cách xuất hoá đơn GTGT (1 tờ 2 dòng / 2 tờ), người dùng & phân quyền, mở khoá ô D theo từng NCC |

## 7. Hệ thống chứng từ và quy tắc mã

### 7.1 Hai lớp chứng từ
- **Lớp pháp lý — Hoá đơn GTGT:** gửi khách hàng và cơ quan thuế. Hệ thống hỗ trợ cả 2 cách (chọn trong Cài đặt, kế toán chốt theo mô hình hợp đồng): (A) tách 2 hoá đơn riêng cho 2 bản chất; hoặc (B) 1 hoá đơn duy nhất, trong đó cùng một mặt hàng xuất hiện thành 2 dòng riêng (dòng mua đứt, dòng ký gửi).
- **Lớp quản lý nội bộ:** luôn tách theo bản chất, bất kể hoá đơn GTGT gộp hay tách. Mỗi dòng hoá đơn GTGT gắn mã của đúng một chứng từ quản lý, đối chiếu theo dòng — không cộng gộp tiền giữa hai bản chất.

### 7.2 Bảng mã chứng từ

| Mã | Chứng từ | Ý nghĩa |
|---|---|---|
| `PN` | Phiếu nhập mua đứt | Nhập hàng của mình, đã trả tiền hoặc ghi nợ NCC theo hoá đơn mua |
| `NK` | Phiếu nhận ký gửi | Nhận hàng của NCC vào kho mình, chưa phát sinh phải trả |
| `GK` | Phiếu gửi ký gửi | Gửi hàng của mình sang kho đối tác |
| `BT` | Báo cáo tiêu thụ | Đối tác xác nhận đã tiêu thụ số lượng bao nhiêu trong kỳ |
| `PB` | Phiếu phân bổ | Chốt mỗi số lượng tiêu thụ thuộc nguồn nào, lô nào — căn cứ duy nhất để xuất hoá đơn |
| `BH` | Chứng từ bán trực tiếp | Phần hàng mua đứt trong một lần xuất hoá đơn; chiết khấu chỉ nằm ở đây |
| `KG` | Chứng từ hàng ký gửi | Phần hàng ký gửi trong một lần xuất hoá đơn; là căn cứ sinh công nợ |
| `TH` | Phiếu trả hàng | Khách trả / đối tác trả / trả NCC |
| `DS` | Đợt đối soát | Đợt chốt số liệu + thanh toán với một NCC hoặc đối tác |
| `PT` / `PC` | Phiếu thu / chi | Thu tiền đối tác, chi tiền NCC |

### 7.3 Quy tắc mã
- Format: `TIỀN TỐ-NĂM THÁNG-SỐ THỨ TỰ`, ví dụ `PB-2610-0001`, `BH-2610-0012`, `KG-2610-0005`. Hệ thống tự sinh, có ràng buộc duy nhất (unique) ở tầng cơ sở dữ liệu, người dùng không nhập tay.
- Mã **không bao giờ tái sử dụng**. Chứng từ bị huỷ giữ nguyên mã, chuyển trạng thái "Đã huỷ" để không đứt vết kiểm toán.
- Số hoá đơn GTGT (do nhà cung cấp hoá đơn điện tử cấp) là một mã khác, lưu dạng thông tin tham chiếu trên chứng từ BH/KG. Một số hoá đơn GTGT có thể được tham chiếu bởi cả một chứng từ BH và một chứng từ KG (khi dùng cách gộp 1 tờ), mỗi chứng từ trỏ đúng phần dòng của mình.

## 8. Các quy trình nghiệp vụ chính

### 8.1 Nhập hàng
1. Nhân viên kho chọn loại nhập: **Mua đứt** → phiếu `PN`; **Nhận ký gửi** → phiếu `NK` (bắt buộc chọn NCC, giá ký gửi, hạn trả hàng).
2. Hệ thống sinh lô tương ứng (`OWN-…` / `CONS-…`), in nhãn dán lên hàng.
3. Hàng vào kho → tồn tăng theo đúng lô và đúng chủ sở hữu. Nhận ký gửi **chưa** phát sinh công nợ.

### 8.2 Bán hàng tại cửa hàng
1. Tra hàng theo tên, mã OEM / mã tương đương, hoặc theo xe (hãng – dòng – đời – động cơ).
2. Chọn lô để xuất: mặc định **FIFO** (lô nhập trước xuất trước), nhân viên được chọn lô khác khi cần.
3. Theo lô được xuất:
   - Lô `OWNED`: giá vốn = giá mua; lợi nhuận = giá bán − giá mua; không phát sinh gì thêm.
   - Lô `CONSIGNED`: lợi nhuận = giá bán − giá ký gửi; hệ thống **tự sinh khoản phải trả đúng NCC của lô đó**, hạn trả theo điều khoản NCC.
4. Thu tiền khách (tiền mặt / chuyển khoản / công nợ nếu là khách quen có hạn mức).

### 8.3 Gửi hàng ký gửi cho đối tác
1. Lập phiếu `GK`: chọn đối tác, chọn lô (ưu tiên lô của mình), giá ký gửi chuyển giao, hạn đối soát/thanh toán, hạn trả hàng, kiểm tra hạn mức ký gửi của đối tác.
2. Hàng chuyển sang **kho ảo của đối tác**: tổng hàng của mình không đổi, chưa ghi doanh thu, chưa ghi phải thu.
3. In phiếu giao hàng kèm mã lô để đối tác ký nhận.

### 8.4 Đối tác tiêu thụ → phân bổ → xuất hoá đơn nhiều lần (quy trình trọng điểm)
1. Cuối kỳ (hoặc theo đợt), đối tác xác nhận số lượng đã tiêu thụ → ghi báo cáo tiêu thụ `BT`.
2. Nhân viên lập phiếu phân bổ `PB`: chốt từng số lượng thuộc nguồn mua đứt hay ký gửi (và lô nào). Hệ thống trừ ngay vào **hạn mức chưa xuất hoá đơn** của từng nguồn.
3. Khi đối tác yêu cầu xuất hoá đơn: hoá đơn được sinh **từ phiếu phân bổ**, mỗi dòng phân bổ chỉ được xuất hoá đơn **đúng một lần** (trạng thái Chưa xuất HĐ → Đã xuất HĐ, kèm số hoá đơn).
4. Mỗi yêu cầu xuất hoá đơn sinh các chứng từ quản lý theo bản chất: phần mua đứt → `BH` (áp chiết khấu nếu có), phần ký gửi → `KG`.
5. Công nợ sinh theo chứng từ: `BH` → phải thu đối tác theo giá bán sau chiết khấu; `KG` → phải thu đối tác theo giá ký gửi chuyển giao (và nếu lô đó vốn là hàng ký gửi nhận từ NCC — ô D — đồng thời sinh phải trả NCC gốc).
6. Huỷ một hoá đơn GTGT chỉ mở lại đúng các dòng phân bổ thuộc hoá đơn đó; các hoá đơn khác không bị ảnh hưởng.

**Ví dụ chuẩn (tiêu chí nghiệm thu):** Công ty vận tải vừa mua đứt vừa nhận ký gửi mặt hàng A trong tháng: mua 5, ký gửi 10, tiêu thụ hết 15, yêu cầu xuất hoá đơn 3 lần:

| Hoá đơn | Mua đứt | Ký gửi | Hạn mức còn lại sau HĐ (mua / ký gửi) |
|---|---|---|---|
| HĐ1 | 4 | 3 | 1 / 7 |
| HĐ2 | 0 | 4 | 1 / 3 |
| HĐ3 | 1 | 3 | 0 / 0 |
| **Tổng** | **5** | **10** | Khớp hoàn toàn, sổ đóng |

### 8.5 Đối soát và thanh toán
- Với **NCC** (hàng ký gửi bán tại cửa hàng mình): chốt theo đợt (tuần/tháng) — đã bán bao nhiêu, còn tồn bao nhiêu, phải trả bao nhiêu → đợt đối soát `DS` → phiếu chi `PC`.
- Với **đối tác** (hàng ký gửi tại kho họ): công thức kiểm soát bắt buộc:
  **Số đã gửi = Số đã tiêu thụ + Số đã trả về + Số còn tại đối tác.**
  Chênh lệch → cảnh báo; mất mát/hư hỏng đối tác bồi thường theo giá ký gửi chuyển giao (theo thoả thuận). Thu tiền theo đợt `DS` → phiếu thu `PT`. Quá hạn đối soát → nhắc nợ tự động.

### 8.6 Trả hàng và bảo hành
- **Khách trả hàng:** hàng quay về **đúng lô gốc**. Nếu lô là ký gửi và chưa thanh toán NCC → huỷ khoản phải trả tương ứng; đã thanh toán → ghi giảm vào đợt đối soát kế tiếp.
- **Trả hàng ký gửi chưa bán cho NCC:** xuất trả từ đúng lô `CONS` của NCC đó, có phiếu `TH` và biên bản giao trả.
- **Đối tác trả hàng chưa bán:** hàng từ kho ảo của đối tác quay về kho mình, giữ nguyên lô.
- **Bảo hành:** tiếp nhận theo lô đã bán để truy được NCC / nguồn hàng khi cần đổi trả lên hãng.

## 9. Phân quyền

| Vai trò | Quyền chính | Giới hạn |
|---|---|---|
| **Chủ cửa hàng (Owner)** | Toàn quyền; xem giá ký gửi, giá vốn, lợi nhuận; duyệt điều chỉnh kho, mở khoá ô D | — |
| **Bán hàng (Sales)** | Tra cứu hàng, bán hàng, lập phân bổ và xuất hoá đơn | **Không** xem giá ký gửi, giá vốn, lợi nhuận |
| **Kho (Warehouse)** | Nhập hàng, gửi ký gửi, kiểm kê, trả hàng, in nhãn | Không xem công nợ và lợi nhuận |
| **Kế toán (Accounting)** | Công nợ, đối soát, hoá đơn, báo cáo tài chính | Không sửa tồn kho trực tiếp |

Chứng từ đã duyệt bị khoá sửa; muốn sửa phải huỷ bằng chứng từ đảo có lý do, hệ thống ghi vết người thực hiện.

## 10. Báo cáo và đối soát

- Tồn kho 3 cột (Của mình | Ký gửi | Tổng) theo sản phẩm, theo kho — gồm cả kho ảo của từng đối tác.
- Đối soát theo NCC: nhận ký gửi – đã bán – đã trả – còn tồn – phải trả (đã trả / còn nợ).
- Đối soát theo đối tác nhận ký gửi: đã gửi – đã tiêu thụ – đã trả – còn giữ – phải thu – quá hạn.
- Doanh thu và lợi nhuận tách theo nguồn hàng (mua đứt / ký gửi) — chỉ Owner xem.
- Công nợ phải thu / phải trả theo tuổi nợ và hạn thanh toán.
- Hàng chậm luân chuyển, hàng sắp hết (dưới tồn tối thiểu), hàng ký gửi sắp đến hạn trả cho NCC.
- Lịch sử biến động đầy đủ của từng lô (truy vết từ lúc nhập đến lúc bán/trả).

## 11. Phạm vi triển khai

**Giai đoạn 1 (MVP):** danh mục + mã OEM + tra theo xe; nhập mua đứt / nhận ký gửi theo lô; sổ cái kho; bán hàng tại quầy; gửi ký gửi đi + kho ảo đối tác; báo tiêu thụ + phân bổ + xuất hoá đơn nhiều lần; công nợ phải trả NCC / phải thu đối tác; đối soát theo đợt; báo cáo ở Mục 10; phân quyền 4 vai trò; quét mã bằng camera điện thoại.

**Để giai đoạn sau:** POS bán hàng chuyên nghiệp bằng máy quét riêng; ứng dụng di động riêng; đối tác tự đăng nhập báo tiêu thụ; tích hợp hoá đơn điện tử; tra phụ tùng bằng ảnh / số VIN bằng AI; bán hàng online.

## 12. Các điểm chờ chốt (giả định mặc định trong lúc chờ)

| # | Điểm chờ chốt | Mặc định đang dùng | Ai chốt |
|---|---|---|---|
| 1 | Ưu tiên chọn lô khi bán tại cửa hàng | FIFO, cho phép chọn tay | Chủ cửa hàng |
| 2 | Chu kỳ đối soát / thanh toán với NCC và đối tác | Theo đợt, chốt cuối tháng | Chủ cửa hàng |
| 3 | Cách đối tác báo tiêu thụ | Nhân viên nhập từ bảng kê đối tác gửi (MVP); cổng tự nhập ở giai đoạn sau | Chủ cửa hàng |
| 4 | Hình thức hoá đơn GTGT (1 tờ 2 dòng / 2 tờ) và mô hình pháp lý của ký gửi (bán hộ / mua bán – trả tiền sau khi bán) | Hệ thống hỗ trợ cả hai, chọn trong Cài đặt | Kế toán, theo quy định hiện hành và hợp đồng ký gửi |
| 5 | Điều khoản ký gửi cụ thể từng NCC (hạn thanh toán sau khi bán, hạn trả hàng) | Nhập theo từng NCC khi ký hợp đồng | Chủ cửa hàng + NCC |
